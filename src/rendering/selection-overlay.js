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

  const originalBeginLiveHandle = Workspace.prototype.beginLiveHandle;
  Workspace.prototype.beginLiveHandle = function beginTransformAwareLiveHandle(handle, point) {
    const pivotBounds = handle?.node ? sourcePivotBounds(this, handle.node) : null;
    const result = originalBeginLiveHandle.call(this, handle, point);
    if (this.customGesture && handle?.node && this.customGesture.nodeId === handle.node.id) {
      this.customGesture.pivotBounds = pivotBounds;
    }
    return result;
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
    const anchorLocal = { x: anchorX, y: anchorY };
    const mappingNode = gesture.original || node;
    const pivotBounds = gesturePivotBounds(gesture, mappingNode);
    const anchorWorld = G.localToWorld(mappingNode, anchorLocal, pivotBounds);
    const rawLocalPoint = G.worldToLocal(mappingNode, point, pivotBounds);
    const localPoint = {
      x: Math.round(rawLocalPoint.x),
      y: Math.round(rawLocalPoint.y),
    };
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
      x: Math.round(west ? anchorX - w : anchorX),
      y: Math.round(north ? anchorY - h : anchorY),
      w: Math.round(w),
      h: Math.round(h),
    };
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

  const originalUpdateLivePoint = Workspace.prototype.updateLivePoint;
  Workspace.prototype.updateLivePoint = function updateTransformAwareLivePoint(gesture, point) {
    const node = M.nodeById(this.activePage(), gesture.nodeId);
    if (!node || (node.type !== 'line' && node.type !== 'polygon')) {
      return originalUpdateLivePoint.call(this, gesture, point);
    }
    const mappingNode = gesture.original || node;
    const pivotBounds = gesturePivotBounds(gesture, mappingNode);
    const rawLocalPoint = G.worldToLocal(mappingNode, point, pivotBounds);
    const localPoint = {
      x: Math.round(rawLocalPoint.x),
      y: Math.round(rawLocalPoint.y),
    };
    let anchorLocal = null;
    if (node.type === 'line') {
      anchorLocal = gesture.index === 0
        ? { x: mappingNode.x2, y: mappingNode.y2 }
        : { x: mappingNode.x1, y: mappingNode.y1 };
    } else {
      const anchorIndex = (mappingNode.points || []).findIndex((_, index) => index !== gesture.index);
      if (anchorIndex >= 0) anchorLocal = { ...mappingNode.points[anchorIndex] };
    }
    const anchorWorld = anchorLocal ? G.localToWorld(mappingNode, anchorLocal, pivotBounds) : null;
    if (node.type === 'polygon') node.points[gesture.index] = localPoint;
    else if (gesture.index === 0) { node.x1 = localPoint.x; node.y1 = localPoint.y; }
    else { node.x2 = localPoint.x; node.y2 = localPoint.y; }
    if (anchorLocal && anchorWorld) reanchorTransform(this, node, gesture, anchorLocal, anchorWorld);
    else node.transform = T.normalizeTransform(mappingNode.transform);
    this.renderCanvas();
    this.renderOverlay();
    this.properties.render();
  };

  const originalCommitLiveHandle = Workspace.prototype.commitLiveHandle;
  Workspace.prototype.commitLiveHandle = function commitTransformAwareLiveHandle(gesture) {
    if (!gesture || !['resize-live', 'polygon-point-live', 'line-point-live'].includes(gesture.type)) {
      return originalCommitLiveHandle.call(this, gesture);
    }
    const page = this.activePage();
    const node = M.nodeById(page, gesture.nodeId);
    if (!node || !gesture.original) return false;
    let patch;
    if (gesture.type === 'resize-live') {
      patch = {
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        transform: structuredClone(T.normalizeTransform(node.transform)),
      };
      if (node.type === 'raster' && node.raster) patch.raster = structuredClone(node.raster);
    } else if (gesture.type === 'polygon-point-live') {
      patch = {
        points: structuredClone(node.points),
        transform: structuredClone(T.normalizeTransform(node.transform)),
      };
    } else {
      patch = {
        x1: node.x1,
        y1: node.y1,
        x2: node.x2,
        y2: node.y2,
        transform: structuredClone(T.normalizeTransform(node.transform)),
      };
    }
    Object.assign(node, structuredClone(gesture.original));
    return this.exec(new C.UpdateNodesCommand(
      [gesture.nodeId],
      patch,
      page.id,
      gesture.type === 'resize-live' ? '调整大小' : '移动控制点',
    ));
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
