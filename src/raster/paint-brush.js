import { canPaintSelection } from '../media/edit-boundaries.js';

function brushWidth(value) {
  return Math.max(1, Math.min(100, Math.round(Number(value) || 1)));
}

function expandBrushPoints(points, width) {
  const size = brushWidth(width);
  const start = -Math.floor((size - 1) / 2);
  const unique = new Map();
  for (const point of points || []) {
    for (let oy = 0; oy < size; oy += 1) {
      for (let ox = 0; ox < size; ox += 1) {
        const x = Math.round(Number(point.x)) + start + ox;
        const y = Math.round(Number(point.y)) + start + oy;
        unique.set(`${x},${y}`, { x, y });
      }
    }
  }
  return [...unique.values()];
}

function beginPaintWithBrush(editor, point) {
  const T = globalThis.PixelEditor?.tristateRaster;
  if (!editor || !T) return false;
  if (!canPaintSelection(editor)) return false;
  const info = editor.paintTarget?.();
  if (!info) {
    editor.notice?.('铅笔和橡皮擦只能编辑已选择且未锁定的图片 / 栅格图层；未选择普通图层时直接编辑页面背景');
    return false;
  }
  const settings = editor.getToolDefaults?.(editor.tool) || {};
  const width = brushWidth(settings.width);

  if (info.kind === 'page') {
    editor.notice?.('');
    editor.state.selection.clear();
    editor.pageSelectedId = info.page.id;
    editor.pageLayers?.render?.();
    editor.properties?.render?.();
    const value = editor.tool === 'eraser' ? 0 : settings.color === 0 ? 0 : 1;
    editor.customGesture = {
      type: 'paint',
      tool: editor.tool,
      targetKind: 'page',
      nodeId: null,
      pageId: info.page.id,
      value,
      brushWidth: width,
      start: point,
      last: point,
      lastPaint: point,
      originalOverlay: structuredClone(info.page.overlay || {}),
      changed: false,
    };
    editor.applyPaintSegment(editor.customGesture, point, point);
    editor.renderCanvas?.();
    return true;
  }

  if (info.kind === 'node' && info.node?.type === 'raster') {
    const value = editor.tool === 'eraser'
      ? T.RASTER_TRANSPARENT
      : settings.color === 0 ? T.RASTER_WHITE : T.RASTER_BLACK;
    editor.notice?.('');
    editor.customGesture = {
      type: 'paint',
      tool: editor.tool,
      targetKind: 'raster',
      nodeId: info.node.id,
      pageId: editor.activePage().id,
      value,
      brushWidth: width,
      start: point,
      last: point,
      lastPaint: point,
      originalRaster: structuredClone(info.node.raster),
      changed: false,
    };
    editor.applyPaintSegment(editor.customGesture, point, point);
    editor.renderCanvas?.();
    return true;
  }

  editor.notice?.('图片、文字和矢量图层不能直接涂鸦，请先栅格化后再使用铅笔或橡皮。');
  return false;
}

function installPaintBrushRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const Workspace = PE?.ui?.Workspace;
  const T = PE?.tristateRaster;
  if (!M || !C || !Workspace || !T) throw new Error('PixelEditor paint brush dependencies are not initialized');
  if (PE.paintBrushInstalled) return;
  PE.paintBrushInstalled = true;

  const previousApplyPaintSegment = Workspace.prototype.applyPaintSegment;
  Workspace.prototype.applyPaintSegment = function applyPaintSegmentWithBrush(gesture, a, b) {
    if (!gesture || (gesture.targetKind !== 'page' && gesture.targetKind !== 'raster')) {
      return previousApplyPaintSegment.call(this, gesture, a, b);
    }
    const path = this.linePoints(a, b);
    const points = expandBrushPoints(path, gesture.brushWidth);

    if (gesture.targetKind === 'page') {
      const page = this.activePage();
      page.overlay = page.overlay || {};
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
    const local = points.map(pixel => ({ x: pixel.x - node.x, y: pixel.y - node.y }));
    const before = node.raster.data;
    node.raster = T.paintTriStateRaster(node, local, gesture.value);
    const changed = node.raster.data !== before;
    gesture.changed ||= changed;
    return changed;
  };

  const previousCommitPaint = Workspace.prototype.commitPaint;
  Workspace.prototype.commitPaint = function commitPaintWithBrush(gesture) {
    if (gesture?.targetKind === 'page') {
      const page = this.activePage();
      const finalOverlay = structuredClone(page.overlay || {});
      page.overlay = structuredClone(gesture.originalOverlay || {});
      if (!gesture.changed) return false;
      const label = gesture.tool === 'eraser'
        ? '背景橡皮'
        : gesture.value === 0 ? '背景白色铅笔' : '背景黑色铅笔';
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
        : gesture.value === T.RASTER_WHITE ? '栅格白色铅笔' : '栅格黑色铅笔';
      return this.exec(new C.UpdateNodesCommand([node.id], { raster: finalRaster }, page.id, label));
    }

    return previousCommitPaint.call(this, gesture);
  };

  PE.paintBrush = { brushWidth, expandBrushPoints, beginPaintWithBrush };
}

export { brushWidth, expandBrushPoints, beginPaintWithBrush, installPaintBrushRuntime };
