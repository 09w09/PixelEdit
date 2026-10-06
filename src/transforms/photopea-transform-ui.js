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

function edgeHandlesMarkup(editor, { model, selectionGeometry, selectionOverlay } = {}) {
  if (!editor || !model || !selectionGeometry || !selectionOverlay) return '';
  if (editor.state.selection.ids.length !== 1) return '';
  const node = model.nodeById(editor.activePage(), editor.state.selection.ids[0]);
  if (!node || !BOX_TYPES.has(node.type)) return '';
  const pivot = selectionOverlay.sourcePivotBounds(editor, node);
  const geometry = selectionGeometry.selectionGeometry(node, pivot);
  if (!geometry?.handles) return '';
  const dx = editor.overlayState.previewMove?.dx || 0;
  const dy = editor.overlayState.previewMove?.dy || 0;
  return EDGE_CORNERS.map(corner => {
    const point = geometry.handles[corner];
    return svgHandle({ x: point.x + dx, y: point.y + dy }, editor.zoom, selectionOverlay.handleVisualSize);
  }).join('');
}

export {
  integerVisualBounds,
  withEdgeHandles,
  resizeCursorForHandle,
  edgeHandlesMarkup,
};
