const BOX_TYPES = new Set(['rectangle', 'circle', 'text', 'image', 'raster']);
const EDGE_CORNERS = ['n', 'e', 's', 'w'];
const HANDLE_DIRECTIONS = Object.freeze({
  nw: [-1, -1], n: [0, -1], ne: [1, -1],
  w: [-1, 0], e: [1, 0],
  sw: [-1, 1], s: [0, 1], se: [1, 1],
});
const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

function integerVisualBounds(bounds) {
  if (!bounds) return bounds;
  const x = Math.round(Number(bounds.x) || 0);
  const y = Math.round(Number(bounds.y) || 0);
  const right = Math.round((Number(bounds.x) || 0) + (Number(bounds.w) || 0));
  const bottom = Math.round((Number(bounds.y) || 0) + (Number(bounds.h) || 0));
  return {
    ...bounds,
    x,
    y,
    w: Math.max(0, right - x),
    h: Math.max(0, bottom - y),
  };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function withEdgeHandles(geometry) {
  if (!geometry?.handles) return geometry;
  const handles = geometry.handles;
  handles.n = midpoint(handles.nw, handles.ne);
  handles.e = midpoint(handles.ne, handles.se);
  handles.s = midpoint(handles.sw, handles.se);
  handles.w = midpoint(handles.nw, handles.sw);
  return geometry;
}

function handleDirectionWorld(node, corner, pivotBounds, selectionGeometry) {
  const direction = HANDLE_DIRECTIONS[corner];
  if (!direction || !node) return null;
  const bounds = selectionGeometry.sourceGeometryBounds(node);
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const from = selectionGeometry.localToWorld(node, center, pivotBounds);
  const to = selectionGeometry.localToWorld(node, {
    x: center.x + direction[0],
    y: center.y + direction[1],
  }, pivotBounds);
  return { x: to.x - from.x, y: to.y - from.y };
}

function resizeCursorForHandle(node, corner, pivotBounds, selectionGeometry) {
  const vector = handleDirectionWorld(node, corner, pivotBounds, selectionGeometry);
  if (!vector || (Math.abs(vector.x) < 1e-9 && Math.abs(vector.y) < 1e-9)) return 'default';
  let angle = Math.atan2(vector.y, vector.x) * 180 / Math.PI;
  angle = ((angle % 180) + 180) % 180;
  const sector = Math.round(angle / 45) % 4;
  return CURSORS[sector];
}

function svgHandle(point, zoom, sizeForZoom) {
  const size = sizeForZoom(zoom);
  const half = size / 2;
  return `<rect class="selection-handle selection-edge-handle" x="${point.x - half}" y="${point.y - half}" width="${size}" height="${size}"/>`;
}

function installPhotopeaTransformUIRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const R = PE?.renderer;
  const T = PE?.transformModel;
  const G = PE?.selectionGeometry;
  const S = PE?.selectionOverlay;
  const Workspace = PE?.ui?.Workspace;
  const Properties = PE?.ui?.Properties;
  if (!M || !R?.FramebufferRenderer || !T || !G || !S || !Workspace || !Properties) {
    throw new Error('PixelEditor transform UI dependencies are not initialized');
  }
  if (PE.photopeaTransformUIInstalled) return;
  PE.photopeaTransformUIInstalled = true;

  const originalBounds = Properties.prototype.bounds;
  Properties.prototype.bounds = function integerPropertyBounds(nodes) {
    return originalBounds.call(this, nodes).map(integerVisualBounds);
  };

  const originalSelectionGeometry = G.selectionGeometry;
  G.selectionGeometry = function selectionGeometryWithEdges(node, pivotBounds = null) {
    return withEdgeHandles(originalSelectionGeometry(node, pivotBounds));
  };

  const originalHitHandle = G.hitHandle;
  G.hitHandle = function hitEightHandles(node, worldPoint, zoom, pivotBounds = null) {
    const direct = originalHitHandle(node, worldPoint, zoom, pivotBounds);
    if (direct || !BOX_TYPES.has(node?.type)) return direct;
    const geometry = G.selectionGeometry(node, pivotBounds);
    const tolerance = 8 / Math.max(0.01, Number(zoom) || 1);
    for (const corner of EDGE_CORNERS) {
      const point = geometry?.handles?.[corner];
      if (point && Math.hypot(point.x - worldPoint.x, point.y - worldPoint.y) <= tolerance) {
        return { type: 'resize', corner, node, startBounds: { ...geometry.sourceBounds } };
      }
    }
    return null;
  };

  const originalRenderOverlay = Workspace.prototype.renderOverlay;
  Workspace.prototype.renderOverlay = function renderEightHandleOverlay() {
    const result = originalRenderOverlay.call(this);
    if (this.state.selection.ids.length !== 1 || !this.overlay) return result;
    const node = M.nodeById(this.activePage(), this.state.selection.ids[0]);
    if (!node || !BOX_TYPES.has(node.type)) return result;
    const pivot = S.sourcePivotBounds(this, node);
    const geometry = G.selectionGeometry(node, pivot);
    if (!geometry?.handles) return result;
    const dx = this.overlayState.previewMove?.dx || 0;
    const dy = this.overlayState.previewMove?.dy || 0;
    const markup = EDGE_CORNERS.map(corner => {
      const point = geometry.handles[corner];
      return svgHandle({ x: point.x + dx, y: point.y + dy }, this.zoom, S.handleVisualSize);
    }).join('');
    this.overlay.insertAdjacentHTML('beforeend', markup);
    return result;
  };

  function reanchorTransform(editor, node, gesture, anchorLocal, anchorWorld) {
    const base = T.normalizeTransform(gesture?.original?.transform || node.transform);
    node.transform = base;
    const nextPivot = S.sourcePivotBounds(editor, node) || G.sourceGeometryBounds(node);
    const currentAnchor = G.localToWorld(node, anchorLocal, nextPivot);
    node.transform = T.normalizeTransform({
      ...base,
      translateX: (base.translateX || 0) + anchorWorld.x - currentAnchor.x,
      translateY: (base.translateY || 0) + anchorWorld.y - currentAnchor.y,
    });
  }

  const originalUpdateLiveResize = Workspace.prototype.updateLiveResize;
  Workspace.prototype.updateLiveResize = function updateEightHandleResize(gesture, point) {
    if (!EDGE_CORNERS.includes(gesture?.corner)) return originalUpdateLiveResize.call(this, gesture, point);
    const node = M.nodeById(this.activePage(), gesture.nodeId);
    if (!node || !BOX_TYPES.has(node.type)) return originalUpdateLiveResize.call(this, gesture, point);

    const b = gesture.startBounds;
    const left = b.x;
    const top = b.y;
    const right = b.x + b.w;
    const bottom = b.y + b.h;
    const centerX = left + b.w / 2;
    const centerY = top + b.h / 2;
    const mappingNode = gesture.original || node;
    const pivot = gesture.pivotBounds || G.sourceGeometryBounds(mappingNode);
    const raw = G.worldToLocal(mappingNode, point, pivot);
    const local = { x: Math.round(raw.x), y: Math.round(raw.y) };
    const ratio = b.w / Math.max(1, b.h);

    let x = left;
    let y = top;
    let w = b.w;
    let h = b.h;
    let anchorLocal;

    if (gesture.corner === 'e' || gesture.corner === 'w') {
      const anchorX = gesture.corner === 'e' ? left : right;
      w = Math.max(1, Math.abs(local.x - anchorX));
      x = gesture.corner === 'w' ? Math.round(anchorX - w) : Math.round(anchorX);
      anchorLocal = { x: anchorX, y: centerY };
      if (node.aspectLocked) {
        h = Math.max(1, Math.round(w / Math.max(1e-9, ratio)));
        y = Math.round(centerY - h / 2);
      }
    } else {
      const anchorY = gesture.corner === 's' ? top : bottom;
      h = Math.max(1, Math.abs(local.y - anchorY));
      y = gesture.corner === 'n' ? Math.round(anchorY - h) : Math.round(anchorY);
      anchorLocal = { x: centerX, y: anchorY };
      if (node.aspectLocked) {
        w = Math.max(1, Math.round(h * ratio));
        x = Math.round(centerX - w / 2);
      }
    }

    const anchorWorld = G.localToWorld(mappingNode, anchorLocal, pivot);
    const geometry = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    if (node.type === 'raster' && PE.rasterLayer?.resizeRaster) {
      Object.assign(node, PE.rasterLayer.resizeRaster(gesture.original, geometry));
    } else {
      Object.assign(node, geometry);
    }
    reanchorTransform(this, node, gesture, anchorLocal, anchorWorld);
    this.renderCanvas();
    this.renderOverlay();
    this.properties.render();
  };

  const originalPointerMove = Workspace.prototype.onPointerMove;
  Workspace.prototype.onPointerMove = function onPointerMoveWithTransformCursor(event) {
    const result = originalPointerMove.call(this, event);
    if (this.tool !== 'pointer' || this.customGesture || this.spaceDown || this.interaction?.mode !== 'Idle') return result;
    const point = this.logicalPointFloat(event);
    const handle = this.selectionHandleAt(point);
    if (handle?.type !== 'resize' || !handle.node) return result;
    const pivot = S.sourcePivotBounds(this, handle.node);
    this.canvas.style.cursor = resizeCursorForHandle(handle.node, handle.corner, pivot, G);
    return result;
  };

  PE.photopeaTransformUI = {
    integerVisualBounds,
    withEdgeHandles,
    resizeCursorForHandle,
  };
}

export {
  integerVisualBounds,
  withEdgeHandles,
  resizeCursorForHandle,
  installPhotopeaTransformUIRuntime,
};
