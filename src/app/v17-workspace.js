import { FontManager } from '../fonts/font-manager.js';
import {
  DEFAULT_FILENAME,
  loadEditorPreferences,
  saveEditorPreferences,
  updateEditorPreferences,
} from '../preferences/editor-preferences.js';
import { installNativeContextMenuBoundary } from '../ui/context-menu-boundary.js';
import { ToolOptionsBar, installGlobalToolbar } from '../tools/tool-options-bar.js';
import { toolDefaults } from '../tools/tool-state.js';

const BOX_TYPES = new Set(['rectangle', 'circle', 'text', 'image', 'raster']);
const EDGE_CORNERS = new Set(['n', 'e', 's', 'w']);

function liveNode(editor, gesture, Model) {
  return gesture?.nodeId ? Model.nodeById(editor.activePage(), gesture.nodeId) : null;
}

function reanchorTransform(editor, node, gesture, anchorLocal, anchorWorld, PE) {
  const T = PE.transformModel;
  const G = PE.selectionGeometry;
  const base = T.normalizeTransform(gesture?.original?.transform || node.transform);
  node.transform = base;
  const nextPivot = PE.selectionOverlay?.sourcePivotBounds?.(editor, node) || G.sourceGeometryBounds(node);
  const currentAnchor = G.localToWorld(node, anchorLocal, nextPivot);
  node.transform = T.normalizeTransform({
    ...base,
    translateX: (base.translateX || 0) + anchorWorld.x - currentAnchor.x,
    translateY: (base.translateY || 0) + anchorWorld.y - currentAnchor.y,
  });
}

function installV17WorkspaceClass(target = globalThis) {
  const PE = target.PixelEditor;
  const BaseWorkspace = PE?.ui?.Workspace;
  if (!BaseWorkspace) throw new Error('PixelEditor workspace is not initialized');
  if (PE.v17WorkspaceInstalled) return PE.ui.Workspace;
  PE.v17WorkspaceInstalled = true;

  const M = PE.model;
  const C = PE.commands;
  const T = PE.transformModel;
  const G = PE.selectionGeometry;

  const capability = (name, editor, ...args) => {
    const fn = PE.workspaceCapabilities?.[name];
    if (typeof fn !== 'function') throw new Error(`PixelEditor workspace capability is not registered: ${name}`);
    return fn(editor, ...args);
  };

  class V17Workspace extends BaseWorkspace {
    mount() {
      if (!this.editorPreferences) this.editorPreferences = loadEditorPreferences();
      if (!this.fontManager) this.fontManager = new FontManager({ editor: this, document: target.document });
      const result = super.mount();
      const element = installGlobalToolbar(this);
      this.toolOptionsBar = new ToolOptionsBar(this, element);
      this.toolOptionsBar.render();
      return result || this;
    }

    renderAll(options = {}) {
      this.fontManager?.sync(this.state.project.fonts || []);
      const result = super.renderAll(options);
      const status = target.document?.querySelector?.('#statusText');
      if (status) status.textContent = '400×300 · 1-bit · V17';
      if (target.document) {
        target.document.title = `400×300 黑白像素编辑器 V17${this.state?.dirty ? ' *' : ''}`;
        target.document.documentElement.dataset.pixelEditor = 'v17';
      }
      if (target.PixelEditorTest) target.PixelEditorTest.version = 17;
      this.toolOptionsBar?.render?.();
      return result;
    }

    testApi() {
      const api = super.testApi();
      api.version = 17;
      return api;
    }

    async saveProject() {
      if (!this.state.projectFileName && typeof target.showSaveFilePicker !== 'function') {
        this.state.projectFileName = DEFAULT_FILENAME;
      }
      return super.saveProject();
    }

    setupKeyboard() {
      super.setupKeyboard();
      if (this.structuredClipboardKeyHandler) return;
      this.structuredClipboardKeyHandler = event => {
        const mod = event.ctrlKey || event.metaKey;
        if (!mod) return;
        const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable;
        if (editing) return;
        const key = event.key.toLowerCase();
        if (key === 'a') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.selectAllOnPage?.();
        } else if (key === 'c' && this.state.selection.ids.length) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.copySelection?.();
        } else if (key === 'v' && this.clipboard.hasPayload?.()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.pasteClipboard?.();
        } else if (key === 'd') {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };
      target.addEventListener?.('keydown', this.structuredClipboardKeyHandler, true);
    }

    setupCanvas() {
      const result = super.setupCanvas();
      this.canvasCursorInside = false;
      this.canvasCursorPoint = null;
      this.canvas?.addEventListener('pointerenter', event => {
        this.canvasCursorInside = true;
        this.canvasCursorPoint = this.logicalPoint(event);
        this.applyCanvasCursor?.({ resetNative: true });
        if (PE.canvasCursor?.cursorModeForTool?.(this.tool) === 'brush') this.renderOverlay?.();
      });
      this.canvas?.addEventListener('pointerleave', () => {
        this.canvasCursorInside = false;
        this.canvasCursorPoint = null;
        if (PE.canvasCursor?.cursorModeForTool?.(this.tool) === 'brush') this.renderOverlay?.();
      });
      return result;
    }

    setupFiles() {
      const result = super.setupFiles();
      const input = target.document?.querySelector?.('#fileImage');
      const resetImageTool = () => {
        if (this.tool === 'image') this.setTool('pointer');
      };
      input?.addEventListener('cancel', resetImageTool);
      input?.addEventListener('change', () => {
        if (!input.files?.length) resetImageTool();
      });
      return result;
    }

    async importImageFile(...args) {
      try {
        return await super.importImageFile(...args);
      } finally {
        if (this.tool === 'image') this.setTool('pointer');
      }
    }

    getToolDefaults(tool = this.tool) {
      if (!this.editorPreferences) this.editorPreferences = loadEditorPreferences();
      return toolDefaults(this.editorPreferences, tool);
    }

    setToolDefault(tool, key, value) {
      if (!this.editorPreferences) this.editorPreferences = loadEditorPreferences();
      this.editorPreferences = updateEditorPreferences(this.editorPreferences, { tools: { [tool]: { [key]: value } } });
      saveEditorPreferences(this.editorPreferences);
      this.toolOptionsBar?.render?.();
      if (
        key === 'width'
        && tool === this.tool
        && PE.canvasCursor?.cursorModeForTool?.(tool) === 'brush'
        && this.canvasCursorInside
      ) this.renderOverlay?.();
      return this.getToolDefaults(tool);
    }

    setTransparencyPreview(enabled) {
      if (!this.editorPreferences) this.editorPreferences = loadEditorPreferences();
      this.editorPreferences = updateEditorPreferences(this.editorPreferences, { transparencyPreview: Boolean(enabled) });
      saveEditorPreferences(this.editorPreferences);
      this.updateTransparencyPreviewButton?.();
      this.renderOverlay?.();
      return this.editorPreferences.transparencyPreview;
    }

    beginLiveDraw(tool, point) {
      const integerPoint = M.integerPoint?.(point) || point;
      const result = super.beginLiveDraw(tool, integerPoint);
      if (!result && !this.customGesture) return result;
      const node = liveNode(this, this.customGesture, M);
      if (!node) return result;
      M.normalizeNodeGeometry?.(node);
      if (tool === 'text') {
        const settings = this.getToolDefaults('text');
        const resolved = PE.fontOptions?.resolveTextToolSelection?.(settings, this.state.project, settings.fontFamily) || {
          fontFamily: settings.fontFamily || 'sans-serif', fontSize: settings.fontSize || 16, fixed: false,
        };
        node.fontFamily = resolved.fontFamily;
        node.fontSize = resolved.fontSize;
        node.fixedFontSize = resolved.fixed ? resolved.fontSize : null;
        node.alignH = ['left', 'center', 'right'].includes(settings.alignH) ? settings.alignH : 'left';
        node.alignV = ['top', 'middle', 'bottom'].includes(settings.alignV) ? settings.alignV : 'top';
        this.renderCanvas?.();
        return result;
      }
      if (!['line', 'rectangle', 'circle', 'polygon'].includes(tool)) return result;
      const settings = this.getToolDefaults(tool);
      node.stroke = PE.strokeStyle?.normalizeStroke?.(settings)
        || PE.schemaV17?.normalizeStroke?.(settings)
        || { width: 1, color: 1, style: 'solid' };
      if (tool !== 'line') node.fill = PE.schemaV17?.normalizeFill?.(settings.fill) || { mode: 'transparent', color: 1 };
      this.renderCanvas?.();
      return result;
    }

    updateLiveDraw(gesture, point) {
      const result = super.updateLiveDraw(gesture, M.integerPoint?.(point) || point);
      M.normalizeNodeGeometry?.(liveNode(this, gesture, M));
      return result;
    }

    commitLiveDraw(gesture) {
      M.normalizeNodeGeometry?.(liveNode(this, gesture, M));
      const result = super.commitLiveDraw(gesture);
      M.normalizeNodeGeometry?.(liveNode(this, gesture, M));
      return result;
    }

    paintTarget() {
      const page = this.activePage();
      const node = M.nodeById(page, this.state.selection.primaryId);
      const tree = new M.TreeModel(page);
      if (node) {
        if (node.type !== 'raster') return null;
        if (tree.isEffectivelyLocked(node.id) || !tree.isEffectivelyVisible(node.id)) return null;
        return { kind: 'node', node };
      }
      if (!page.locked) return { kind: 'page', page };
      return null;
    }

    applyPaintSegment(gesture, a, b) {
      if (!gesture || (gesture.targetKind !== 'page' && gesture.targetKind !== 'raster')) {
        return super.applyPaintSegment(gesture, a, b);
      }
      const path = this.linePoints(a, b);
      if (gesture.targetKind === 'page') {
        const points = PE.paintBrush.expandBrushPoints(path, gesture.brushWidth);
        const page = this.activePage();
        page.overlay ||= {};
        let changed = false;
        for (const pixel of points) {
          if (pixel.x < 0 || pixel.y < 0 || pixel.x >= 400 || pixel.y >= 300) continue;
          const key = `${pixel.x},${pixel.y}`;
          if (page.overlay[key] === gesture.value) continue;
          page.overlay[key] = gesture.value;
          changed = true;
        }
        gesture.changed ||= changed;
        return changed;
      }
      const node = M.nodeById(this.activePage(), gesture.nodeId);
      if (!node || node.type !== 'raster') return false;
      const localPath = path
        .map(point => PE.selectionTransform.screenPointToRasterPixel(node, point))
        .filter(Boolean)
        .map(point => ({ x: point.x, y: point.y }));
      const localPoints = PE.paintBrush.expandBrushPoints(localPath, gesture.brushWidth);
      const before = node.raster.data;
      node.raster = PE.tristateRaster.paintTriStateRaster(node, localPoints, gesture.value);
      const changed = node.raster.data !== before;
      gesture.changed ||= changed;
      return changed;
    }

    commitPaint(gesture) {
      if (gesture?.targetKind === 'page') {
        const page = this.activePage();
        const finalOverlay = structuredClone(page.overlay || {});
        page.overlay = structuredClone(gesture.originalOverlay || {});
        if (!gesture.changed) return false;
        const label = gesture.tool === 'eraser' ? '背景橡皮' : gesture.value === 0 ? '背景白色铅笔' : '背景黑色铅笔';
        return this.exec(new C.UpdatePageCommand(page.id, { overlay: finalOverlay }, label));
      }
      if (gesture?.targetKind === 'raster') {
        const page = this.activePage();
        const node = M.nodeById(page, gesture.nodeId);
        if (!node) return false;
        const finalRaster = structuredClone(node.raster);
        node.raster = structuredClone(gesture.originalRaster);
        if (!gesture.changed) return false;
        const label = gesture.tool === 'eraser'
          ? '栅格橡皮'
          : gesture.value === PE.tristateRaster.RASTER_WHITE ? '栅格白色铅笔' : '栅格黑色铅笔';
        return this.exec(new C.UpdateNodesCommand([node.id], { raster: finalRaster }, page.id, label));
      }
      return super.commitPaint(gesture);
    }

    cancelCustomGesture() {
      const gesture = this.customGesture;
      if (gesture?.type === 'paint' && gesture.targetKind === 'raster') {
        const node = M.nodeById(this.activePage(), gesture.nodeId);
        if (node) node.raster = structuredClone(gesture.originalRaster);
        this.customGesture = null;
        this.overlayState = {};
        this.renderCanvas();
        return;
      }
      return super.cancelCustomGesture();
    }

    setSelectionSize(axis, targetValue) {
      const page = this.activePage();
      const ids = this.state.selection.ids.filter(id => BOX_TYPES.has(M.nodeById(page, id)?.type));
      if (!ids.some(id => M.nodeById(page, id)?.type === 'raster')) return super.setSelectionSize(axis, targetValue);
      const targetSize = Math.max(1, Math.round(Number(targetValue)));
      if (!ids.length || !Number.isFinite(targetSize)) return false;
      return this.exec(new C.UpdateNodesCommand(ids, node => {
        const ratio = node.w / Math.max(1, node.h);
        let w = node.w;
        let h = node.h;
        if (axis === 'w') {
          w = targetSize;
          if (node.aspectLocked) h = Math.max(1, Math.round(targetSize / ratio));
        } else {
          h = targetSize;
          if (node.aspectLocked) w = Math.max(1, Math.round(targetSize * ratio));
        }
        if (node.type === 'raster') return PE.rasterLayer.resizeRaster(node, { x: node.x, y: node.y, w, h });
        const patch = {};
        if (w !== node.w) patch.w = w;
        if (h !== node.h) patch.h = h;
        return patch;
      }, page.id, '调整尺寸'));
    }

    beginLiveHandle(handle, point) {
      const pivotBounds = handle?.node ? PE.selectionOverlay?.sourcePivotBounds?.(this, handle.node) : null;
      const result = super.beginLiveHandle(handle, point);
      if (this.customGesture && handle?.node && this.customGesture.nodeId === handle.node.id) this.customGesture.pivotBounds = pivotBounds;
      return result;
    }

    updateLiveResize(gesture, point) {
      const node = M.nodeById(this.activePage(), gesture.nodeId);
      if (!node || !BOX_TYPES.has(node.type)) return super.updateLiveResize(gesture, point);
      const b = gesture.startBounds;
      const left = b.x, top = b.y, right = b.x + b.w, bottom = b.y + b.h;
      const mappingNode = gesture.original || node;
      const pivot = gesture.pivotBounds || G.sourceGeometryBounds(mappingNode);
      const raw = G.worldToLocal(mappingNode, point, pivot);
      const local = { x: Math.round(raw.x), y: Math.round(raw.y) };
      let x = left, y = top, w = b.w, h = b.h;
      let anchorLocal;
      if (EDGE_CORNERS.has(gesture.corner)) {
        const centerX = left + b.w / 2, centerY = top + b.h / 2;
        const ratio = b.w / Math.max(1, b.h);
        if (gesture.corner === 'e' || gesture.corner === 'w') {
          const anchorX = gesture.corner === 'e' ? left : right;
          w = Math.max(1, Math.abs(local.x - anchorX));
          x = gesture.corner === 'w' ? Math.round(anchorX - w) : Math.round(anchorX);
          anchorLocal = { x: anchorX, y: centerY };
          if (node.aspectLocked) { h = Math.max(1, Math.round(w / Math.max(1e-9, ratio))); y = Math.round(centerY - h / 2); }
        } else {
          const anchorY = gesture.corner === 's' ? top : bottom;
          h = Math.max(1, Math.abs(local.y - anchorY));
          y = gesture.corner === 'n' ? Math.round(anchorY - h) : Math.round(anchorY);
          anchorLocal = { x: centerX, y: anchorY };
          if (node.aspectLocked) { w = Math.max(1, Math.round(h * ratio)); x = Math.round(centerX - w / 2); }
        }
      } else {
        const west = gesture.corner.includes('w');
        const north = gesture.corner.includes('n');
        const anchorX = west ? right : left;
        const anchorY = north ? bottom : top;
        anchorLocal = { x: anchorX, y: anchorY };
        w = Math.max(1, Math.abs(local.x - anchorX));
        h = Math.max(1, Math.abs(local.y - anchorY));
        if (node.aspectLocked) {
          const ratio = b.w / Math.max(1, b.h), sx = w / Math.max(1, b.w), sy = h / Math.max(1, b.h);
          if (sx >= sy) h = Math.max(1, Math.round(w / ratio)); else w = Math.max(1, Math.round(h * ratio));
        }
        x = Math.round(west ? anchorX - w : anchorX);
        y = Math.round(north ? anchorY - h : anchorY);
      }
      const anchorWorld = G.localToWorld(mappingNode, anchorLocal, pivot);
      const geometry = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      if (node.type === 'raster') Object.assign(node, PE.rasterLayer.resizeRaster(gesture.original, geometry));
      else Object.assign(node, geometry);
      reanchorTransform(this, node, gesture, anchorLocal, anchorWorld, PE);
      this.renderCanvas();
      this.renderOverlay();
      this.properties.render();
    }

    updateLivePoint(gesture, point) {
      const node = M.nodeById(this.activePage(), gesture.nodeId);
      if (!node || (node.type !== 'line' && node.type !== 'polygon')) return super.updateLivePoint(gesture, point);
      const mappingNode = gesture.original || node;
      const pivot = gesture.pivotBounds || G.sourceGeometryBounds(mappingNode);
      const raw = G.worldToLocal(mappingNode, point, pivot);
      const local = { x: Math.round(raw.x), y: Math.round(raw.y) };
      let anchorLocal = null;
      if (node.type === 'line') anchorLocal = gesture.index === 0 ? { x: mappingNode.x2, y: mappingNode.y2 } : { x: mappingNode.x1, y: mappingNode.y1 };
      else {
        const anchorIndex = (mappingNode.points || []).findIndex((_, index) => index !== gesture.index);
        if (anchorIndex >= 0) anchorLocal = { ...mappingNode.points[anchorIndex] };
      }
      const anchorWorld = anchorLocal ? G.localToWorld(mappingNode, anchorLocal, pivot) : null;
      if (node.type === 'polygon') node.points[gesture.index] = local;
      else if (gesture.index === 0) { node.x1 = local.x; node.y1 = local.y; }
      else { node.x2 = local.x; node.y2 = local.y; }
      if (anchorLocal && anchorWorld) reanchorTransform(this, node, gesture, anchorLocal, anchorWorld, PE);
      else node.transform = T.normalizeTransform(mappingNode.transform);
      this.renderCanvas();
      this.renderOverlay();
      this.properties.render();
    }

    commitLiveHandle(gesture) {
      if (!gesture || !['resize-live', 'polygon-point-live', 'line-point-live'].includes(gesture.type)) return super.commitLiveHandle(gesture);
      const page = this.activePage();
      const node = M.nodeById(page, gesture.nodeId);
      if (!node || !gesture.original) return false;
      let patch;
      if (gesture.type === 'resize-live') {
        patch = { x: node.x, y: node.y, w: node.w, h: node.h, transform: structuredClone(T.normalizeTransform(node.transform)) };
        if (node.type === 'raster' && node.raster) patch.raster = structuredClone(node.raster);
      } else if (gesture.type === 'polygon-point-live') {
        patch = { points: structuredClone(node.points), transform: structuredClone(T.normalizeTransform(node.transform)) };
      } else {
        patch = { x1: node.x1, y1: node.y1, x2: node.x2, y2: node.y2, transform: structuredClone(T.normalizeTransform(node.transform)) };
      }
      Object.assign(node, structuredClone(gesture.original));
      return this.exec(new C.UpdateNodesCommand([gesture.nodeId], patch, page.id, gesture.type === 'resize-live' ? '调整大小' : '移动控制点'));
    }

    onPointerMove(event) {
      const result = super.onPointerMove(event);
      if (this.tool !== 'pointer' || this.customGesture || this.spaceDown || this.interaction?.mode !== 'Idle') return result;
      const point = this.logicalPointFloat(event);
      const handle = this.selectionHandleAt(point);
      if (handle?.type !== 'resize' || !handle.node) return result;
      const pivot = PE.selectionOverlay?.sourcePivotBounds?.(this, handle.node);
      this.canvas.style.cursor = PE.photopeaTransformUI?.resizeCursorForHandle?.(handle.node, handle.corner, pivot, G) || 'default';
      return result;
    }

    copySelection() { return capability('copySelection', this); }
    pasteClipboard() { return capability('pasteClipboard', this); }
    selectAllOnPage() { return capability('selectAllOnPage', this); }
    importFonts(files) { return capability('importFonts', this, files); }
    removeImportedFont(family) { return capability('removeImportedFont', this, family); }
    importSvgText(text, name = 'svg', options = {}) { return capability('importSvgText', this, text, name, options); }
    hydrateAssets() { return capability('hydrateAssets', this); }
    rasterizeSelected() { return capability('rasterizeSelected', this); }
    updateWorkspaceLayout(patch = {}) { return capability('updateWorkspaceLayout', this, patch); }
    applyLayout() { return capability('applyLayout', this); }
    setupDockSplitters() { return capability('setupDockSplitters', this); }
    bucketFillTarget() { return capability('bucketFillTarget', this); }
    bucketFillRaster(node, point, settings) { return capability('bucketFillRaster', this, node, point, settings); }
    bucketFillPage(page, point, settings) { return capability('bucketFillPage', this, page, point, settings); }
    bucketFillImage(node, point, settings) { return capability('bucketFillImage', this, node, point, settings); }
    bucketFillAt(point) { return capability('bucketFillAt', this, point); }
    renderOverlay() { return capability('renderOverlay', this); }
    selectionHandleAt(point) { return capability('selectionHandleAt', this, point); }
    applyCanvasCursor(options = {}) { return capability('applyCanvasCursor', this, options); }
    runSelectionTransform(action, value = 0) { return capability('runSelectionTransform', this, action, value); }
    align(mode) { return capability('align', this, mode); }
    distribute(axis) { return capability('distribute', this, axis); }
    contextCommands() { return capability('contextCommands', this); }
    executeContextCommand(id, value) { return capability('executeContextCommand', this, id, value); }
    renderContextMenu() { return capability('renderContextMenu', this); }
    openContextMenu(options = {}) { return capability('openContextMenu', this, options); }
    closeContextMenu() { return capability('closeContextMenu', this); }
    onContextMenu(event) { return capability('onContextMenu', this, event); }

    setupContextMenu() {
      this.nativeContextMenuCleanup?.();
      const result = capability('setupContextMenu', this);
      this.nativeContextMenuCleanup = installNativeContextMenuBoundary(this, target.document);
      return result;
    }
  }

  PE.ui.BaseWorkspace = BaseWorkspace;
  PE.ui.Workspace = V17Workspace;
  return V17Workspace;
}

export { installV17WorkspaceClass };
