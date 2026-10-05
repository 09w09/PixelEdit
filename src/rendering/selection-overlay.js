import { nodeById, TreeModel } from '../model/index.js';
import { FramebufferRenderer } from './renderer.js';
import { transformModel } from '../transforms/transform-model.js';
import { selectionGeometry } from '../selection/selection-geometry.js';

const BOX_TYPES = new Set(['rectangle', 'circle', 'text', 'image', 'raster']);
const safeZoom = zoom => Math.max(0.01, Number(zoom) || 1);
const handleVisualSize = (zoom, cssPx = 10) => cssPx / safeZoom(zoom);
const handleHitTolerance = (zoom, cssPx = 8) => cssPx / safeZoom(zoom);
const translated = (point, dx = 0, dy = 0) => ({ ...point, x: point.x + dx, y: point.y + dy });

function handleRect(point, zoom) {
  const size = handleVisualSize(zoom), half = size / 2;
  return `<rect class="selection-handle" x="${point.x - half}" y="${point.y - half}" width="${size}" height="${size}"/>`;
}

function createSelectionOverlay({ geometry = selectionGeometry, transforms = transformModel, renderer = FramebufferRenderer } = {}) {
  const boxHandlePoints = bounds => ['nw', 'ne', 'sw', 'se'].map(corner => ({ ...geometry.sourceHandles(bounds)[corner], corner }));
  const hitBoxHandle = (bounds, point, zoom) => {
    const tolerance = handleHitTolerance(zoom);
    for (const handle of boxHandlePoints(bounds)) if (Math.hypot(handle.x - point.x, handle.y - point.y) <= tolerance) return handle;
    return null;
  };
  function sourcePivotBounds(editor, node) {
    if (!editor || !node) return null;
    const context = { project: editor.state.project, pageId: editor.activePage().id, assets: editor.state.assets };
    const visual = renderer.visualBounds(node.id, context), transform = transforms.normalizeTransform(node.transform);
    return { x: visual.x + visual.w / 2 - (transform.translateX || 0), y: visual.y + visual.h / 2 - (transform.translateY || 0), w: 0, h: 0 };
  }
  function outlineMarkup(node, dx = 0, dy = 0, pivotBounds = null) {
    const shape = geometry.selectionGeometry(node, pivotBounds);
    if (!shape) return '';
    if (node.type === 'line') {
      const [a, b] = shape.controlPoints.map(point => translated(point, dx, dy));
      return a && b ? `<line class="selection-box" vector-effect="non-scaling-stroke" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>` : '';
    }
    if (node.type === 'polygon') {
      const points = shape.outline.map(point => translated(point, dx, dy));
      return `<polygon class="selection-box" vector-effect="non-scaling-stroke" points="${points.map(point => `${point.x},${point.y}`).join(' ')}"/>`;
    }
    if (BOX_TYPES.has(node.type)) {
      if (transforms.isIdentityTransform(node.transform)) {
        const bounds = shape.sourceBounds;
        return `<rect class="selection-box" vector-effect="non-scaling-stroke" x="${bounds.x + dx}" y="${bounds.y + dy}" width="${bounds.w}" height="${bounds.h}"/>`;
      }
      const points = shape.outline.map(point => translated(point, dx, dy));
      return `<polygon class="selection-box" vector-effect="non-scaling-stroke" points="${points.map(point => `${point.x},${point.y}`).join(' ')}"/>`;
    }
    return '';
  }
  function selectionMarkup(editor) {
    const page = editor.activePage();
    if (!page) return '';
    const preview = editor.overlayState?.previewMove, dx = preview?.dx || 0, dy = preview?.dy || 0;
    let html = '';
    for (const id of editor.state.selection.ids) {
      const node = nodeById(page, id);
      if (node) html += outlineMarkup(node, dx, dy, sourcePivotBounds(editor, node));
    }
    return html;
  }
  function handlesMarkup(editor) {
    const page = editor.activePage(), ids = editor.state.selection.ids;
    if (!page || ids.length !== 1) return '';
    const node = nodeById(page, ids[0]);
    const shape = node ? geometry.selectionGeometry(node, sourcePivotBounds(editor, node)) : null;
    if (!shape) return '';
    const preview = editor.overlayState?.previewMove, dx = preview?.dx || 0, dy = preview?.dy || 0;
    const handles = BOX_TYPES.has(node.type) ? ['nw', 'ne', 'sw', 'se'].map(corner => shape.handles[corner]) : shape.controlPoints;
    return handles.map(point => handleRect(translated(point, dx, dy), editor.zoom)).join('');
  }
  function selectionHandleAt(editor, point) {
    const ids = editor.state.selection.ids;
    if (ids.length !== 1) return null;
    const page = editor.activePage(), node = nodeById(page, ids[0]), tree = new TreeModel(page);
    if (!node || tree.isEffectivelyLocked(node.id)) return null;
    return geometry.hitHandle(node, point, editor.zoom, sourcePivotBounds(editor, node));
  }
  return Object.freeze({
    boxHandlePoints,
    hitBoxHandle,
    handleVisualSize,
    handleHitTolerance,
    sourceGeometryBounds: geometry.sourceGeometryBounds,
    sourcePivotBounds,
    selectionGeometry: geometry.selectionGeometry,
    outlineMarkup,
    selectionMarkup,
    handlesMarkup,
    selectionHandleAt,
  });
}

const selectionOverlay = createSelectionOverlay();

function installSelectionOverlayRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE) throw new Error('PixelEditor is not initialized');
  PE.selectionOverlay = selectionOverlay;
  return selectionOverlay;
}

export { handleVisualSize, handleHitTolerance, createSelectionOverlay, selectionOverlay, installSelectionOverlayRuntime };
