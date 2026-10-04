const BOX_TYPES = new Set(['rectangle', 'circle', 'text', 'image', 'raster']);

function safeZoom(zoom) {
  return Math.max(0.01, Number(zoom) || 1);
}

function pointBounds(points = []) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map(point => Number(point.x) || 0);
  const ys = points.map(point => Number(point.y) || 0);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x, y, w: right - x, h: bottom - y };
}

function sourceGeometryBounds(node) {
  if (!node) return { x: 0, y: 0, w: 0, h: 0 };
  if (node.type === 'line') {
    return {
      x: Math.min(Number(node.x1) || 0, Number(node.x2) || 0),
      y: Math.min(Number(node.y1) || 0, Number(node.y2) || 0),
      w: Math.abs((Number(node.x2) || 0) - (Number(node.x1) || 0)),
      h: Math.abs((Number(node.y2) || 0) - (Number(node.y1) || 0)),
    };
  }
  if (node.type === 'polygon') return pointBounds(node.points || []);
  return {
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    w: Math.max(0, Number(node.w) || 0),
    h: Math.max(0, Number(node.h) || 0),
  };
}

function sourceHandles(bounds) {
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;
  return {
    nw: { x: left, y: top },
    n: { x: (left + right) / 2, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: (top + bottom) / 2 },
    se: { x: right, y: bottom },
    s: { x: (left + right) / 2, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: (top + bottom) / 2 },
  };
}

function createSelectionGeometry(transformModel) {
  function matrixFor(node, pivotBounds = null) {
    return transformModel.nodeTransformMatrix(node, pivotBounds || sourceGeometryBounds(node));
  }

  function localToWorld(node, point, pivotBounds = null) {
    if (!node) return { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
    return transformModel.transformPoint(matrixFor(node, pivotBounds), point);
  }

  function worldToLocal(node, point, pivotBounds = null) {
    if (!node) return { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
    return transformModel.inverseTransformPoint(matrixFor(node, pivotBounds), point);
  }

  function selectionGeometry(node, pivotBounds = null) {
    if (!node) return null;
    const bounds = sourceGeometryBounds(node);
    const matrix = matrixFor(node, pivotBounds);
    const map = point => transformModel.transformPoint(matrix, point);

    if (BOX_TYPES.has(node.type)) {
      const source = sourceHandles(bounds);
      const handles = Object.fromEntries(
        Object.entries(source).map(([name, point]) => [name, map(point)]),
      );
      const outline = [handles.nw, handles.ne, handles.se, handles.sw];
      return { outline, handles, controlPoints: [], visualBounds: pointBounds(outline), sourceBounds: bounds };
    }

    if (node.type === 'line') {
      const controlPoints = [map({ x: node.x1, y: node.y1 }), map({ x: node.x2, y: node.y2 })];
      return { outline: [], handles: null, controlPoints, visualBounds: pointBounds(controlPoints), sourceBounds: bounds };
    }

    if (node.type === 'polygon') {
      const controlPoints = (node.points || []).map(map);
      return { outline: controlPoints, handles: null, controlPoints, visualBounds: pointBounds(controlPoints), sourceBounds: bounds };
    }

    return { outline: [], handles: null, controlPoints: [], visualBounds: bounds, sourceBounds: bounds };
  }

  function hitHandle(node, worldPoint, zoom, pivotBounds = null) {
    const geometry = selectionGeometry(node, pivotBounds);
    if (!geometry) return null;
    const tolerance = 8 / safeZoom(zoom);
    if (BOX_TYPES.has(node.type)) {
      for (const corner of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        const point = geometry.handles[corner];
        if (Math.hypot(point.x - worldPoint.x, point.y - worldPoint.y) <= tolerance) {
          return { type: 'resize', corner, node, startBounds: { ...geometry.sourceBounds } };
        }
      }
      return null;
    }
    if (node.type === 'line' || node.type === 'polygon') {
      for (let index = 0; index < geometry.controlPoints.length; index += 1) {
        const point = geometry.controlPoints[index];
        if (Math.hypot(point.x - worldPoint.x, point.y - worldPoint.y) <= tolerance) {
          return { type: node.type === 'line' ? 'line-point' : 'polygon-point', index, node };
        }
      }
    }
    return null;
  }

  return { sourceGeometryBounds, sourceHandles, localToWorld, worldToLocal, selectionGeometry, hitHandle };
}

function installSelectionGeometryRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.transformModel) throw new Error('PixelEditor transform model is not initialized');
  if (PE.selectionGeometry) return;
  PE.selectionGeometry = createSelectionGeometry(PE.transformModel);
}

export { BOX_TYPES, pointBounds, sourceGeometryBounds, sourceHandles, createSelectionGeometry, installSelectionGeometryRuntime };
