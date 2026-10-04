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
  const Workspace = PE?.ui?.Workspace, Properties = PE?.ui?.Properties;
  if (!M?.createNode || !R?.FramebufferRenderer || !Workspace || !PE?.tristateRaster) throw new Error('PixelEditor tri-state raster dependencies are not initialized');
  if (PE.rasterLayerInstalled) return;
  PE.rasterLayerInstalled = true;

  const originalPaintTarget = Workspace.prototype.paintTarget;
  Workspace.prototype.paintTarget = function paintTarget() {
    const page = this.activePage(), id = this.state.selection.primaryId, node = M.nodeById(page, id), tree = new M.TreeModel(page);
    if (node?.type === 'raster') {
      if (tree.isEffectivelyLocked(node.id) || !tree.isEffectivelyVisible(node.id)) return null;
      return { kind: 'node', node };
    }
    return originalPaintTarget.call(this);
  };

  const originalBeginPaint = Workspace.prototype.beginPaint;
  Workspace.prototype.beginPaint = function beginPaint(point) {
    const targetInfo = this.paintTarget();
    if (!targetInfo || targetInfo.kind !== 'node' || targetInfo.node.type !== 'raster') return originalBeginPaint.call(this, point);
    const pencilColor = this.getToolDefaults?.('pencil')?.color === 0 ? RASTER_WHITE : RASTER_BLACK;
    this.notice('');
    this.customGesture = {
      type: 'paint', targetKind: 'raster', nodeId: targetInfo.node.id, pageId: this.activePage().id,
      value: this.tool === 'eraser' ? RASTER_TRANSPARENT : pencilColor,
      start: point, last: point, lastPaint: point, originalRaster: structuredClone(targetInfo.node.raster), changed: false,
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
  Workspace.prototype.setSelectionSize = function setSelectionSize(axis, target) {
    const page = this.activePage(), rasterIds = this.state.selection.ids.filter(id => M.nodeById(page, id)?.type === 'raster');
    if (!rasterIds.length) return originalSetSelectionSize.call(this, axis, target);
    target = Math.max(1, Math.round(Number(target)));
    if (!Number.isFinite(target)) return false;
    return this.exec(new C.UpdateNodesCommand(rasterIds, node => {
      const geometry = { x: node.x, y: node.y, w: node.w, h: node.h };
      if (axis === 'w') geometry.w = target; else geometry.h = target;
      if (node.aspectLocked) {
        const ratio = node.w / Math.max(1, node.h);
        if (axis === 'w') geometry.h = Math.max(1, Math.round(target / ratio)); else geometry.w = Math.max(1, Math.round(target * ratio));
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

  if (Properties) {
    const originalTransform = Properties.prototype.transform;
    Properties.prototype.transform = function transform(nodes, locked) {
      if (!nodes.length || !nodes.every(node => node.type === 'raster')) return originalTransform.call(this, nodes, locked);
      const bounds = this.bounds(nodes);
      const common = key => {
        const first = bounds[0]?.[key];
        return bounds.every(item => item?.[key] === first) ? first : null;
      };
      const aspect = nodes.every(node => node.aspectLocked === nodes[0].aspectLocked) ? nodes[0].aspectLocked : null;
      const input = (id, label, value, min = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" ${value == null ? 'placeholder="—" class="mixed"' : `value="${value}"`} ${min !== '' ? `min="${min}"` : ''} ${locked ? 'disabled' : ''} step="1"></div>`;
      return `<div class="property-section"><h4>位置</h4><div class="row">${input('propX','X',common('x'))}${input('propY','Y',common('y'))}</div><div class="row">${input('propW','W',common('w'),1)}${input('propH','H',common('h'),1)}</div><label class="check"><input id="propAspect" type="checkbox" ${aspect === true ? 'checked' : ''} ${locked ? 'disabled' : ''}> 锁定比例${aspect == null ? '（混合）' : ''}</label></div>`;
    };

    const originalTypeFields = Properties.prototype.typeFields;
    Properties.prototype.typeFields = function typeFields(nodes, locked) {
      if (nodes[0]?.type === 'raster') return '<div class="property-section"><h4>栅格</h4><div class="muted">固定像素画布：黑、白、透明三态。铅笔写入黑/白，橡皮写入透明；调整边框只扩展透明区域或裁剪，不重采样。</div></div>';
      return originalTypeFields.call(this, nodes, locked);
    };

    const originalBind = Properties.prototype.bind;
    Properties.prototype.bind = function bind(nodes, locked) {
      const result = originalBind.call(this, nodes, locked);
      if (locked || !nodes.length || !nodes.every(node => node.type === 'raster')) return result;
      const page = this.editor.activePage(), ids = nodes.map(node => node.id);
      this.el.querySelector('#propW')?.addEventListener('change', event => this.editor.setSelectionSize('w', Math.max(1, Math.round(Number(event.target.value)))));
      this.el.querySelector('#propH')?.addEventListener('change', event => this.editor.setSelectionSize('h', Math.max(1, Math.round(Number(event.target.value)))));
      this.el.querySelector('#propAspect')?.addEventListener('change', event => this.editor.exec(new C.UpdateNodesCommand(ids, { aspectLocked: event.target.checked }, page.id, '锁定比例')));
      return result;
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

export { RASTER_ENCODING, rasterizeSubtree, validateRasterProject, installRasterLayerRuntime };
