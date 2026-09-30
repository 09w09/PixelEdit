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

function installSelectionOverlayRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const R = PE?.renderer;
  const Workspace = PE?.ui?.Workspace;
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
      for (let index = 0; index < node.points.length; index += 1) {
        const p = node.points[index];
        if (Math.hypot(p.x - point.x, p.y - point.y) <= tolerance) return { type: 'polygon-point', index, node };
      }
      return null;
    }
    if (node.type === 'line') {
      const points = [{ x: node.x1, y: node.y1 }, { x: node.x2, y: node.y2 }];
      for (let index = 0; index < points.length; index += 1) {
        const p = points[index];
        if (Math.hypot(p.x - point.x, p.y - point.y) <= tolerance) return { type: 'line-point', index, node };
      }
      return null;
    }
    if (BOX_TYPES.has(node.type)) {
      const bounds = R.FramebufferRenderer.visualBounds(node.id, {
        project: this.state.project,
        pageId: page.id,
        assets: this.state.assets,
      });
      const handle = hitBoxHandle(bounds, point, this.zoom);
      return handle ? { type: 'resize', corner: handle.corner, node, startBounds: { ...bounds } } : null;
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
    const rects = this.selectionRects();
    let html = '';

    if (ids.length === 1) {
      const node = M.nodeById(page, ids[0]);
      if (node?.type === 'line') {
        html += `<line class="selection-box" vector-effect="non-scaling-stroke" x1="${node.x1 + dx}" y1="${node.y1 + dy}" x2="${node.x2 + dx}" y2="${node.y2 + dy}"/>`;
        html += handleRect({ x: node.x1 + dx, y: node.y1 + dy }, this.zoom);
        html += handleRect({ x: node.x2 + dx, y: node.y2 + dy }, this.zoom);
      } else if (node?.type === 'polygon') {
        const points = node.points.map(p => `${p.x + dx},${p.y + dy}`).join(' ');
        html += `<polygon class="selection-box" vector-effect="non-scaling-stroke" points="${points}"/>`;
        for (const p of node.points) html += handleRect({ x: p.x + dx, y: p.y + dy }, this.zoom);
      } else if (rects.length === 1) {
        const bounds = rects[0];
        html += `<rect class="selection-box" vector-effect="non-scaling-stroke" x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}"/>`;
        for (const p of boxHandlePoints(bounds)) html += handleRect(p, this.zoom);
      }
    } else {
      html += R.OverlayRenderer.markup({ selectionRects: rects });
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
    let w = Math.max(1, Math.abs(point.x - anchorX));
    let h = Math.max(1, Math.abs(point.y - anchorY));
    if (node.aspectLocked) {
      const ratio = b.w / Math.max(1, b.h);
      const sx = w / Math.max(1, b.w);
      const sy = h / Math.max(1, b.h);
      if (sx >= sy) h = Math.max(1, Math.round(w / ratio));
      else w = Math.max(1, Math.round(h * ratio));
    }
    node.x = west ? anchorX - w : anchorX;
    node.y = north ? anchorY - h : anchorY;
    node.w = w;
    node.h = h;
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
  };
}

export {
  boxEdges,
  boxHandlePoints,
  handleVisualSize,
  handleHitTolerance,
  hitBoxHandle,
  installSelectionOverlayRuntime,
};
