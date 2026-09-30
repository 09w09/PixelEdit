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

function installPaintBrushRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const Workspace = PE?.ui?.Workspace;
  const T = PE?.tristateRaster;
  if (!M || !C || !Workspace || !T) throw new Error('PixelEditor paint brush dependencies are not initialized');
  if (PE.paintBrushInstalled) return;
  PE.paintBrushInstalled = true;

  const previousBeginPaint = Workspace.prototype.beginPaint;
  Workspace.prototype.beginPaint = function beginPaintWithBrush(point) {
    const info = this.paintTarget();
    if (!info) return previousBeginPaint.call(this, point);
    const settings = this.getToolDefaults?.(this.tool) || {};
    const width = brushWidth(settings.width);

    if (info.kind === 'page') {
      this.notice('');
      this.state.selection.clear();
      this.pageSelectedId = info.page.id;
      this.pageLayers?.render();
      this.properties?.render();
      const value = this.tool === 'eraser' ? 0 : settings.color === 0 ? 0 : 1;
      this.customGesture = {
        type: 'paint',
        tool: this.tool,
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
      this.applyPaintSegment(this.customGesture, point, point);
      this.renderCanvas();
      return true;
    }

    if (info.kind === 'node' && info.node?.type === 'raster') {
      const value = this.tool === 'eraser'
        ? T.RASTER_TRANSPARENT
        : settings.color === 0 ? T.RASTER_WHITE : T.RASTER_BLACK;
      this.notice('');
      this.customGesture = {
        type: 'paint',
        tool: this.tool,
        targetKind: 'raster',
        nodeId: info.node.id,
        pageId: this.activePage().id,
        value,
        brushWidth: width,
        start: point,
        last: point,
        lastPaint: point,
        originalRaster: structuredClone(info.node.raster),
        changed: false,
      };
      this.applyPaintSegment(this.customGesture, point, point);
      this.renderCanvas();
      return true;
    }

    return previousBeginPaint.call(this, point);
  };

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
      for (const point of points) {
        if (point.x < 0 || point.y < 0 || point.x >= 400 || point.y >= 300) continue;
        const key = `${point.x},${point.y}`;
        if (page.overlay[key] === gesture.value) continue;
        page.overlay[key] = gesture.value;
        changed = true;
      }
      gesture.changed ||= changed;
      return changed;
    }

    const node = M.nodeById(this.activePage(), gesture.nodeId);
    if (!node || node.type !== 'raster') return false;
    const local = points.map(point => ({ x: point.x - node.x, y: point.y - node.y }));
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

  PE.paintBrush = { brushWidth, expandBrushPoints };
}

export { brushWidth, expandBrushPoints, installPaintBrushRuntime };
