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
  const C = PE?.commands;
  const R = PE?.renderer;
  const Workspace = PE?.ui?.Workspace;
  const T = PE?.transformModel;
  const G = PE?.selectionGeometry;
  if (!M || !C?.UpdateNodesCommand || !R?.FramebufferRenderer || !Workspace || !T || !G) {
    throw new Error('PixelEditor selection geometry is not initialized');
  }
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

  function sourcePivotBounds(editor, node) {
    if (!editor || !node) return null;
    const context = {
      project: editor.state.project,
      pageId: editor.activePage().id,
      assets: editor.state.assets,
    };
    const visual = R.FramebufferRenderer.visualBounds(node.id, context);
    const transform = T.normalizeTransform(node.transform);
    const centerX = visual.x + visual.w / 2 - (transform.translateX || 0);
    const centerY = visual.y + visual.h / 2 - (transform.translateY || 0);
    return { x: centerX, y: centerY, w: 0, h: 0 };
  }

  function gesturePivotBounds(gesture, node) {
    return gesture?.pivotBounds || G.sourceGeometryBounds(gesture?.original || node);
  }

  function reanchorTransform(editor, node, gesture, anchorLocal, anchorWorld) {
    const base = T.normalizeTransform(gesture?.original?.transform || node.transform);
    node.transform = base;
    const nextPivot = sourcePivotBounds(editor, node) || G.sourceGeometryBounds(node);
    const currentAnchor = G.localToWorld(node, anchorLocal, nextPivot);
    node.transform = T.normalizeTransform({
      ...base,
      translateX: (base.translateX || 0) + anchorWorld.x - currentAnchor.x,
      translateY: (base.translateY || 0) + anchorWorld.y - currentAnchor.y,
    });
  }

  function outlineMarkup(node, dx = 0, dy = 0, pivotBounds = null) {
    const geometry = G.selectionGeometry(node, pivotBounds);
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

  function selectionMarkup(editor) {
    const page = editor.activePage();
    if (!page) return '';
    const preview = editor.overlayState?.previewMove;
    const dx = preview?.dx || 0;
    const dy = preview?.dy || 0;
    let html = '';
    for (const id of editor.state.selection.ids) {
      const node = M.nodeById(page, id);
      if (node) html += outlineMarkup(node, dx, dy, sourcePivotBounds(editor, node));
    }
    return html;
  }

  function handlesMarkup(editor) {
    const page = editor.activePage();
    const ids = editor.state.selection.ids;
    if (!page || ids.length !== 1) return '';
    const node = M.nodeById(page, ids[0]);
    const geometry = node ? G.selectionGeometry(node, sourcePivotBounds(editor, node)) : null;
    if (!geometry) return '';
    const preview = editor.overlayState?.previewMove;
    const dx = preview?.dx || 0;
    const dy = preview?.dy || 0;
    const handles = BOX_TYPES.has(node.type)
      ? ['nw', 'ne', 'sw', 'se'].map(corner => geometry.handles[corner])
      : geometry.controlPoints;
    return handles.map(point => handleRect(translated(point, dx, dy), editor.zoom)).join('');
  }

  Workspace.prototype.selectionHandleAt = function selectionHandleAt(point) {
    const ids = this.state.selection.ids;
    if (ids.length !== 1) return null;
    const page = this.activePage();
    const node = M.nodeById(page, ids[0]);
    const tree = new M.TreeModel(page);
    if (!node || tree.isEffectivelyLocked(node.id)) return null;
    return G.hitHandle(node, point, this.zoom, sourcePivotBounds(this, node));
  };

  PE.selectionOverlay = {
    boxHandlePoints,
    hitBoxHandle,
    handleVisualSize,
    handleHitTolerance,
    sourceGeometryBounds: G.sourceGeometryBounds,
    sourcePivotBounds,
    selectionGeometry: G.selectionGeometry,
    outlineMarkup,
    selectionMarkup,
    handlesMarkup,
  };
}

export { handleVisualSize, handleHitTolerance, installSelectionOverlayRuntime };
