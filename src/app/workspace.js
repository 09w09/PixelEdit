import { services as PE } from './services.js';
import { ElementClipboard } from '../clipboard/element-clipboard.js';
import {
  copySelection as copySelectionToClipboard,
  pasteClipboard as pasteStructuredClipboard,
  selectAllOnPage as selectAllPageElements,
} from '../commands/clipboard-commands.js';
import { FontManager } from '../fonts/font-manager.js';
import { decodeRasterImage } from '../media/image-runtime.js';
import { normalizeFill, normalizeStroke } from '../model/schema.js';
import {
  DEFAULT_FILENAME,
  loadEditorPreferences,
  saveEditorPreferences,
  updateEditorPreferences,
} from '../preferences/editor-preferences.js';
import { installNativeContextMenuBoundary } from '../ui/context-menu-boundary.js';
import { ToolOptionsBar, installGlobalToolbar } from '../tools/tool-options-bar.js';
import { toolDefaults } from '../tools/tool-state.js';

const M = PE.model;
const C = PE.commands;
const R = PE.renderer;
const I = PE.interaction;
const P = PE.persistence;
const U = PE.ui;

const ZOOMS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
const BOX_TYPES = new Set(['rectangle', 'circle', 'text', 'image', 'raster']);
const EDGE_CORNERS = new Set(['n', 'e', 's', 'w']);
const $ = selector => document.querySelector(selector);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function dataUrlFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downloadBlob(blob, name) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(anchor.href);
    anchor.remove();
  }, 0);
}

function parseXbmText(text) {
  const widthMatch = text.match(/#define\s+\w+_width\s+(\d+)/);
  const heightMatch = text.match(/#define\s+\w+_height\s+(\d+)/);
  const bitsMatch = text.match(/\{([\s\S]*?)\}/);
  if (!widthMatch || !heightMatch || !bitsMatch) throw new Error('Invalid XBM');
  const width = Number(widthMatch[1]);
  const height = Number(heightMatch[1]);
  const bytes = (bitsMatch[1].match(/0x[0-9a-fA-F]+|\d+/g) || []).map(Number);
  const rowBytes = Math.ceil(width / 8);
  const pixels = new Uint8Array(width * height);
  if (bytes.length < rowBytes * height) throw new Error('Invalid XBM data');
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = (bytes[y * rowBytes + Math.floor(x / 8)] >> (x % 8)) & 1;
    }
  }
  return { width, height, pixels };
}

function xbmToCanvas(xbm) {
  const canvas = document.createElement('canvas');
  canvas.width = xbm.width;
  canvas.height = xbm.height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < xbm.pixels.length; index += 1) {
    const value = xbm.pixels[index] ? 0 : 255;
    const offset = index * 4;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function liveNode(editor, gesture) {
  return gesture?.nodeId ? M.nodeById(editor.activePage(), gesture.nodeId) : null;
}

function reanchorTransform(editor, node, gesture, anchorLocal, anchorWorld) {
  const transform = PE.transformModel;
  const geometry = PE.selectionGeometry;
  const base = transform.normalizeTransform(gesture?.original?.transform || node.transform);
  node.transform = base;
  const nextPivot = PE.selectionOverlay?.sourcePivotBounds?.(editor, node) || geometry.sourceGeometryBounds(node);
  const currentAnchor = geometry.localToWorld(node, anchorLocal, nextPivot);
  node.transform = transform.normalizeTransform({
    ...base,
    translateX: (base.translateX || 0) + anchorWorld.x - currentAnchor.x,
    translateY: (base.translateY || 0) + anchorWorld.y - currentAnchor.y,
  });
}

class Workspace {
  constructor() {
    this.state = {
      project: M.createProject(),
      assets: new M.AssetStore(),
      selection: new M.SelectionSet(),
      dirty: false,
      projectFileHandle: null,
      projectFileName: '',
    };
    this.pageSelectedId = this.state.project.activePageId;
    this.bus = new C.CommandBus(this.state, { limit: 100 });
    this.files = new P.ProjectFiles(this.state);
    this.autosave = new P.Autosave(this.state);
    this.clipboard = new ElementClipboard(M, PE.transformModel);
    this.zoom = 1;
    this.tool = 'pointer';
    this.overlayState = {};
    this.customGesture = null;
    this.spaceDown = false;
    this.treeDragId = null;
    this.fontFaceCache = new Map();
    this.lastFramebuffer = new Uint8Array(120000);
    this.editorPreferences = loadEditorPreferences();
    this.fontManager = new FontManager({ editor: this, document: globalThis.document });
    this.toolController = null;
  }

  mount() {
    this.canvas = $('#screenCanvas');
    this.overlay = $('#overlaySvg');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.pageLayers = new U.PageDock(this, $('#pageLayerDock'));
    this.properties = new U.Properties(this, $('#properties'), PE.propertyProvider);
    this.history = new U.HistoryDock(this, $('#historyDock'));
    this.toolbar = new U.Toolbar(this);
    this.toolbar.mount();
    this.setupTopbar();
    this.setupCanvas();
    this.setupKeyboard();
    this.setupFiles();
    this.setupDockSplitters();
    this.setupRulers();
    this.setupContextMenu();
    this.tryRestoreAutosave();
    this.applyLayout();
    this.applyZoom();
    this.renderAll();
    const toolOptionsElement = installGlobalToolbar(this);
    this.toolOptionsBar = new ToolOptionsBar(this, toolOptionsElement);
    this.toolOptionsBar.render();
    this.autosaveTimer = setInterval(() => this.autosave.run(), 300000);
    window.addEventListener('beforeunload', event => {
      if (this.state.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    globalThis.PixelEditorTest = this.testApi();
    return this;
  }

  activePage() { return M.pageById(this.state.project, this.state.project.activePageId); }
  activePageId() { return this.state.project.activePageId; }

  exec(command) {
    const before = this.state.project.activePageId;
    const changed = this.bus.execute(command);
    if (changed) {
      if (this.state.project.activePageId !== before) this.pageSelectedId = this.state.project.activePageId;
      this.renderAll();
    }
    return changed;
  }

  setActivePage(id) { return this.selectPage(id); }

  selectPage(id) {
    if (!M.pageById(this.state.project, id)) return false;
    this.state.project.activePageId = id;
    this.state.selection.clear();
    this.pageSelectedId = id;
    this.overlayState = {};
    this.renderAll();
    return true;
  }

  setTool(tool) {
    if (!this.toolController) throw new Error('ToolController is not initialized');
    return this.toolController.setTool(tool);
  }

  setupTopbar() {
    const zoomSelect = $('#zoomSelect');
    zoomSelect.innerHTML = ZOOMS.map(zoom => `<option value="${zoom}">${zoom * 100}%</option>`).join('');
    zoomSelect.value = String(this.zoom);
    zoomSelect.onchange = () => this.setZoom(Number(zoomSelect.value));
    $('#undoBtn').onclick = () => { if (this.bus.undo()) { this.state.selection.clear(); this.renderAll(); } };
    $('#redoBtn').onclick = () => { if (this.bus.redo()) { this.state.selection.clear(); this.renderAll(); } };
    $('#newBtn').onclick = () => this.newProject();
    $('#saveBtn').onclick = () => this.saveProject();
    $('#openBtn').onclick = () => this.openProject();
    $('#exportPngBtn').onclick = () => this.exportPng();
  }

  newProject({ force = false } = {}) {
    if (!force && this.state.dirty && typeof confirm === 'function' && !confirm('当前工程有未保存修改，确认新建并丢弃这些修改吗？')) return false;
    this.autosave?.clear();
    this.state.project = M.createProject();
    this.state.assets = new M.AssetStore();
    this.state.selection.clear();
    this.pageSelectedId = this.state.project.activePageId;
    this.state.projectFileHandle = null;
    this.state.projectFileName = '';
    this.state.dirty = false;
    this.bus = new C.CommandBus(this.state, { limit: 100 });
    this.files = new P.ProjectFiles(this.state);
    this.autosave = new P.Autosave(this.state);
    this.clipboard = new ElementClipboard(M, PE.transformModel);
    this.applyLayout();
    this.renderAll();
    return true;
  }

  tryRestoreAutosave() {
    const restored = this.autosave?.read?.();
    if (!restored) return false;
    let restore = true;
    if (typeof confirm === 'function') restore = confirm('检测到自动保存的工程，是否恢复？');
    if (!restore) { this.autosave.clear(); return false; }
    this.state.project = restored.project;
    this.state.assets = restored.assets;
    this.state.selection.clear();
    this.pageSelectedId = this.state.project.activePageId;
    this.state.projectFileHandle = null;
    this.state.projectFileName = '';
    this.state.dirty = true;
    this.bus = new C.CommandBus(this.state, { limit: 100 });
    return true;
  }

  setZoom(zoom) {
    if (!ZOOMS.includes(zoom)) return;
    this.zoom = zoom;
    $('#zoomSelect').value = String(zoom);
    this.applyZoom();
    this.renderRulers();
    this.renderOverlay();
  }

  applyZoom() {
    const width = 400 * this.zoom;
    const height = 300 * this.zoom;
    for (const element of [this.canvas, this.overlay]) {
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    }
    $('#stage').style.width = `${width}px`;
    $('#stage').style.height = `${height}px`;
    const showGrid = this.zoom >= 8;
    this.overlay.classList.toggle('pixel-grid', showGrid);
    this.overlay.style.backgroundImage = showGrid
      ? 'linear-gradient(to right, rgba(110,110,110,.34) 1px, transparent 1px),linear-gradient(to bottom, rgba(110,110,110,.34) 1px, transparent 1px)'
      : 'none';
    this.overlay.style.backgroundSize = showGrid ? `${this.zoom}px ${this.zoom}px` : '';
    this.overlay.style.backgroundPosition = '0 0';
    $('#topRuler').style.width = '';
    $('#leftRuler').style.height = '';
  }

  logicalPoint(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: clamp(Math.floor((event.clientX - bounds.left) * 400 / Math.max(1, bounds.width)), 0, 399),
      y: clamp(Math.floor((event.clientY - bounds.top) * 300 / Math.max(1, bounds.height)), 0, 299),
    };
  }

  logicalPointFloat(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) * 400 / Math.max(1, bounds.width), 0, 400),
      y: clamp((event.clientY - bounds.top) * 300 / Math.max(1, bounds.height), 0, 300),
    };
  }

  updateInteraction() {
    const page = this.activePage();
    if (!page) return;
    this.state.pageSelectedId = this.pageSelectedId;
    const hitTest = new I.HitTest(this.state.project, page.id, this.state.assets);
    const snapEngine = new I.SnapEngine(this.state.project, page.id, this.state.assets);
    this.interaction = new I.InteractionController({
      state: this.state,
      bus: this.bus,
      hitTest,
      snapEngine,
      getZoom: () => this.zoom,
      modeKind: this.tool === 'select' ? 'marquee' : 'pointer',
      onOverlay: state => {
        const hadPreview = Boolean(this.overlayState.previewMove);
        this.overlayState = { ...this.overlayState, ...state };
        if (state.previewMove || hadPreview) this.renderCanvasPreviewMove();
        this.renderOverlay();
      },
      onPan: ({ dx, dy }) => {
        const viewport = $('#viewport');
        viewport.scrollLeft -= dx * this.zoom;
        viewport.scrollTop -= dy * this.zoom;
        this.renderRulers();
      },
    });
    this.interaction.setPanModifier(this.spaceDown);
  }

  setupCanvas() {
    this.canvas.addEventListener('pointerdown', event => this.onPointerDown(event));
    this.canvas.addEventListener('pointermove', event => this.onPointerMove(event));
    this.canvas.addEventListener('pointerup', event => this.onPointerUp(event));
    this.canvas.addEventListener('pointercancel', () => { this.cancelCustomGesture(); this.interaction?.cancel(); this.renderAll(); });
    $('#viewport').addEventListener('scroll', () => this.renderRulers());
    $('#viewport').addEventListener('wheel', event => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const index = ZOOMS.indexOf(this.zoom);
        const nextIndex = clamp(index + (event.deltaY < 0 ? 1 : -1), 0, ZOOMS.length - 1);
        this.setZoom(ZOOMS[nextIndex]);
      }
    }, { passive: false });
    this.canvasCursorInside = false;
    this.canvasCursorPoint = null;
    this.canvas.addEventListener('pointerenter', event => {
      this.canvasCursorInside = true;
      this.canvasCursorPoint = this.logicalPoint(event);
      this.applyCanvasCursor({ resetNative: true });
      if (PE.canvasCursor?.cursorModeForTool?.(this.tool) === 'brush') this.renderOverlay();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.canvasCursorInside = false;
      this.canvasCursorPoint = null;
      if (PE.canvasCursor?.cursorModeForTool?.(this.tool) === 'brush') this.renderOverlay();
    });
  }

  selectionHandleAt(point) { return PE.selectionOverlay?.selectionHandleAt?.(this, point) || null; }

  onPointerDown(event) {
    if (this.toolController?.handlePointerDown(event)) return true;
    if (event.button === 2) return false;
    const point = this.logicalPoint(event);
    const precisePoint = this.logicalPointFloat(event);
    this.canvas.setPointerCapture?.(event.pointerId);
    if (this.tool === 'pointer') {
      this.pageSelectedId = null;
      const handle = event.altKey ? null : this.selectionHandleAt(precisePoint);
      if (handle) { this.beginLiveHandle(handle, point); return true; }
      this.updateInteraction();
      this.interaction.pointerDown({ ...point, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, button: event.button });
      this.pageSelectedId = this.state.pageSelectedId ?? null;
      this.pageLayers.render();
      this.properties.render();
      this.renderOverlay();
      return true;
    }
    if (this.tool === 'select') {
      this.pageSelectedId = null;
      this.updateInteraction();
      this.interaction.pointerDown({ ...point, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: false, button: event.button });
      this.pageSelectedId = this.state.pageSelectedId ?? null;
      this.pageLayers.render();
      this.properties.render();
      this.renderOverlay();
      return true;
    }
    if (this.tool === 'pencil' || this.tool === 'eraser') return this.beginPaint(point);
    if (['line', 'rectangle', 'circle', 'polygon', 'text'].includes(this.tool)) return Boolean(this.beginLiveDraw(this.tool, point));
    return false;
  }

  onPointerMove(event) {
    const point = this.logicalPoint(event);
    const precisePoint = this.logicalPointFloat(event);
    $('#cursorStatus').textContent = `x: ${point.x} y: ${point.y}`;
    let result = false;
    if (this.customGesture) {
      const gesture = this.customGesture;
      gesture.last = point;
      if (gesture.type === 'paint') this.updatePaint(gesture, point);
      else if (gesture.type === 'draw-live') this.updateLiveDraw(gesture, point);
      else if (gesture.type === 'resize-live') this.updateLiveResize(gesture, point);
      else if (gesture.type === 'polygon-point-live' || gesture.type === 'line-point-live') this.updateLivePoint(gesture, point);
      result = true;
    } else if ((this.tool === 'pointer' || this.tool === 'select') && this.interaction) {
      this.interaction.pointerMove({ ...point, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey });
      if (this.tool === 'pointer' && this.interaction.mode === 'Idle') {
        if (this.spaceDown) this.canvas.style.cursor = 'grab';
        else {
          const handle = this.selectionHandleAt(precisePoint);
          if (handle?.type === 'resize') {
            const pivot = PE.selectionOverlay?.sourcePivotBounds?.(this, handle.node);
            this.canvas.style.cursor = PE.photopeaTransformUI?.resizeCursorForHandle?.(handle.node, handle.corner, pivot, PE.selectionGeometry) || 'default';
          } else if (handle) this.canvas.style.cursor = 'pointer';
          else {
            const hit = new I.HitTest(this.state.project, this.activePage().id, this.state.assets).topmostAt(point.x, point.y, { ignoreLocked: true });
            this.canvas.style.cursor = hit ? 'move' : 'default';
          }
        }
      } else if (this.tool === 'select') this.canvas.style.cursor = 'crosshair';
      this.renderOverlay();
      result = true;
    }
    this.toolController?.handlePointerMove(event);
    return result;
  }

  onPointerUp(event) {
    if (this.toolController?.handlePointerUp(event)) return true;
    const point = this.logicalPoint(event);
    if (this.customGesture) {
      const gesture = this.customGesture;
      this.customGesture = null;
      if (gesture.type === 'paint') this.commitPaint(gesture);
      else if (gesture.type === 'draw-live') this.commitLiveDraw(gesture);
      else if (gesture.type === 'resize-live' || gesture.type === 'polygon-point-live' || gesture.type === 'line-point-live') this.commitLiveHandle(gesture);
      this.overlayState = {};
      this.renderAll();
      return true;
    }
    if ((this.tool === 'pointer' || this.tool === 'select') && this.interaction) {
      this.interaction.pointerUp({ ...point, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey });
      this.overlayState = {};
      this.renderAll();
      return true;
    }
    return false;
  }

  cancelCustomGesture() {
    const gesture = this.customGesture;
    if (!gesture) return;
    if (gesture.type === 'draw-live') {
      const page = this.activePage();
      page.nodes = page.nodes.filter(node => node.id !== gesture.nodeId);
      this.state.selection.replace(gesture.previousSelection || []);
    } else if (gesture.type === 'paint') {
      if (gesture.targetKind === 'page') this.activePage().overlay = structuredClone(gesture.originalOverlay);
      else if (gesture.targetKind === 'raster') {
        const node = M.nodeById(this.activePage(), gesture.nodeId);
        if (node) node.raster = structuredClone(gesture.originalRaster);
      }
    } else if (['resize-live', 'polygon-point-live', 'line-point-live'].includes(gesture.type)) {
      const node = M.nodeById(this.activePage(), gesture.nodeId);
      if (node) Object.assign(node, structuredClone(gesture.original));
    }
    this.customGesture = null;
    this.overlayState = {};
    this.renderCanvas();
  }

  creationParentId() {
    const page = this.activePage();
    const id = this.state.selection.primaryId;
    const tree = new M.TreeModel(page);
    if (id) {
      if (tree.isEffectivelyLocked(id)) { this.notice('当前父图层已锁定，无法创建子元素'); return null; }
      return id;
    }
    if (page.locked) { this.notice('页面已锁定，无法创建元素'); return null; }
    return page.id;
  }

  beginLiveDraw(tool, point) {
    const p = M.integerPoint?.(point) || point;
    const page = this.activePage();
    const previousSelection = [...this.state.selection.ids];
    const parentId = this.creationParentId();
    if (!parentId) return false;
    let node;
    if (tool === 'line') node = M.createNode('line', { parentId, x1: p.x, y1: p.y, x2: p.x, y2: p.y, lineWidth: 1 });
    else if (tool === 'rectangle') node = M.createNode('rectangle', { parentId, x: p.x, y: p.y, w: 1, h: 1, lineWidth: 1, fill: { mode: 'transparent' } });
    else if (tool === 'circle') node = M.createNode('circle', { parentId, x: p.x, y: p.y, w: 1, h: 1, lineWidth: 1, fill: { mode: 'transparent' } });
    else if (tool === 'polygon') node = M.createNode('polygon', { parentId, points: [{ x: p.x, y: p.y }, { x: p.x, y: p.y }, { x: p.x, y: p.y }], lineWidth: 1, fill: { mode: 'transparent' } });
    else node = M.createNode('text', { parentId, x: p.x, y: p.y, w: 40, h: 24, text: '文字', fontSize: 16 });
    page.nodes.push(node);
    this.state.selection.replace([node.id]);
    this.customGesture = { type: 'draw-live', tool, nodeId: node.id, start: p, last: p, previousSelection };
    M.normalizeNodeGeometry?.(node);
    if (tool === 'text') {
      const settings = this.getToolDefaults('text');
      const resolved = PE.fontOptions?.resolveTextToolSelection?.(settings, this.state.project, settings.fontFamily) || { fontFamily: settings.fontFamily || 'sans-serif', fontSize: settings.fontSize || 16, fixed: false };
      node.fontFamily = resolved.fontFamily;
      node.fontSize = resolved.fontSize;
      node.fixedFontSize = resolved.fixed ? resolved.fontSize : null;
      node.alignH = ['left', 'center', 'right'].includes(settings.alignH) ? settings.alignH : 'left';
      node.alignV = ['top', 'middle', 'bottom'].includes(settings.alignV) ? settings.alignV : 'top';
    } else if (['line', 'rectangle', 'circle', 'polygon'].includes(tool)) {
      const settings = this.getToolDefaults(tool);
      node.stroke = normalizeStroke(settings);
      if (tool !== 'line') node.fill = normalizeFill(settings.fill);
    }
    this.renderCanvas();
    this.renderOverlay();
    return node;
  }

  updateLiveDraw(gesture, point) {
    const p = M.integerPoint?.(point) || point;
    const node = M.nodeById(this.activePage(), gesture.nodeId);
    if (!node) return;
    const x = Math.min(gesture.start.x, p.x), y = Math.min(gesture.start.y, p.y);
    const width = Math.max(1, Math.abs(p.x - gesture.start.x) + 1), height = Math.max(1, Math.abs(p.y - gesture.start.y) + 1);
    if (node.type === 'line') { node.x1 = gesture.start.x; node.y1 = gesture.start.y; node.x2 = p.x; node.y2 = p.y; }
    else if (node.type === 'polygon') node.points = [{ x, y: y + height - 1 }, { x: x + Math.floor((width - 1) / 2), y }, { x: x + width - 1, y: y + height - 1 }];
    else { node.x = x; node.y = y; node.w = node.type === 'text' ? Math.max(40, width) : width; node.h = node.type === 'text' ? Math.max(24, height) : height; }
    M.normalizeNodeGeometry?.(node);
    this.renderCanvas(); this.renderOverlay(); this.properties.render();
  }

  commitLiveDraw(gesture) {
    const page = this.activePage(), node = M.nodeById(page, gesture.nodeId);
    if (!node) return false;
    M.normalizeNodeGeometry?.(node);
    const finalNode = structuredClone(node);
    page.nodes = page.nodes.filter(item => item.id !== gesture.nodeId);
    this.state.selection.replace(gesture.previousSelection || []);
    const changed = this.exec(new C.AddNodesCommand([finalNode], page.id, `创建${finalNode.name}`));
    if (changed) { this.state.selection.replace([finalNode.id]); this.setTool('pointer'); this.renderAll(); }
    return changed;
  }

  beginLiveHandle(handle, point) {
    const node = handle.node, original = structuredClone(node);
    const type = handle.type === 'resize' ? 'resize-live' : handle.type === 'polygon-point' ? 'polygon-point-live' : 'line-point-live';
    this.customGesture = { type, nodeId: node.id, index: handle.index, corner: handle.corner, startBounds: handle.startBounds, start: point, last: point, original, pivotBounds: PE.selectionOverlay?.sourcePivotBounds?.(this, node) || null };
  }

  updateLiveResize(gesture, point) {
    const node = M.nodeById(this.activePage(), gesture.nodeId);
    if (!node || !BOX_TYPES.has(node.type)) return;
    const bounds = gesture.startBounds, left = bounds.x, top = bounds.y, right = bounds.x + bounds.w, bottom = bounds.y + bounds.h;
    const mappingNode = gesture.original || node, pivot = gesture.pivotBounds || PE.selectionGeometry.sourceGeometryBounds(mappingNode);
    const raw = PE.selectionGeometry.worldToLocal(mappingNode, point, pivot), local = { x: Math.round(raw.x), y: Math.round(raw.y) };
    let x = left, y = top, width = bounds.w, height = bounds.h, anchorLocal;
    if (EDGE_CORNERS.has(gesture.corner)) {
      const centerX = left + bounds.w / 2, centerY = top + bounds.h / 2, ratio = bounds.w / Math.max(1, bounds.h);
      if (gesture.corner === 'e' || gesture.corner === 'w') {
        const anchorX = gesture.corner === 'e' ? left : right;
        width = Math.max(1, Math.abs(local.x - anchorX)); x = gesture.corner === 'w' ? Math.round(anchorX - width) : Math.round(anchorX); anchorLocal = { x: anchorX, y: centerY };
        if (node.aspectLocked) { height = Math.max(1, Math.round(width / Math.max(1e-9, ratio))); y = Math.round(centerY - height / 2); }
      } else {
        const anchorY = gesture.corner === 's' ? top : bottom;
        height = Math.max(1, Math.abs(local.y - anchorY)); y = gesture.corner === 'n' ? Math.round(anchorY - height) : Math.round(anchorY); anchorLocal = { x: centerX, y: anchorY };
        if (node.aspectLocked) { width = Math.max(1, Math.round(height * ratio)); x = Math.round(centerX - width / 2); }
      }
    } else {
      const west = gesture.corner.includes('w'), north = gesture.corner.includes('n'), anchorX = west ? right : left, anchorY = north ? bottom : top;
      anchorLocal = { x: anchorX, y: anchorY }; width = Math.max(1, Math.abs(local.x - anchorX)); height = Math.max(1, Math.abs(local.y - anchorY));
      if (node.aspectLocked) { const ratio = bounds.w / Math.max(1, bounds.h), scaleX = width / Math.max(1, bounds.w), scaleY = height / Math.max(1, bounds.h); if (scaleX >= scaleY) height = Math.max(1, Math.round(width / ratio)); else width = Math.max(1, Math.round(height * ratio)); }
      x = Math.round(west ? anchorX - width : anchorX); y = Math.round(north ? anchorY - height : anchorY);
    }
    const anchorWorld = PE.selectionGeometry.localToWorld(mappingNode, anchorLocal, pivot), geometry = { x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) };
    if (node.type === 'raster') Object.assign(node, PE.rasterLayer.resizeRaster(gesture.original, geometry)); else Object.assign(node, geometry);
    reanchorTransform(this, node, gesture, anchorLocal, anchorWorld);
    this.renderCanvas(); this.renderOverlay(); this.properties.render();
  }

  updateLivePoint(gesture, point) {
    const node = M.nodeById(this.activePage(), gesture.nodeId);
    if (!node || (node.type !== 'line' && node.type !== 'polygon')) return;
    const mappingNode = gesture.original || node, pivot = gesture.pivotBounds || PE.selectionGeometry.sourceGeometryBounds(mappingNode), raw = PE.selectionGeometry.worldToLocal(mappingNode, point, pivot), local = { x: Math.round(raw.x), y: Math.round(raw.y) };
    let anchorLocal = null;
    if (node.type === 'line') anchorLocal = gesture.index === 0 ? { x: mappingNode.x2, y: mappingNode.y2 } : { x: mappingNode.x1, y: mappingNode.y1 };
    else { const anchorIndex = (mappingNode.points || []).findIndex((_, index) => index !== gesture.index); if (anchorIndex >= 0) anchorLocal = { ...mappingNode.points[anchorIndex] }; }
    const anchorWorld = anchorLocal ? PE.selectionGeometry.localToWorld(mappingNode, anchorLocal, pivot) : null;
    if (node.type === 'polygon') node.points[gesture.index] = local; else if (gesture.index === 0) { node.x1 = local.x; node.y1 = local.y; } else { node.x2 = local.x; node.y2 = local.y; }
    if (anchorLocal && anchorWorld) reanchorTransform(this, node, gesture, anchorLocal, anchorWorld); else node.transform = PE.transformModel.normalizeTransform(mappingNode.transform);
    this.renderCanvas(); this.renderOverlay(); this.properties.render();
  }

  commitLiveHandle(gesture) {
    if (!gesture || !['resize-live', 'polygon-point-live', 'line-point-live'].includes(gesture.type)) return false;
    const page = this.activePage(), node = M.nodeById(page, gesture.nodeId);
    if (!node || !gesture.original) return false;
    let patch;
    if (gesture.type === 'resize-live') { patch = { x: node.x, y: node.y, w: node.w, h: node.h, transform: structuredClone(PE.transformModel.normalizeTransform(node.transform)) }; if (node.type === 'raster' && node.raster) patch.raster = structuredClone(node.raster); }
    else if (gesture.type === 'polygon-point-live') patch = { points: structuredClone(node.points), transform: structuredClone(PE.transformModel.normalizeTransform(node.transform)) };
    else patch = { x1: node.x1, y1: node.y1, x2: node.x2, y2: node.y2, transform: structuredClone(PE.transformModel.normalizeTransform(node.transform)) };
    Object.assign(node, structuredClone(gesture.original));
    return this.exec(new C.UpdateNodesCommand([gesture.nodeId], patch, page.id, gesture.type === 'resize-live' ? '调整大小' : '移动控制点'));
  }

  linePoints(a, b) {
    const points = [], dx = Math.abs(b.x - a.x), sx = a.x < b.x ? 1 : -1, dy = -Math.abs(b.y - a.y), sy = a.y < b.y ? 1 : -1;
    let error = dx + dy, x = a.x, y = a.y;
    while (true) { points.push({ x, y }); if (x === b.x && y === b.y) break; const doubled = 2 * error; if (doubled >= dy) { error += dy; x += sx; } if (doubled <= dx) { error += dx; y += sy; } }
    return points;
  }

  paintTarget() {
    const page = this.activePage(), node = M.nodeById(page, this.state.selection.primaryId), tree = new M.TreeModel(page);
    if (node) { if (node.type !== 'raster' || tree.isEffectivelyLocked(node.id) || !tree.isEffectivelyVisible(node.id)) return null; return { kind: 'node', node }; }
    if (!page.locked) return { kind: 'page', page };
    return null;
  }

  beginPaint(point) {
    if (!this.toolController) throw new Error('ToolController is not initialized');
    return this.toolController.beginPaint(point);
  }

  applyPaintSegment(gesture, a, b) {
    if (!gesture || (gesture.targetKind !== 'page' && gesture.targetKind !== 'raster')) return false;
    const path = this.linePoints(a, b);
    if (gesture.targetKind === 'page') {
      const points = PE.paintBrush.expandBrushPoints(path, gesture.brushWidth), page = this.activePage(); page.overlay ||= {}; let changed = false;
      for (const pixel of points) { if (pixel.x < 0 || pixel.y < 0 || pixel.x >= 400 || pixel.y >= 300) continue; const key = `${pixel.x},${pixel.y}`; if (page.overlay[key] === gesture.value) continue; page.overlay[key] = gesture.value; changed = true; }
      gesture.changed ||= changed; return changed;
    }
    const node = M.nodeById(this.activePage(), gesture.nodeId); if (!node || node.type !== 'raster') return false;
    const localPath = path.map(point => PE.selectionTransform.screenPointToRasterPixel(node, point)).filter(Boolean).map(point => ({ x: point.x, y: point.y })), localPoints = PE.paintBrush.expandBrushPoints(localPath, gesture.brushWidth), before = node.raster.data;
    node.raster = PE.tristateRaster.paintTriStateRaster(node, localPoints, gesture.value); const changed = node.raster.data !== before; gesture.changed ||= changed; return changed;
  }

  updatePaint(gesture, point) { const from = gesture.lastPaint || gesture.start; if (this.applyPaintSegment(gesture, from, point)) this.renderCanvas(); gesture.lastPaint = point; }

  commitPaint(gesture) {
    if (gesture?.targetKind === 'page') { const page = this.activePage(), finalOverlay = structuredClone(page.overlay || {}); page.overlay = structuredClone(gesture.originalOverlay || {}); if (!gesture.changed) return false; const label = gesture.tool === 'eraser' ? '背景橡皮' : gesture.value === 0 ? '背景白色铅笔' : '背景黑色铅笔'; return this.exec(new C.UpdatePageCommand(page.id, { overlay: finalOverlay }, label)); }
    if (gesture?.targetKind === 'raster') { const page = this.activePage(), node = M.nodeById(page, gesture.nodeId); if (!node) return false; const finalRaster = structuredClone(node.raster); node.raster = structuredClone(gesture.originalRaster); if (!gesture.changed) return false; const label = gesture.tool === 'eraser' ? '栅格橡皮' : gesture.value === PE.tristateRaster.RASTER_WHITE ? '栅格白色铅笔' : '栅格黑色铅笔'; return this.exec(new C.UpdateNodesCommand([node.id], { raster: finalRaster }, page.id, label)); }
    return false;
  }

  setSelectionAxis(axis, target) {
    const page = this.activePage(), tree = new M.TreeModel(page), roots = this.state.selection.transformRoots(tree);
    return this.exec({ label: '设置位置', execute: () => { let changed = false; for (const id of roots) { if (tree.isEffectivelyLocked(id)) continue; const bounds = R.FramebufferRenderer.visualBounds(id, { project: this.state.project, pageId: page.id, assets: this.state.assets }), delta = Math.round(target - bounds[axis]); if (delta) { C.moveNodeTree(page, id, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0); changed = true; } } return changed; } });
  }

  setSelectionSize(axis, targetValue) {
    const page = this.activePage(), ids = this.state.selection.ids.filter(id => BOX_TYPES.has(M.nodeById(page, id)?.type)), targetSize = Math.max(1, Math.round(Number(targetValue)));
    if (!ids.length || !Number.isFinite(targetSize)) return false;
    return this.exec(new C.UpdateNodesCommand(ids, node => { const ratio = node.w / Math.max(1, node.h); let width = node.w, height = node.h; if (axis === 'w') { width = targetSize; if (node.aspectLocked) height = Math.max(1, Math.round(targetSize / ratio)); } else { height = targetSize; if (node.aspectLocked) width = Math.max(1, Math.round(targetSize * ratio)); } if (node.type === 'raster') return PE.rasterLayer.resizeRaster(node, { x: node.x, y: node.y, w: width, h: height }); const patch = {}; if (width !== node.w) patch.w = width; if (height !== node.h) patch.h = height; return patch; }, page.id, '调整尺寸'));
  }

  setPolygonPointCount(id, count) {
    const page = this.activePage(), node = M.nodeById(page, id); if (!node || node.type !== 'polygon') return; const pointCount = clamp(Math.round(count), 3, 24), points = node.points.map(point => ({ ...point }));
    while (points.length < pointCount) { const last = points.at(-1), previous = points.at(-2) || last; points.push({ x: last.x + (last.x - previous.x || 10), y: last.y + (last.y - previous.y) }); } while (points.length > pointCount) points.pop(); this.exec(new C.UpdateNodesCommand([id], { points }, page.id, '顶点数量'));
  }

  selectionBounds() {
    const page = this.activePage(), tree = new M.TreeModel(page), roots = this.state.selection.transformRoots(tree), bounds = roots.map(id => R.FramebufferRenderer.visualBounds(id, { project: this.state.project, pageId: page.id, assets: this.state.assets })).filter(item => item.w && item.h);
    if (!bounds.length) return null; const x = Math.min(...bounds.map(item => item.x)), y = Math.min(...bounds.map(item => item.y)), right = Math.max(...bounds.map(item => item.x + item.w)), bottom = Math.max(...bounds.map(item => item.y + item.h)), preview = this.overlayState.previewMove;
    return { x: x + (preview?.dx || 0), y: y + (preview?.dy || 0), w: right - x, h: bottom - y };
  }

  selectionRects() {
    const page = this.activePage(), preview = this.overlayState.previewMove, dx = preview?.dx || 0, dy = preview?.dy || 0;
    return this.state.selection.ids.map(id => R.FramebufferRenderer.visualBounds(id, { project: this.state.project, pageId: page.id, assets: this.state.assets })).filter(bounds => bounds && bounds.w > 0 && bounds.h > 0).map(bounds => ({ x: bounds.x + dx, y: bounds.y + dy, w: bounds.w, h: bounds.h }));
  }

  drawFramebuffer(framebuffer) {
    const image = this.ctx.createImageData(400, 300); for (let index = 0; index < framebuffer.length; index += 1) { const value = framebuffer[index] ? 0 : 255, offset = index * 4; image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255; } this.ctx.putImageData(image, 0, 0); this.lastFramebuffer = framebuffer;
  }

  renderCanvas() { const page = this.activePage(); if (!page) return; this.drawFramebuffer(R.FramebufferRenderer.renderPage(this.state.project, page.id, this.state.assets)); }

  renderCanvasPreviewMove() {
    const page = this.activePage(), preview = this.overlayState.previewMove; if (!page || !preview || (!preview.dx && !preview.dy)) { this.renderCanvas(); return; } const tree = new M.TreeModel(page), roots = new M.SelectionSet(preview.ids || this.state.selection.ids).transformRoots(tree); for (const id of roots) C.moveNodeTree(page, id, preview.dx, preview.dy, tree); try { this.drawFramebuffer(R.FramebufferRenderer.renderPage(this.state.project, page.id, this.state.assets)); } finally { for (const id of roots) C.moveNodeTree(page, id, -preview.dx, -preview.dy, tree); }
  }

  renderOverlay() { return PE.overlayPipeline?.render?.(this) || ''; }

  renderRulers() {
    const top = $('#topRuler'), left = $('#leftRuler'); if (!top || !left || !this.canvas) return; const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
    for (const canvas of [top, left]) { const bounds = canvas.getBoundingClientRect(), width = Math.max(1, Math.round(bounds.width * dpr)), height = Math.max(1, Math.round(bounds.height * dpr)); if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height; }
    const topBounds = top.getBoundingClientRect(), leftBounds = left.getBoundingClientRect(), screenBounds = this.canvas.getBoundingClientRect(), topContext = top.getContext('2d'), leftContext = left.getContext('2d');
    for (const [context, canvas] of [[topContext, top], [leftContext, left]]) { context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight); context.fillStyle = '#242424'; context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight); context.strokeStyle = '#666'; context.fillStyle = '#bbb'; context.lineWidth = 1; context.font = '11px system-ui,sans-serif'; context.textBaseline = 'top'; }
    const x0 = screenBounds.left - topBounds.left, y0 = screenBounds.top - leftBounds.top, bandX0 = x0 - 16, bandX1 = x0 + 400 * this.zoom + 16, bandY0 = y0 - 16, bandY1 = y0 + 300 * this.zoom + 16; topContext.fillStyle = '#2d2d2d'; topContext.fillRect(bandX0, 0, bandX1 - bandX0, top.clientHeight); leftContext.fillStyle = '#2d2d2d'; leftContext.fillRect(0, bandY0, left.clientWidth, bandY1 - bandY0);
    const raw = Math.ceil(44 / this.zoom), steps = [1, 2, 5, 10, 20, 50, 100, 200], step = steps.find(value => value >= raw) || 200; topContext.fillStyle = '#bbb'; leftContext.fillStyle = '#bbb';
    for (let x = 0; x <= 400; x += step) { const pixel = x0 + x * this.zoom + 0.5; topContext.beginPath(); topContext.moveTo(pixel, top.clientHeight - 9); topContext.lineTo(pixel, top.clientHeight); topContext.stroke(); topContext.fillText(String(x), pixel + 3, 3); }
    for (let y = 0; y <= 300; y += step) { const pixel = y0 + y * this.zoom + 0.5; leftContext.beginPath(); leftContext.moveTo(left.clientWidth - 9, pixel); leftContext.lineTo(left.clientWidth, pixel); leftContext.stroke(); leftContext.save(); leftContext.translate(3, pixel + 2); leftContext.rotate(-Math.PI / 2); leftContext.fillText(String(y), 0, 0); leftContext.restore(); }
  }

  renderAll(options = {}) {
    const resolved = { canvas: true, properties: true, layers: true, history: true, ...options }; this.fontManager?.sync(this.state.project.fonts || []); if (resolved.canvas) this.renderCanvas(); this.renderOverlay(); this.renderRulers(); if (resolved.layers) this.pageLayers?.render(); if (resolved.properties) this.properties?.render(); if (resolved.history) this.history?.render(); this.updateInteraction(); this.applyLayout();
    const status = $('#statusText'); if (status) status.textContent = '400×300 · 1-bit · V17'; const selectionStatus = $('#selectionStatus'); if (selectionStatus) selectionStatus.textContent = this.state.selection.ids.length ? `已选择 ${this.state.selection.ids.length}` : this.pageSelectedId === this.activePage().id ? '已选择页面 / 背景' : '未选择'; document.title = `400×300 黑白像素编辑器 V17${this.state.dirty ? ' *' : ''}`; document.documentElement.dataset.pixelEditor = 'v17'; if (globalThis.PixelEditorTest) globalThis.PixelEditorTest.version = 17; this.toolOptionsBar?.render?.();
  }

  runSelectionTransform(action, value = 0) { return PE.selectionTransform?.runSelectionTransform?.(this, action, value) || false; }
  align(mode) { return PE.selectionTransform?.align?.(this, mode) || false; }
  distribute(axis) { return PE.selectionTransform?.distribute?.(this, axis) || false; }
  copySelection() { return copySelectionToClipboard(this); }
  pasteClipboard() { return pasteStructuredClipboard(this); }
  selectAllOnPage() { return selectAllPageElements(this); }

  setupKeyboard() {
    window.addEventListener('keydown', event => {
      const mod = event.ctrlKey || event.metaKey, editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable;
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); this.saveProject(); return; }
      if (editing) return;
      if (event.code === 'Space') { this.spaceDown = true; this.interaction?.setPanModifier(true); event.preventDefault(); return; }
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey ? this.bus.redo() : this.bus.undo()) { this.state.selection.clear(); this.renderAll(); } return; }
      if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); if (this.bus.redo()) { this.state.selection.clear(); this.renderAll(); } return; }
      if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); this.selectAllOnPage(); return; }
      if (mod && event.key.toLowerCase() === 'c' && this.state.selection.ids.length) { event.preventDefault(); this.copySelection(); return; }
      if (mod && event.key.toLowerCase() === 'v' && this.clipboard.hasPayload()) { event.preventDefault(); this.pasteClipboard(); return; }
      if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); this.exec(new C.DuplicateCommand(this.state.selection.ids, this.activePage().id)); return; }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && this.state.selection.ids.length) { event.preventDefault(); const step = event.shiftKey ? 10 : 1, dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0, key = `nudge:${event.key}:${event.shiftKey}:${[...this.state.selection.ids].sort().join(',')}`; this.exec(new C.MoveSelectionCommand(this.state.selection.ids, dx, dy, this.activePage().id, { mergeKey: key })); return; }
      if (['Delete', 'Backspace'].includes(event.key) && this.state.selection.ids.length) { event.preventDefault(); this.exec(new C.DeleteNodesCommand(this.state.selection.ids, this.activePage().id)); this.state.selection.clear(); this.renderAll(); return; }
      if (event.key === '+' || event.key === '=') { const index = ZOOMS.indexOf(this.zoom); this.setZoom(ZOOMS[Math.min(ZOOMS.length - 1, index + 1)]); } else if (event.key === '-') { const index = ZOOMS.indexOf(this.zoom); this.setZoom(ZOOMS[Math.max(0, index - 1)]); }
    });
    window.addEventListener('keyup', event => { if (event.code === 'Space') { this.spaceDown = false; this.interaction?.setPanModifier(false); } });
  }

  setupFiles() {
    const imageInput = $('#fileImage');
    imageInput.onchange = async event => { const file = event.target.files?.[0]; if (file) try { await this.importImageFile(file); } catch (error) { alert(`导入失败：${error.message}`); } event.target.value = ''; };
    imageInput.addEventListener('cancel', () => { if (this.tool === 'image') this.setTool('pointer'); });
    imageInput.addEventListener('change', () => { if (!imageInput.files?.length && this.tool === 'image') this.setTool('pointer'); });
    $('#fileFont').onchange = async event => { const files = [...(event.target.files || [])]; if (files.length) try { const result = await this.importFonts(files); this.notice(`已导入 ${result.imported} 个字体，跳过 ${result.skipped} 个重复字体`); } catch (error) { alert(`字体导入失败：${error.message}`); } event.target.value = ''; };
    $('#fileProject').onchange = async event => { const file = event.target.files?.[0]; if (file) try { const output = P.ProjectSerializer.deserialize(await file.text()); this.state.project = output.project; this.state.assets = output.assets; this.state.projectFileHandle = null; this.state.projectFileName = file.name; this.state.selection.clear(); this.pageSelectedId = this.state.project.activePageId; this.bus = new C.CommandBus(this.state, { limit: 100 }); this.state.dirty = false; await this.hydrateAssets(); this.autosave?.clear(); this.applyLayout(); this.renderAll(); } catch (error) { alert(`项目无效：${error.message}`); } event.target.value = ''; };
    window.addEventListener('paste', async event => { if (['INPUT', 'TEXTAREA'].includes(event.target?.tagName)) return; const text = event.clipboardData?.getData('text/plain') || ''; if (/<svg[\s\S]*<\/svg>/i.test(text)) { event.preventDefault(); await this.importSvgText(text); } else if (/#define\s+\w+_width/i.test(text) && /#define\s+\w+_height/i.test(text)) { event.preventDefault(); await this.importXbmText(text); } });
  }

  async chooseReplacementImage(targetId) {
    const page = this.activePage(), target = M.nodeById(page, targetId); if (!target || target.type !== 'image' || new M.TreeModel(page).isEffectivelyLocked(targetId)) return false; const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,.xbm,image/svg+xml'; input.style.display = 'none'; document.body.appendChild(input); input.addEventListener('change', async () => { const file = input.files?.[0]; try { if (file) await this.importImageFile(file, { replaceTargetId: targetId }); } catch (error) { alert(`替换图片失败：${error.message}`); } finally { input.remove(); } }, { once: true }); input.addEventListener('cancel', () => input.remove(), { once: true }); input.click(); return true;
  }

  async importImageFile(file, { replaceTargetId = null } = {}) {
    try { if (file.name.toLowerCase().endsWith('.xbm')) return this.importXbmText(await file.text(), file.name, { replaceTargetId }); if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) return this.importSvgText(await file.text(), file.name, { replaceTargetId }); const dataUrl = await dataUrlFromFile(file), runtime = await decodeRasterImage(dataUrl); return this.addImageAsset(dataUrl, runtime, file.name, file.type || 'image', { sourceType: 'bitmap', replaceTargetId }); } finally { if (this.tool === 'image') this.setTool('pointer'); }
  }

  async importSvgText(text, name = 'svg', options = {}) { return PE.svgVectorRuntime?.importSvgText?.(this, text, name, options); }

  async importXbmText(text, name = 'xbm', { replaceTargetId = null } = {}) {
    const xbm = parseXbmText(text), canvas = xbmToCanvas(xbm), dataUrl = canvas.toDataURL('image/png'), runtime = { width: xbm.width, height: xbm.height, data: canvas.getContext('2d').getImageData(0, 0, xbm.width, xbm.height).data }; return this.addImageAsset(dataUrl, runtime, name, 'image/xbm', { sourceType: 'xbm', replaceTargetId });
  }

  addImageAsset(url, runtime, name, mime, meta = {}) {
    const id = this.state.assets.add('image', url, { name, mime }); this.state.assets.setRuntime(id, runtime); const targetId = meta.replaceTargetId;
    if (targetId) { const page = this.activePage(), old = M.nodeById(page, targetId), tree = new M.TreeModel(page); if (old?.type === 'image' && !tree.isEffectivelyLocked(targetId)) { const changed = this.exec(new C.UpdateNodesCommand([targetId], { assetId: id, sourceWidth: runtime.width, sourceHeight: runtime.height, sourceName: name, sourceType: meta.sourceType || 'bitmap', svgViewBox: meta.svgViewBox || null, image: { ...(old.image || {}), cropX: 0, cropY: 0, cropW: runtime.width, cropH: runtime.height } }, page.id, '替换图片')); if (changed) { this.state.selection.replace([targetId]); this.setTool('pointer'); return M.nodeById(page, targetId); } } this.state.assets.delete(id); return null; }
    const parentId = this.creationParentId(); if (!parentId) { this.state.assets.delete(id); return null; } const scale = Math.min(1, 400 / runtime.width, 300 / runtime.height), width = Math.max(1, Math.round(runtime.width * scale)), height = Math.max(1, Math.round(runtime.height * scale)), node = M.createNode('image', { parentId, x: Math.floor((400 - width) / 2), y: Math.floor((300 - height) / 2), w: width, h: height, assetId: id, sourceWidth: runtime.width, sourceHeight: runtime.height, sourceName: name, sourceType: meta.sourceType || 'bitmap', svgViewBox: meta.svgViewBox || null }); this.exec(new C.AddNodesCommand([node], this.activePage().id, '导入图片')); this.state.selection.replace([node.id]); this.setTool('pointer'); this.renderAll(); return node;
  }

  importFonts(files) { return PE.fontImport?.importFonts?.(this, files) || Promise.resolve({ imported: 0, skipped: 0 }); }
  removeImportedFont(family) { return PE.fonts?.removeImportedFont?.(this, family) || false; }

  async registerFont(record) {
    if (typeof FontFace === 'undefined' || !record.assetId) return undefined; const key = `${record.assetId}:${record.family}`; if (this.fontFaceCache.has(key)) return this.fontFaceCache.get(key); const asset = this.state.assets.get(record.assetId); if (!asset) return undefined; const fontFace = new FontFace(record.family, `url(${asset.dataUrl})`), loaded = await fontFace.load(); document.fonts.add(loaded); this.fontFaceCache.set(key, loaded); return loaded;
  }

  hydrateAssets() { return PE.svgVectorRuntime?.hydrateAssets?.(this) || Promise.resolve(); }
  getToolDefaults(tool = this.tool) { if (!this.editorPreferences) this.editorPreferences = loadEditorPreferences(); return toolDefaults(this.editorPreferences, tool); }

  setToolDefault(tool, key, value) {
    if (!this.editorPreferences) this.editorPreferences = loadEditorPreferences(); this.editorPreferences = updateEditorPreferences(this.editorPreferences, { tools: { [tool]: { [key]: value } } }); saveEditorPreferences(this.editorPreferences); this.toolOptionsBar?.render?.(); if (key === 'width' && tool === this.tool && PE.canvasCursor?.cursorModeForTool?.(tool) === 'brush' && this.canvasCursorInside) this.renderOverlay(); return this.getToolDefaults(tool);
  }

  setTransparencyPreview(enabled) { if (!this.editorPreferences) this.editorPreferences = loadEditorPreferences(); this.editorPreferences = updateEditorPreferences(this.editorPreferences, { transparencyPreview: Boolean(enabled) }); saveEditorPreferences(this.editorPreferences); this.updateTransparencyPreviewButton?.(); this.renderOverlay(); return this.editorPreferences.transparencyPreview; }

  exportPng() {
    const framebuffer = R.FramebufferRenderer.renderPage(this.state.project, this.activePage().id, this.state.assets), canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300; const context = canvas.getContext('2d'), image = context.createImageData(400, 300); for (let index = 0; index < framebuffer.length; index += 1) { const value = framebuffer[index] ? 0 : 255, offset = index * 4; image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255; } context.putImageData(image, 0, 0); canvas.toBlob(blob => downloadBlob(blob, 'screen-400x300.png'), 'image/png'); return canvas;
  }

  async saveProject() {
    if (!this.state.projectFileName && typeof globalThis.showSaveFilePicker !== 'function') this.state.projectFileName = DEFAULT_FILENAME;
    if (typeof window.showSaveFilePicker === 'function') try { this.files = new P.ProjectFiles(this.state); await this.files.save(); this.autosave?.clear(); this.renderAll({ canvas: false }); return; } catch (error) { if (error?.name === 'AbortError') return; alert(`保存失败：${error.message}`); return; }
    const raw = P.ProjectSerializer.serialize(this.state.project, this.state.assets), name = this.state.projectFileName?.endsWith('.pix') ? this.state.projectFileName : DEFAULT_FILENAME; downloadBlob(new Blob([raw], { type: 'application/json' }), name); this.state.projectFileName = name; this.state.dirty = false; this.autosave?.clear(); this.renderAll({ canvas: false });
  }

  async openProject() {
    if (typeof window.showOpenFilePicker === 'function') try { this.files = new P.ProjectFiles(this.state); await this.files.open(); this.state.selection.clear(); this.pageSelectedId = this.state.project.activePageId; this.bus = new C.CommandBus(this.state, { limit: 100 }); await this.hydrateAssets(); this.autosave?.clear(); this.applyLayout(); this.renderAll(); return; } catch (error) { if (error?.name === 'AbortError') return; alert(`打开失败：${error.message}`); return; } $('#fileProject').click();
  }

  updateWorkspaceLayout(patch = {}) { return PE.workspaceLayout?.updateWorkspaceLayout?.(this, patch); }
  applyLayout() { return PE.workspaceLayout?.applyLayout?.(this, globalThis); }
  setupDockSplitters() { return PE.workspaceLayout?.setupDockSplitters?.(this, globalThis); }
  setupRulers() { window.addEventListener('resize', () => { this.applyLayout(); this.renderRulers(); }); }
  bucketFillTarget() { return PE.floodFill?.bucketFillTarget?.(this); }
  bucketFillRaster(node, point, settings) { return PE.floodFill?.bucketFillRaster?.(this, node, point, settings); }
  bucketFillPage(page, point, settings) { return PE.floodFill?.bucketFillPage?.(this, page, point, settings); }
  bucketFillImage(node, point, settings) { return PE.floodFill?.bucketFillImage?.(this, node, point, settings); }
  bucketFillAt(point) { return PE.floodFill?.bucketFillAt?.(this, point) || false; }
  applyCanvasCursor(options = {}) { return PE.canvasCursor?.applyCanvasCursor?.(this, options); }
  contextCommands() { return PE.contextMenu?.contextCommands?.(this) || []; }
  executeContextCommand(id, value) { return PE.contextMenu?.executeContextCommand?.(this, id, value) || false; }
  renderContextMenu() { return PE.contextMenu?.renderContextMenu?.(this); }
  openContextMenu(options = {}) { return PE.contextMenu?.openContextMenu?.(this, options) || false; }
  closeContextMenu() { return PE.contextMenu?.closeContextMenu?.(this); }
  onContextMenu(event) { event.preventDefault?.(); return PE.contextMenu?.onContextMenu?.(this, event) || false; }
  setupContextMenu() { this.nativeContextMenuCleanup?.(); PE.contextMenu?.setupContextMenu?.(this); this.nativeContextMenuCleanup = installNativeContextMenuBoundary(this, document); }

  subtreeIds(id) { const tree = new M.TreeModel(this.activePage()), ids = new Set(); const add = nodeId => { ids.add(nodeId); for (const child of tree.childrenOf(nodeId)) add(child.id); }; add(id); return ids; }

  subtreeAsset(id) {
    const page = this.activePage(), cut = R.FramebufferRenderer.subtreeRgba(this.state.project, page.id, id, this.state.assets), canvas = document.createElement('canvas'); canvas.width = cut.w; canvas.height = cut.h; const context = canvas.getContext('2d'), image = context.createImageData(cut.w, cut.h); image.data.set(cut.data); context.putImageData(image, 0, 0); return { ...cut, canvas };
  }

  rasterizeSelected() { return PE.rasterLayer?.rasterizeSelected?.(this, globalThis) || false; }
  async saveSelectedImage() { const id = this.state.selection.primaryId; if (!id) return; const asset = this.subtreeAsset(id); asset.canvas.toBlob(blob => downloadBlob(blob, `${M.nodeById(this.activePage(), id)?.name || 'element'}.png`), 'image/png'); }

  async copySelectedImage() {
    const id = this.state.selection.primaryId; if (!id) return false; try { const asset = this.subtreeAsset(id), blob = await new Promise(resolve => asset.canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('无法生成图片'); if (!navigator.clipboard?.write || !globalThis.ClipboardItem) { this.notice('当前浏览器不支持复制图片到系统剪贴板'); return false; } await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); this.notice('图片已复制到剪贴板'); return true; } catch (error) { this.notice(`复制图片失败：${error?.message || error}`); return false; }
  }

  notice(text) { const notice = $('#noticeText'); if (notice) notice.textContent = text; }
  countType(type) { return this.activePage().nodes.filter(node => node.type === type).length; }

  testApi() {
    return { version: 17, editor: this, getZoom: () => this.zoom, getTool: () => this.tool, getSelectionIds: () => [...this.state.selection.ids], getSelectionRects: () => this.selectionRects().map(item => ({ ...item })), getNode: id => structuredClone(M.nodeById(this.activePage(), id)), getNodePositions: () => Object.fromEntries(this.activePage().nodes.map(node => [node.id, { x: node.x ?? node.x1 ?? 0, y: node.y ?? node.y1 ?? 0 }])), historyCount: () => this.bus.entries.length, countType: type => this.countType(type), getActivePage: () => structuredClone(this.activePage()), getState: () => this.state, validateHierarchy: () => new M.TreeModel(this.activePage()).validateHierarchy(), serialize: () => P.ProjectSerializer.serialize(this.state.project, this.state.assets), pixFileType: () => P.PIX_FILE_TYPE, framebufferString: () => Array.from(R.FramebufferRenderer.renderPage(this.state.project, this.activePage().id, this.state.assets)).join(''), previewFramebufferBlackCount: () => this.lastFramebuffer.reduce((sum, bit) => sum + bit, 0), isPixelGridVisible: () => this.overlay.classList.contains('pixel-grid'), createNode: (type, props = {}) => { const node = M.createNode(type, { ...props, parentId: props.parentId ?? this.activePage().id }); this.exec(new C.AddNodesCommand([node], this.activePage().id)); this.state.selection.replace([node.id]); this.pageSelectedId = null; this.renderAll(); return node.id; } };
  }
}

export { Workspace };
