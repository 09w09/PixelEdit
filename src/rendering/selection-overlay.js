const BOX_TYPES = new Set(['rectangle', 'circle', 'text', 'image', 'raster']);

function safeZoom(zoom) {
  return Math.max(0.01, Number(zoom) || 1);
}

function handleVisualSize(zoom, cssPx = 10) {
  return cssPx / safeZoom(zoom);
}

function handleHitTolerance(zoom, cssPx = 8) {
  return cssPx / safeZoom(zoom);
}

function translated(point, dx = 0, dy = 0) {
  return { ...point, x: point.x + dx, y: point.y + dy };
}

function handleRect(point, zoom) {
  const size = handleVisualSize(zoom);
  const half = size / 2;
  return `<rect class="selection-handle" x="${point.x - half}" y="${point.y - half}" width="${size}" height="${size}"/>`;
}

function installSelectionOverlayRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const R = PE?.renderer;
  const Workspace = PE?.ui?.Workspace;
  const T = PE?.transformModel;
  const G = PE?.selectionGeometry;
  if (!M || !R?.FramebufferRenderer || !Workspace || !T || !G) throw new Error('PixelEditor selection geometry is not initialized');
  if (PE.selectionOverlayInstalled) return;
  PE.selectionOverlayInstalled = true;

  const boxHandlePoints = bounds => {
    const handles = G.sourceHandles(bounds);
    return ['nw', 'ne', 'sw', 'se'].map(corner => ({ ...handles[corner], corner }));
  };

  const hitBoxHandle = (bounds, point, zoom) => {
    const tolerance = handleHitTolerance(zoom);
    for (const handle of boxHandlePoints(bounds)) {
      if (Math.hypot(handle.x - point.x, handle.y - point.y) <= tolerance) return handle;
    }
    return null;
  };

  function outlineMarkup(node, dx = 0, dy = 0) {
    const geometry = G.selectionGeometry(node);
    if (!geometry) return '';
    if (node.type === 'line') {
      const [a, b] = geometry.controlPoints.map(point => translated(point, dx, dy));
      if (!a || !b) return '';
      return `<line class="selection-box" vector-effect="non-scaling-stroke" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    }
    if (node.type === 'polygon') {
      const points = geometry.outline.map(point => translated(point, dx, dy));
      return `<polygon class="selection-box" vector-effect="non-scaling-stroke" points="${points.map(point => `${point.x},${point.y}`).join(' ')}"/>`;
    }
    if (BOX_TYPES.has(node.type)) {
      if (T.isIdentityTransform(node.transform)) {
        const b = geometry.sourceBounds;
        return `<rect class="selection-box" vector-effect="non-scaling-stroke" x="${b.x + dx}" y="${b.y + dy}" width="${b.w}" height="${b.h}"/>`;
      }
      const points = geometry.outline.map(point => translated(point, dx, dy));
      return `<polygon class="selection-box" vector-effect="non-scaling-stroke" points="${points.map(point => `${point.x},${point.y}`).join(' ')}"/>`;
    }
    return '';
  }

  Workspace.prototype.selectionHandleAt = function selectionHandleAt(point) {
    const ids = this.state.selection.ids;
    if (ids.length !== 1) return null;
    const page = this.activePage();
    const node = M.nodeById(page, ids[0]);
    const tree = new M.TreeModel(page);
    if (!node || tree.isEffectivelyLocked(node.id)) return null;
    return G.hitHandle(node, point, this.zoom);
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
      if (node) html += outlineMarkup(node, dx, dy);
    }

    if (ids.length === 1) {
      const node = M.nodeById(page, ids[0]);
      const geometry = node ? G.selectionGeometry(node) : null;
      let handles = [];
      if (geometry && BOX_TYPES.has(node.type)) handles = ['nw', 'ne', 'sw', 'se'].map(corner => geometry.handles[corner]);
      else if (geometry) handles = geometry.controlPoints;
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
    const mappingNode = gesture.original || node;
    const localPoint = G.worldToLocal(mappingNode, point);
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
    boxHandlePoints,
    hitBoxHandle,
    handleVisualSize,
    handleHitTolerance,
    sourceGeometryBounds: G.sourceGeometryBounds,
    selectionGeometry: G.selectionGeometry,
    outlineMarkup,
  };
}

export { handleVisualSize, handleHitTolerance, installSelectionOverlayRuntime };
