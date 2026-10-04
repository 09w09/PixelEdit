import {
  RASTER_TRANSPARENT,
  RASTER_WHITE,
  RASTER_BLACK,
  RASTER_ENCODING,
  createTriStateRaster,
  decodeTriStatePixels,
  paintTriStateRaster,
  resizeTriStateRaster,
} from '../raster/tristate-raster.js';

function rasterizeSubtree({ project, pageId, nodeId, assets, framebufferRenderer }) {
  const cut = framebufferRenderer.subtreeRgba(project, pageId, nodeId, assets);
  const pixels = new Uint8Array(cut.w * cut.h);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    if (cut.data[offset + 3] === 0) pixels[index] = RASTER_TRANSPARENT;
    else {
      const luma = cut.data[offset] * 0.299 + cut.data[offset + 1] * 0.587 + cut.data[offset + 2] * 0.114;
      pixels[index] = luma < 128 ? RASTER_BLACK : RASTER_WHITE;
    }
  }
  return { x: cut.x, y: cut.y, w: cut.w, h: cut.h, pixels };
}

function validateRasterProject(project) {
  for (const page of project?.pages || []) for (const node of page.nodes || []) {
    if (node.type !== 'raster') continue;
    if (!node.raster || node.raster.encoding !== RASTER_ENCODING) throw new Error('V17 栅格数据格式无效');
    decodeTriStatePixels(node.raster.data, node.w, node.h);
  }
  return project;
}

function installRasterLayerRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model, C = PE?.commands, R = PE?.renderer;
  const Workspace = PE?.ui?.Workspace;
  if (!M?.createNode || !R?.FramebufferRenderer || !Workspace || !PE?.tristateRaster) throw new Error('PixelEditor tri-state raster dependencies are not initialized');
  if (PE.rasterLayerInstalled) return;
  PE.rasterLayerInstalled = true;

  const originalPaintTarget = Workspace.prototype.paintTarget;
  Workspace.prototype.paintTarget = function paintTarget() {
    const page = this.activePage(), id = this.state.selection.primaryId, node = M.nodeById(page, id), tree = new M.TreeModel(page);
    if (node?.type === 'image') return null;
    if (node?.type === 'raster') {
      if (tree.isEffectivelyLocked(node.id) || !tree.isEffectivelyVisible(node.id)) return null;
      return { kind: 'node', node };
    }
    return originalPaintTarget.call(this);
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
    const page = this.activePage(), node = M.nodeById(page, gesture.nodeId);
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
    const page = this.activePage(), id = this.state.selection.primaryId, node = M.nodeById(page, id), tree = new M.TreeModel(page);
    if (!node || tree.isEffectivelyLocked(id)) return false;
    if (node.type === 'raster' && tree.childrenOf(id).length === 0) return false;
    if (typeof confirm === 'function' && !confirm('确认将该图层及其所有子图层栅格化为固定像素图层吗？')) return false;
    const cut = rasterizeSubtree({ project: this.state.project, pageId: page.id, nodeId: id, assets: this.state.assets, framebufferRenderer: R.FramebufferRenderer });
    const replacement = M.createNode('raster', {
      id: node.id, parentId: node.parentId, name: node.name, visible: node.visible, locked: node.locked,
      x: cut.x, y: cut.y, w: cut.w, h: cut.h, pixels: cut.pixels, transform: node.transform,
    });
    const ids = new Set([id, ...tree.descendantsOf(id).map(item => item.id)]), index = page.nodes.findIndex(item => item.id === id);
    return this.exec({ label: '栅格化图层', execute: () => {
      page.nodes = page.nodes.filter(item => !ids.has(item.id));
      page.nodes.splice(Math.min(index, page.nodes.length), 0, replacement);
      this.state.selection.replace([replacement.id]);
      return true;
    } });
  };

  const originalSetSelectionSize = Workspace.prototype.setSelectionSize;
  Workspace.prototype.setSelectionSize = function setSelectionSize(axis, targetValue) {
    const page = this.activePage(), rasterIds = this.state.selection.ids.filter(id => M.nodeById(page, id)?.type === 'raster');
    if (!rasterIds.length) return originalSetSelectionSize.call(this, axis, targetValue);
    const targetSize = Math.max(1, Math.round(Number(targetValue)));
    if (!Number.isFinite(targetSize)) return false;
    return this.exec(new C.UpdateNodesCommand(rasterIds, node => {
      const geometry = { x: node.x, y: node.y, w: node.w, h: node.h };
      if (axis === 'w') geometry.w = targetSize; else geometry.h = targetSize;
      if (node.aspectLocked) {
        const ratio = node.w / Math.max(1, node.h);
        if (axis === 'w') geometry.h = Math.max(1, Math.round(targetSize / ratio)); else geometry.w = Math.max(1, Math.round(targetSize * ratio));
      }
      return resizeTriStateRaster(node, geometry);
    }, page.id, '调整栅格尺寸'));
  };

  const originalCommitLiveHandle = Workspace.prototype.commitLiveHandle;
  Workspace.prototype.commitLiveHandle = function commitLiveHandle(gesture) {
    const page = this.activePage(), node = M.nodeById(page, gesture.nodeId);
    if (gesture.type !== 'resize-live' || node?.type !== 'raster') return originalCommitLiveHandle.call(this, gesture);
    const geometry = { x: node.x, y: node.y, w: node.w, h: node.h }, original = structuredClone(gesture.original);
    Object.assign(node, original);
    return this.exec(new C.UpdateNodesCommand([gesture.nodeId], resizeTriStateRaster(original, geometry), page.id, '调整栅格大小'));
  };

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

export { RASTER_ENCODING, rasterizeSubtree, validateRasterProject, installRasterLayerRuntime };
