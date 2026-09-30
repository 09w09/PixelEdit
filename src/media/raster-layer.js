import {
  RASTER_TRANSPARENT,
  RASTER_WHITE,
  RASTER_BLACK,
  RASTER_ENCODING,
  createTriStateRaster,
  decodeTriStatePixels,
  pixelsFromRasterNode,
  paintTriStateRaster,
  resizeTriStateRaster,
  triStatePixelsToRgba,
} from '../raster/tristate-raster.js';

function adaptRasterProject(project, assets) {
  const clone = structuredClone(project);
  const runtimes = new Map();
  for (const page of clone.pages || []) {
    for (const node of page.nodes || []) {
      if (node.type !== 'raster') continue;
      const id = `__pixeledit_raster__${node.id}`;
      const pixels = pixelsFromRasterNode(node);
      runtimes.set(id, {
        width: node.w,
        height: node.h,
        data: triStatePixelsToRgba(pixels, node.w, node.h),
      });
      node.type = 'image';
      node.assetId = id;
      node.sourceWidth = node.w;
      node.sourceHeight = node.h;
      node.sourceType = 'raster-runtime';
      node.sourceName = '';
      node.svgViewBox = null;
      node.image = {
        fit: 'stretch', interpolation: 'nearest', cropX: 0, cropY: 0,
        cropW: node.w, cropH: node.h,
        bwMode: 'threshold', threshold: 128, invert: false,
        ditherAlgorithm: 'bayer', bayerMatrix: 4,
      };
      node.overlay = {};
      delete node.raster;
    }
  }
  const proxy = Object.create(assets || null);
  proxy.getRuntime = id => runtimes.get(id) || assets?.getRuntime?.(id) || null;
  proxy.get = id => assets?.get?.(id) || null;
  return { project: clone, assets: proxy };
}

function rasterizeSubtree({ project, pageId, nodeId, assets, framebufferRenderer }) {
  const cut = framebufferRenderer.subtreeRgba(project, pageId, nodeId, assets);
  const pixels = new Uint8Array(cut.w * cut.h);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    const alpha = cut.data[offset + 3];
    if (alpha === 0) {
      pixels[index] = RASTER_TRANSPARENT;
      continue;
    }
    const luma = cut.data[offset] * 0.299 + cut.data[offset + 1] * 0.587 + cut.data[offset + 2] * 0.114;
    pixels[index] = luma < 128 ? RASTER_BLACK : RASTER_WHITE;
  }
  return { x: cut.x, y: cut.y, w: cut.w, h: cut.h, pixels };
}

function validateRasterProject(project) {
  for (const page of project.pages || []) {
    for (const node of page.nodes || []) {
      if (node.type !== 'raster') continue;
      if (!node.raster || node.raster.encoding !== RASTER_ENCODING) throw new Error('V16 栅格数据格式无效');
      decodeTriStatePixels(node.raster.data, node.w, node.h);
    }
  }
  return project;
}

function installRasterLayerRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const R = PE?.renderer;
  const P = PE?.persistence;
  const Workspace = PE?.ui?.Workspace;
  const Properties = PE?.ui?.Properties;
  if (!M?.createNode || !R?.FramebufferRenderer || !Workspace || !PE?.tristateRaster) throw new Error('PixelEditor tri-state raster dependencies are not initialized');
  if (PE.rasterLayerInstalled) return;
  PE.rasterLayerInstalled = true;

  const originalCreateNode = M.createNode;
  M.createNode = function createNode(type, props = {}) {
    if (type !== 'raster') return originalCreateNode(type, props);
    const w = Math.max(1, Math.round(Number(props.w) || 40));
    const h = Math.max(1, Math.round(Number(props.h) || 30));
    let raster;
    if (props.raster) {
      if (props.raster.encoding !== RASTER_ENCODING) throw new Error('V16 栅格数据格式无效');
      raster = structuredClone(props.raster);
      decodeTriStatePixels(raster.data, w, h);
    } else {
      raster = createTriStateRaster(w, h, props.pixels || null, RASTER_TRANSPARENT);
    }
    return {
      id: props.id || M.nextId('raster'),
      type: 'raster',
      name: props.name || '栅格',
      parentId: props.parentId ?? null,
      visible: props.visible !== false,
      locked: Boolean(props.locked),
      x: Math.round(Number(props.x) || 0),
      y: Math.round(Number(props.y) || 0),
      w,
      h,
      aspectLocked: Boolean(props.aspectLocked),
      transform: structuredClone(props.transform || { rotation: 0, flipX: false, flipY: false }),
      raster,
    };
  };

  if (P?.ProjectSerializer) {
    const originalSerialize = P.ProjectSerializer.serialize.bind(P.ProjectSerializer);
    const originalDeserialize = P.ProjectSerializer.deserialize.bind(P.ProjectSerializer);
    P.ProjectSerializer.serialize = function serializeRasterV16(project, assets) {
      validateRasterProject(project);
      return originalSerialize(project, assets);
    };
    P.ProjectSerializer.deserialize = function deserializeRasterV16(raw) {
      const result = originalDeserialize(raw);
      validateRasterProject(result.project);
      return result;
    };
  }

  const framebuffer = R.FramebufferRenderer;
  const originalRenderPage = framebuffer.renderPage;
  const originalRenderSubtree = framebuffer.renderSubtree;
  const originalSubtreeRgba = framebuffer.subtreeRgba;
  framebuffer.renderPage = function renderPage(project, pageId, assets) {
    const adapted = adaptRasterProject(project, assets);
    return originalRenderPage(adapted.project, pageId, adapted.assets);
  };
  framebuffer.renderSubtree = function renderSubtree(project, pageId, nodeId, assets, base = 0) {
    const adapted = adaptRasterProject(project, assets);
    return originalRenderSubtree(adapted.project, pageId, nodeId, adapted.assets, base);
  };
  framebuffer.subtreeRgba = function subtreeRgba(project, pageId, nodeId, assets) {
    const adapted = adaptRasterProject(project, assets);
    return originalSubtreeRgba(adapted.project, pageId, nodeId, adapted.assets);
  };

  const originalPaintTarget = Workspace.prototype.paintTarget;
  Workspace.prototype.paintTarget = function paintTarget() {
    const page = this.activePage();
    const id = this.state.selection.primaryId;
    const node = M.nodeById(page, id);
    const tree = new M.TreeModel(page);
    if (node) {
      if (node.type !== 'raster' || tree.isEffectivelyLocked(node.id) || !tree.isEffectivelyVisible(node.id)) return null;
      return { kind: 'node', node };
    }
    return originalPaintTarget.call(this);
  };

  const originalBeginPaint = Workspace.prototype.beginPaint;
  Workspace.prototype.beginPaint = function beginPaint(point) {
    const targetInfo = this.paintTarget();
    if (!targetInfo || targetInfo.kind !== 'node' || targetInfo.node.type !== 'raster') {
      return originalBeginPaint.call(this, point);
    }
    const pencilColor = this.getToolDefaults?.('pencil')?.color === 0 ? RASTER_WHITE : RASTER_BLACK;
    this.notice('');
    this.customGesture = {
      type: 'paint',
      targetKind: 'raster',
      nodeId: targetInfo.node.id,
      pageId: this.activePage().id,
      value: this.tool === 'eraser' ? RASTER_TRANSPARENT : pencilColor,
      start: point,
      last: point,
      lastPaint: point,
      originalRaster: structuredClone(targetInfo.node.raster),
      changed: false,
    };
    this.applyPaintSegment(this.customGesture, point, point);
    this.renderCanvas();
    return true;
  };

  const originalApplyPaintSegment = Workspace.prototype.applyPaintSegment;
  Workspace.prototype.applyPaintSegment = function applyPaintSegment(gesture, a, b) {
    if (gesture.targetKind !== 'raster') return originalApplyPaintSegment.call(this, gesture, a, b);
    const node = M.nodeById(this.activePage(), gesture.nodeId);
    if (!node || node.type !== 'raster') return false;
    const points = this.linePoints(a, b).map(point => ({ x: point.x - node.x, y: point.y - node.y }));
    const before = node.raster.data;
    node.raster = paintTriStateRaster(node, points, gesture.value);
    const changed = node.raster.data !== before;
    gesture.changed ||= changed;
    return changed;
  };

  const originalCommitPaint = Workspace.prototype.commitPaint;
  Workspace.prototype.commitPaint = function commitPaint(gesture) {
    if (gesture.targetKind !== 'raster') return originalCommitPaint.call(this, gesture);
    const page = this.activePage();
    const node = M.nodeById(page, gesture.nodeId);
    if (!node) return false;
    const finalRaster = structuredClone(node.raster);
    node.raster = structuredClone(gesture.originalRaster);
    if (!gesture.changed) return false;
    const label = gesture.value === RASTER_TRANSPARENT ? '栅格橡皮' : gesture.value === RASTER_WHITE ? '栅格白色铅笔' : '栅格黑色铅笔';
    return this.exec(new C.UpdateNodesCommand([node.id], { raster: finalRaster }, page.id, label));
  };

  const originalCancelCustomGesture = Workspace.prototype.cancelCustomGesture;
  Workspace.prototype.cancelCustomGesture = function cancelCustomGesture() {
    const gesture = this.customGesture;
    if (gesture?.type === 'paint' && gesture.targetKind === 'raster') {
      const node = M.nodeById(this.activePage(), gesture.nodeId);
      if (node) node.raster = structuredClone(gesture.originalRaster);
      this.customGesture = null;
      this.overlayState = {};
      this.renderCanvas();
      return;
    }
    return originalCancelCustomGesture.call(this);
  };

  Workspace.prototype.rasterizeSelected = async function rasterizeSelected() {
    const page = this.activePage();
    const id = this.state.selection.primaryId;
    const node = M.nodeById(page, id);
    const tree = new M.TreeModel(page);
    if (!node || tree.isEffectivelyLocked(id)) return false;
    const children = tree.childrenOf(id);
    if (node.type === 'raster' && children.length === 0) return false;
    if (typeof confirm === 'function' && !confirm('确认将该图层及其所有子图层栅格化为固定像素图层吗？')) return false;
    const cut = rasterizeSubtree({
      project: this.state.project,
      pageId: page.id,
      nodeId: id,
      assets: this.state.assets,
      framebufferRenderer: R.FramebufferRenderer,
    });
    const replacement = M.createNode('raster', {
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      visible: node.visible,
      locked: node.locked,
      x: cut.x,
      y: cut.y,
      w: cut.w,
      h: cut.h,
      pixels: cut.pixels,
      transform: node.transform,
    });
    const ids = new Set([id, ...tree.descendantsOf(id).map(item => item.id)]);
    const index = page.nodes.findIndex(item => item.id === id);
    return this.exec({
      label: '栅格化图层',
      execute: () => {
        page.nodes = page.nodes.filter(item => !ids.has(item.id));
        page.nodes.splice(Math.min(index, page.nodes.length), 0, replacement);
        this.state.selection.replace([replacement.id]);
        return true;
      },
    });
  };

  const originalSetSelectionSize = Workspace.prototype.setSelectionSize;
  Workspace.prototype.setSelectionSize = function setSelectionSize(axis, target) {
    const page = this.activePage();
    const rasterIds = this.state.selection.ids.filter(id => M.nodeById(page, id)?.type === 'raster');
    if (!rasterIds.length) return originalSetSelectionSize.call(this, axis, target);
    target = Math.max(1, Math.round(Number(target)));
    if (!Number.isFinite(target)) return false;
    return this.exec(new C.UpdateNodesCommand(rasterIds, node => {
      const geometry = { x: node.x, y: node.y, w: node.w, h: node.h };
      if (axis === 'w') geometry.w = target;
      else geometry.h = target;
      if (node.aspectLocked) {
        const ratio = node.w / Math.max(1, node.h);
        if (axis === 'w') geometry.h = Math.max(1, Math.round(target / ratio));
        else geometry.w = Math.max(1, Math.round(target * ratio));
      }
      return resizeTriStateRaster(node, geometry);
    }, page.id, '调整栅格尺寸'));
  };

  const originalCommitLiveHandle = Workspace.prototype.commitLiveHandle;
  Workspace.prototype.commitLiveHandle = function commitLiveHandle(gesture) {
    const page = this.activePage();
    const node = M.nodeById(page, gesture.nodeId);
    if (gesture.type !== 'resize-live' || node?.type !== 'raster') return originalCommitLiveHandle.call(this, gesture);
    const geometry = { x: node.x, y: node.y, w: node.w, h: node.h };
    const original = structuredClone(gesture.original);
    Object.assign(node, original);
    const patch = resizeTriStateRaster(original, geometry);
    return this.exec(new C.UpdateNodesCommand([gesture.nodeId], patch, page.id, '调整栅格大小'));
  };

  if (Properties) {
    const originalTransform = Properties.prototype.transform;
    Properties.prototype.transform = function transform(nodes, locked) {
      const adapted = nodes.map(node => node.type === 'raster' ? { ...node, type: 'image' } : node);
      return originalTransform.call(this, adapted, locked);
    };
    const originalTypeFields = Properties.prototype.typeFields;
    Properties.prototype.typeFields = function typeFields(nodes, locked) {
      if (nodes[0]?.type === 'raster') {
        return '<div class="property-section"><h4>栅格</h4><div class="muted">固定像素画布：黑、白、透明三态。铅笔写入黑/白，橡皮写入透明；调整边框只扩展透明区域或裁剪，不重采样。</div></div>';
      }
      return originalTypeFields.call(this, nodes, locked);
    };
    const originalBind = Properties.prototype.bind;
    Properties.prototype.bind = function bind(nodes, locked) {
      const changed = [];
      for (const node of nodes) if (node.type === 'raster') { changed.push(node); node.type = 'image'; }
      try { return originalBind.call(this, nodes, locked); }
      finally { for (const node of changed) node.type = 'raster'; }
    };
  }

  PE.rasterLayer = {
    encoding: RASTER_ENCODING,
    decodeRasterPixels: decodeTriStatePixels,
    createRasterPayload: createTriStateRaster,
    paintRaster: paintTriStateRaster,
    resizeRaster: resizeTriStateRaster,
    rasterizeSubtree,
    validateRasterProject,
  };
}

export {
  RASTER_ENCODING,
  rasterizeSubtree,
  validateRasterProject,
  installRasterLayerRuntime,
};
