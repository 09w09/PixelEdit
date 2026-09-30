const BOX_TYPES = new Set(['rectangle', 'circle', 'text', 'image', 'raster']);

function safeZoom(zoom) {
  return Math.max(0.01, Number(zoom) || 1);
}

function boxEdges(bounds) {
  return {
    left: Number(bounds.x) || 0,
    top: Number(bounds.y) || 0,
    right: (Number(bounds.x) || 0) + Math.max(0, Number(bounds.w) || 0),
    bottom: (Number(bounds.y) || 0) + Math.max(0, Number(bounds.h) || 0),
  };
}

function boxHandlePoints(bounds) {
  const edge = boxEdges(bounds);
  return [
    { x: edge.left, y: edge.top, corner: 'nw' },
    { x: edge.right, y: edge.top, corner: 'ne' },
    { x: edge.left, y: edge.bottom, corner: 'sw' },
    { x: edge.right, y: edge.bottom, corner: 'se' },
  ];
}

function handleVisualSize(zoom, cssPx = 10) {
  return cssPx / safeZoom(zoom);
}

function handleHitTolerance(zoom, cssPx = 8) {
  return cssPx / safeZoom(zoom);
}

function hitBoxHandle(bounds, point, zoom) {
  const tolerance = handleHitTolerance(zoom);
  for (const handle of boxHandlePoints(bounds)) {
    if (Math.hypot(handle.x - point.x, handle.y - point.y) <= tolerance) return handle;
  }
  return null;
}

function handleRect(point, zoom) {
  const size = handleVisualSize(zoom);
  const half = size / 2;
  return `<rect class="selection-handle" x="${point.x - half}" y="${point.y - half}" width="${size}" height="${size}"/>`;
}

function pointBounds(points) {
  if (!points?.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function sourceGeometryBounds(node) {
  if (node.type === 'line') {
    return {
      x: Math.min(node.x1, node.x2),
      y: Math.min(node.y1, node.y2),
      w: Math.abs(node.x2 - node.x1),
      h: Math.abs(node.y2 - node.y1),
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

function translated(point, dx = 0, dy = 0) {
  return { ...point, x: point.x + dx, y: point.y + dy };
}

function transformedSourcePoints(node, points, transformModel) {
  if (!transformModel || transformModel.isIdentityTransform(node.transform)) return points.map(point => ({ ...point }));
  const matrix = transformModel.nodeTransformMatrix(node, sourceGeometryBounds(node));
  return points.map(point => transformModel.transformPoint(matrix, point));
}

function boxOutlinePoints(node, transformModel) {
  const bounds = sourceGeometryBounds(node);
  const source = boxHandlePoints(bounds);
  if (!transformModel || transformModel.isIdentityTransform(node.transform)) return source;
  const matrix = transformModel.nodeTransformMatrix(node, bounds);
  return source.map(point => ({ ...transformModel.transformPoint(matrix, point), corner: point.corner }));
}

function lineControlPoints(node, transformModel) {
  return transformedSourcePoints(node, [{ x: node.x1, y: node.y1 }, { x: node.x2, y: node.y2 }], transformModel);
}

function polygonControlPoints(node, transformModel) {
  return transformedSourcePoints(node, node.points || [], transformModel);
}

function outlineMarkup(node, transformModel, dx = 0, dy = 0) {
  if (node.type === 'line') {
    const points = lineControlPoints(node, transformModel).map(point => translated(point, dx, dy));
    if (points.length < 2) return '';
    return `<line class="selection-box" vector-effect="non-scaling-stroke" x1="${points[0].x}" y1="${points[0].y}" x2="${points[1].x}" y2="${points[1].y}"/>`;
  }
  if (node.type === 'polygon') {
    const points = polygonControlPoints(node, transformModel).map(point => translated(point, dx, dy));
    return `<polygon class="selection-box" vector-effect="non-scaling-stroke" points="${points.map(point => `${point.x},${point.y}`).join(' ')}"/>`;
  }
  if (BOX_TYPES.has(node.type)) {
    const bounds = sourceGeometryBounds(node);
    if (!transformModel || transformModel.isIdentityTransform(node.transform)) {
      return `<rect class="selection-box" vector-effect="non-scaling-stroke" x="${bounds.x + dx}" y="${bounds.y + dy}" width="${bounds.w}" height="${bounds.h}"/>`;
    }
    const points = boxOutlinePoints(node, transformModel).map(point => translated(point, dx, dy));
    return `<polygon class="selection-box" vector-effect="non-scaling-stroke" points="${points.map(point => `${point.x},${point.y}`).join(' ')}"/>`;
  }
  return '';
}

function installSelectionOverlayRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const R = PE?.renderer;
  const Workspace = PE?.ui?.Workspace;
  const T = PE?.transformModel;
  if (!M || !R?.FramebufferRenderer || !Workspace) throw new Error('PixelEditor is not initialized');
  if (PE.selectionOverlayInstalled) return;
  PE.selectionOverlayInstalled = true;

  Workspace.prototype.selectionHandleAt = function selectionHandleAt(point) {
    const ids = this.state.selection.ids;
    if (ids.length !== 1) return null;
    const page = this.activePage();
    const node = M.nodeById(page, ids[0]);
    const tree = new M.TreeModel(page);
    if (!node || tree.isEffectivelyLocked(node.id)) return null;
    const tolerance = handleHitTolerance(this.zoom);
    if (node.type === 'polygon') {
      const points = polygonControlPoints(node, T);
      for (let index = 0; index < points.length; index += 1) {
        const p = points[index];
        if (Math.hypot(p.x - point.x, p.y - point.y) <= tolerance) return { type: 'polygon-point', index, node };
      }
      return null;
    }
    if (node.type === 'line') {
      const points = lineControlPoints(node, T);
      for (let index = 0; index < points.length; index += 1) {
        const p = points[index];
        if (Math.hypot(p.x - point.x, p.y - point.y) <= tolerance) return { type: 'line-point', index, node };
      }
      return null;
    }
    if (BOX_TYPES.has(node.type)) {
      const bounds = sourceGeometryBounds(node);
      const handles = boxOutlinePoints(node, T);
      for (const handle of handles) {
        if (Math.hypot(handle.x - point.x, handle.y - point.y) <= tolerance) {
          return { type: 'resize', corner: handle.corner, node, startBounds: { ...bounds } };
        }
      }
    }
    return null;
  };

  Workspace.prototype.renderOverlay = function renderOverlay() {
    const svg = this.overlay;
    if (!svg) return;
    const page = this.activePage();
    const preview = this.overlayState.previewMove;
    const dx = preview?.dx || 0;
    const dy = preview?.dy || 0;
    const ids = this.state.selection.ids;
    let html = '';

    for (const id of ids) {
      const node = M.nodeById(page, id);
      if (node) html += outlineMarkup(node, T, dx, dy);
    }

    if (ids.length === 1) {
      const node = M.nodeById(page, ids[0]);
      let handles = [];
      if (node?.type === 'line') handles = lineControlPoints(node, T);
      else if (node?.type === 'polygon') handles = polygonControlPoints(node, T);
      else if (node && BOX_TYPES.has(node.type)) handles = boxOutlinePoints(node, T);
      for (const point of handles) html += handleRect(translated(point, dx, dy), this.zoom);
    }

    html += R.OverlayRenderer.markup({
      smartGuides: this.overlayState.smartGuides || [],
      marquee: this.overlayState.marquee,
    });
    svg.innerHTML = html;
  };

  const originalUpdateLiveResize = Workspace.prototype.updateLiveResize;
  Workspace.prototype.updateLiveResize = function updateLiveResize(gesture, point) {
    const node = M.nodeById(this.activePage(), gesture.nodeId);
    if (!node || !BOX_TYPES.has(node.type)) return originalUpdateLiveResize.call(this, gesture, point);
    const b = gesture.startBounds;
    const left = b.x;
    const top = b.y;
    const right = b.x + b.w;
    const bottom = b.y + b.h;
    const west = gesture.corner.includes('w');
    const north = gesture.corner.includes('n');
    const anchorX = west ? right : left;
    const anchorY = north ? bottom : top;
    let localPoint = point;
    if (T && !T.isIdentityTransform(node.transform)) {
      const matrix = T.nodeTransformMatrix(gesture.original || node, b);
      localPoint = T.inverseTransformPoint(matrix, point);
    }
    let w = Math.max(1, Math.abs(localPoint.x - anchorX));
    let h = Math.max(1, Math.abs(localPoint.y - anchorY));
    if (node.aspectLocked) {
      const ratio = b.w / Math.max(1, b.h);
      const sx = w / Math.max(1, b.w);
      const sy = h / Math.max(1, b.h);
      if (sx >= sy) h = Math.max(1, Math.round(w / ratio));
      else w = Math.max(1, Math.round(h * ratio));
    }
    const geometry = {
      x: west ? anchorX - w : anchorX,
      y: north ? anchorY - h : anchorY,
      w,
      h,
    };
    if (node.type === 'raster' && PE.rasterLayer?.resizeRaster) {
      Object.assign(node, PE.rasterLayer.resizeRaster(gesture.original, geometry));
    } else {
      Object.assign(node, geometry);
    }
    this.renderCanvas();
    this.renderOverlay();
    this.properties.render();
  };

  PE.selectionOverlay = {
    boxEdges,
    boxHandlePoints,
    handleVisualSize,
    handleHitTolerance,
    hitBoxHandle,
    sourceGeometryBounds,
    transformedSourcePoints,
    boxOutlinePoints,
    lineControlPoints,
    polygonControlPoints,
    outlineMarkup,
  };
}

export {
  boxEdges,
  boxHandlePoints,
  handleVisualSize,
  handleHitTolerance,
  hitBoxHandle,
  sourceGeometryBounds,
  transformedSourcePoints,
  boxOutlinePoints,
  lineControlPoints,
  polygonControlPoints,
  outlineMarkup,
  installSelectionOverlayRuntime,
};
