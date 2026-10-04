function unionBounds(bounds) {
  const items = (bounds || []).filter(item => item && Number.isFinite(item.x) && Number.isFinite(item.y));
  if (!items.length) return null;
  const x = Math.min(...items.map(item => item.x));
  const y = Math.min(...items.map(item => item.y));
  const right = Math.max(...items.map(item => item.x + item.w));
  const bottom = Math.max(...items.map(item => item.y + item.h));
  return { x, y, w: right - x, h: bottom - y };
}

function centerOf(bounds) {
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

function rotatePointAround(point, pivot, degrees) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + cos * dx - sin * dy,
    y: pivot.y + sin * dx + cos * dy,
  };
}

function reflectPointAround(point, pivot, axis) {
  if (axis === 'horizontal') return { x: pivot.x * 2 - point.x, y: point.y };
  return { x: point.x, y: pivot.y * 2 - point.y };
}

function modifiableSelectionRoots(page, selection, Model) {
  if (!page || !selection) return [];
  const tree = new Model.TreeModel(page);
  return selection.transformRoots(tree).filter(id => {
    const node = tree.node(id);
    return Boolean(node) && !tree.isEffectivelyLocked(id);
  });
}

function collectModifiableSubtree(page, roots, Model) {
  const tree = new Model.TreeModel(page);
  const output = [];
  const seen = new Set();
  const visit = id => {
    if (seen.has(id) || tree.isEffectivelyLocked(id)) return;
    const node = tree.node(id);
    if (!node) return;
    seen.add(id);
    output.push(node);
    for (const child of tree.childrenOf(id)) visit(child.id);
  };
  for (const id of roots || []) visit(id);
  return output;
}

function nodeVisualBounds(node, editor, Renderer) {
  return Renderer.FramebufferRenderer.visualBounds(node.id, {
    project: editor.state.project,
    pageId: editor.activePage().id,
    assets: editor.state.assets,
  });
}

function selectionVisualBounds(editor, nodes, Renderer, Model) {
  const tree = new Model.TreeModel(editor.activePage());
  const visible = (nodes || []).filter(node => tree.isEffectivelyVisible(node.id));
  const source = visible.length ? visible : nodes;
  return unionBounds((source || []).map(node => nodeVisualBounds(node, editor, Renderer)));
}

function moveSubtreeFractional(page, rootId, dx, dy, Model, TransformModel) {
  const tree = new Model.TreeModel(page);
  let changed = false;
  const visit = id => {
    if (tree.isEffectivelyLocked(id)) return;
    const node = tree.node(id);
    if (!node) return;
    TransformModel.moveNodeGeometry(node, dx, dy);
    changed = true;
    for (const child of tree.childrenOf(id)) visit(child.id);
  };
  visit(rootId);
  return changed;
}

function composeRotate(transform, degrees, TransformModel) {
  const current = TransformModel.normalizeTransform(transform);
  return {
    rotation: TransformModel.normalizeRotation(current.rotation + degrees),
    flipX: current.flipX,
    flipY: current.flipY,
    translateX: current.translateX,
    translateY: current.translateY,
  };
}

function composeFlip(transform, axis, TransformModel) {
  const current = TransformModel.normalizeTransform(transform);
  if (axis === 'horizontal') {
    return {
      rotation: TransformModel.normalizeRotation(-current.rotation),
      flipX: !current.flipX,
      flipY: current.flipY,
      translateX: current.translateX,
      translateY: current.translateY,
    };
  }
  return {
    rotation: TransformModel.normalizeRotation(-current.rotation),
    flipX: current.flipX,
    flipY: !current.flipY,
    translateX: current.translateX,
    translateY: current.translateY,
  };
}

function canonicalSourceBounds(node, TransformModel) {
  return TransformModel.nodeLocalBounds(node);
}

function canonicalSourceCenter(node, TransformModel) {
  return centerOf(canonicalSourceBounds(node, TransformModel));
}

function transformedSourceCenter(node, TransformModel) {
  const source = canonicalSourceCenter(node, TransformModel);
  const transform = TransformModel.normalizeTransform(node.transform);
  return {
    x: source.x + (transform.translateX || 0),
    y: source.y + (transform.translateY || 0),
  };
}

function canonicalTransformedBounds(node, TransformModel) {
  return TransformModel.transformedBounds(node);
}

function nearestEvenInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) < 1e-9) return 0;
  const lower = Math.floor(number);
  const fraction = number - lower;
  if (Math.abs(fraction - 0.5) < 1e-9) return Math.abs(lower % 2) === 0 ? lower : lower + 1;
  return Math.round(number);
}

function placeTransformAtCenter(transform, center, source, TransformModel) {
  return TransformModel.normalizeTransform({
    ...transform,
    translateX: nearestEvenInteger(center.x - source.x),
    translateY: nearestEvenInteger(center.y - source.y),
  });
}

function rasterSourceBounds(node) {
  return {
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    w: Math.max(1, Number(node.w) || 1),
    h: Math.max(1, Number(node.h) || 1),
  };
}

function screenPointToRasterPixel(node, point, TransformModel = globalThis.PixelEditor?.transformModel) {
  if (!node || node.type !== 'raster' || !TransformModel) return null;
  const bounds = rasterSourceBounds(node);
  const matrix = TransformModel.nodeTransformMatrix(node, bounds);
  const local = TransformModel.inverseTransformPoint(matrix, {
    x: Number(point.x) + 0.5,
    y: Number(point.y) + 0.5,
  });
  return {
    x: Math.floor(local.x - bounds.x),
    y: Math.floor(local.y - bounds.y),
  };
}

function rasterPixelToScreenPoint(node, pixel, TransformModel = globalThis.PixelEditor?.transformModel) {
  if (!node || node.type !== 'raster' || !TransformModel) return null;
  const bounds = rasterSourceBounds(node);
  const matrix = TransformModel.nodeTransformMatrix(node, bounds);
  return TransformModel.transformPoint(matrix, {
    x: bounds.x + Number(pixel.x) + 0.5,
    y: bounds.y + Number(pixel.y) + 0.5,
  });
}

function rasterPixelCornersToScreen(node, pixel, TransformModel = globalThis.PixelEditor?.transformModel) {
  if (!node || node.type !== 'raster' || !TransformModel) return [];
  const bounds = rasterSourceBounds(node);
  const matrix = TransformModel.nodeTransformMatrix(node, bounds);
  const x = bounds.x + Number(pixel.x);
  const y = bounds.y + Number(pixel.y);
  return [
    TransformModel.transformPoint(matrix, { x, y }),
    TransformModel.transformPoint(matrix, { x: x + 1, y }),
    TransformModel.transformPoint(matrix, { x: x + 1, y: y + 1 }),
    TransformModel.transformPoint(matrix, { x, y: y + 1 }),
  ];
}

function installSelectionTransformRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const R = PE?.renderer;
  const Workspace = PE?.ui?.Workspace;
  const T = PE?.transformModel;
  const Raster = PE?.tristateRaster;
  if (!M || !C || !R?.FramebufferRenderer || !Workspace || !T || !Raster) {
    throw new Error('PixelEditor selection transform dependencies are not initialized');
  }
  if (PE.selectionTransformInstalled) return;
  PE.selectionTransformInstalled = true;

  function affectedNodes(state, ids, pageId) {
    const page = M.pageById(state.project, pageId || state.project.activePageId);
    const selection = new M.SelectionSet(ids || []);
    const roots = modifiableSelectionRoots(page, selection, M);
    return { page, roots, nodes: collectModifiableSubtree(page, roots, M) };
  }

  class SelectionTransformCommand {
    constructor(ids, action, value, pageId, assets) {
      this.ids = [...ids];
      this.action = action;
      this.value = value;
      this.pageId = pageId;
      this.assets = assets;
      this.label = action === 'flip-horizontal' ? '水平翻转'
        : action === 'flip-vertical' ? '垂直翻转'
          : action === 'rotate-ccw-90' ? '逆时针旋转 90°'
            : action === 'rotate-cw-90' ? '顺时针旋转 90°' : '旋转';
    }

    execute(state) {
      const { page, roots, nodes } = affectedNodes(state, this.ids, this.pageId);
      if (!page || !roots.length || !nodes.length) return false;
      const mode = this.action;
      let angle = Number(this.value) || 0;
      if (mode === 'rotate-cw-90') angle = 90;
      else if (mode === 'rotate-ccw-90') angle = -90;
      else if (mode === 'rotate-angle') angle = T.normalizeRotation(angle);
      if (mode.startsWith('rotate') && angle === 0) return false;
      if (!['rotate-cw-90', 'rotate-ccw-90', 'rotate-angle', 'flip-horizontal', 'flip-vertical'].includes(mode)) return false;

      const tree = new M.TreeModel(page);
      const visible = nodes.filter(node => tree.isEffectivelyVisible(node.id));
      const pivotNodes = visible.length ? visible : nodes;
      const groupBounds = unionBounds(pivotNodes.map(node => canonicalTransformedBounds(node, T)));
      if (!groupBounds) return false;
      const pivot = centerOf(groupBounds);
      const before = nodes.map(node => ({
        node,
        sourceCenter: canonicalSourceCenter(node, T),
        center: transformedSourceCenter(node, T),
        transform: T.normalizeTransform(node.transform),
      }));

      for (const item of before) {
        const nextCenter = mode.startsWith('rotate')
          ? rotatePointAround(item.center, pivot, angle)
          : reflectPointAround(item.center, pivot, mode === 'flip-horizontal' ? 'horizontal' : 'vertical');
        const orientation = mode.startsWith('rotate')
          ? composeRotate(item.transform, angle, T)
          : composeFlip(item.transform, mode === 'flip-horizontal' ? 'horizontal' : 'vertical', T);
        item.node.transform = placeTransformAtCenter(orientation, nextCenter, item.sourceCenter, T);
      }
      return true;
    }
  }

  class VisualAlignCommand {
    constructor(mode, ids, pageId, assets) {
      this.mode = mode;
      this.ids = [...ids];
      this.pageId = pageId;
      this.assets = assets;
      this.label = '对齐';
    }
    execute(state) {
      const page = M.pageById(state.project, this.pageId || state.project.activePageId);
      const roots = modifiableSelectionRoots(page, new M.SelectionSet(this.ids), M);
      if (roots.length < 2) return false;
      const context = { project: state.project, pageId: page.id, assets: this.assets || state.assets };
      const bounds = roots.map(id => R.FramebufferRenderer.visualBounds(id, context));
      const group = unionBounds(bounds);
      let changed = false;
      for (let index = 0; index < roots.length; index += 1) {
        const current = bounds[index];
        let dx = 0;
        let dy = 0;
        if (this.mode === 'left') dx = group.x - current.x;
        else if (this.mode === 'right') dx = group.x + group.w - (current.x + current.w);
        else if (this.mode === 'hcenter') dx = group.x + group.w / 2 - (current.x + current.w / 2);
        else if (this.mode === 'top') dy = group.y - current.y;
        else if (this.mode === 'bottom') dy = group.y + group.h - (current.y + current.h);
        else if (this.mode === 'vcenter') dy = group.y + group.h / 2 - (current.y + current.h / 2);
        if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) changed = moveSubtreeFractional(page, roots[index], dx, dy, M, T) || changed;
      }
      return changed;
    }
  }

  class VisualDistributeCommand {
    constructor(axis, ids, pageId, assets) {
      this.axis = axis;
      this.ids = [...ids];
      this.pageId = pageId;
      this.assets = assets;
      this.label = axis === 'horizontal' ? '水平分布' : '垂直分布';
    }
    execute(state) {
      const page = M.pageById(state.project, this.pageId || state.project.activePageId);
      const roots = modifiableSelectionRoots(page, new M.SelectionSet(this.ids), M);
      if (roots.length < 3) return false;
      const context = { project: state.project, pageId: page.id, assets: this.assets || state.assets };
      const horizontal = this.axis === 'horizontal';
      const items = roots.map(id => ({ id, bounds: R.FramebufferRenderer.visualBounds(id, context) }));
      items.sort((a, b) => horizontal
        ? (a.bounds.x + a.bounds.w / 2) - (b.bounds.x + b.bounds.w / 2)
        : (a.bounds.y + a.bounds.h / 2) - (b.bounds.y + b.bounds.h / 2));
      const start = horizontal ? items[0].bounds.x : items[0].bounds.y;
      const last = items.at(-1).bounds;
      const end = horizontal ? last.x + last.w : last.y + last.h;
      const total = items.reduce((sum, item) => sum + (horizontal ? item.bounds.w : item.bounds.h), 0);
      const gap = (end - start - total) / (items.length - 1);
      let cursor = start;
      let changed = false;
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const current = horizontal ? item.bounds.x : item.bounds.y;
        const delta = cursor - current;
        if (index > 0 && index < items.length - 1 && Math.abs(delta) > 1e-9) {
          changed = moveSubtreeFractional(page, item.id, horizontal ? delta : 0, horizontal ? 0 : delta, M, T) || changed;
        }
        cursor += (horizontal ? item.bounds.w : item.bounds.h) + gap;
      }
      return changed;
    }
  }

  C.SelectionTransformCommand = SelectionTransformCommand;
  C.VisualAlignCommand = VisualAlignCommand;
  C.VisualDistributeCommand = VisualDistributeCommand;

  Workspace.prototype.runSelectionTransform = function runSelectionTransform(action, value = 0) {
    if (!this.state.selection.ids.length) return false;
    if (action === 'rotate-angle' && T.normalizeRotation(value) === 0) return false;
    return this.exec(new SelectionTransformCommand(
      this.state.selection.ids,
      action,
      value,
      this.activePage().id,
      this.state.assets,
    ));
  };

  Workspace.prototype.align = function alignTransformed(mode) {
    if (this.state.selection.ids.length < 2) return false;
    return this.exec(new VisualAlignCommand(mode, this.state.selection.ids, this.activePage().id, this.state.assets));
  };

  Workspace.prototype.distribute = function distributeTransformed(axis) {
    if (this.state.selection.ids.length < 3) return false;
    return this.exec(new VisualDistributeCommand(axis, this.state.selection.ids, this.activePage().id, this.state.assets));
  };

  const previousApplyPaintSegment = Workspace.prototype.applyPaintSegment;
  Workspace.prototype.applyPaintSegment = function applyPaintSegmentInRasterCoordinates(gesture, a, b) {
    if (gesture?.targetKind !== 'raster') return previousApplyPaintSegment.call(this, gesture, a, b);
    const node = M.nodeById(this.activePage(), gesture.nodeId);
    if (!node || node.type !== 'raster') return false;
    const localPath = this.linePoints(a, b)
      .map(point => screenPointToRasterPixel(node, point, T))
      .filter(Boolean)
      .map(point => ({ x: point.x, y: point.y }));
    const localPoints = PE.paintBrush?.expandBrushPoints
      ? PE.paintBrush.expandBrushPoints(localPath, gesture.brushWidth)
      : localPath;
    const before = node.raster.data;
    node.raster = Raster.paintTriStateRaster(node, localPoints, gesture.value);
    const changed = node.raster.data !== before;
    gesture.changed ||= changed;
    return changed;
  };

  PE.selectionTransform = {
    unionBounds,
    centerOf,
    rotatePointAround,
    reflectPointAround,
    modifiableSelectionRoots: (page, selection) => modifiableSelectionRoots(page, selection, M),
    collectModifiableSubtree: (page, roots) => collectModifiableSubtree(page, roots, M),
    selectionVisualBounds: (editor, nodes) => selectionVisualBounds(editor, nodes, R, M),
    canonicalSourceBounds: node => canonicalSourceBounds(node, T),
    canonicalSourceCenter: node => canonicalSourceCenter(node, T),
    canonicalTransformedBounds: node => canonicalTransformedBounds(node, T),
    composeRotate: (transform, degrees) => composeRotate(transform, degrees, T),
    composeFlip: (transform, axis) => composeFlip(transform, axis, T),
    screenPointToRasterPixel: (node, point) => screenPointToRasterPixel(node, point, T),
    rasterPixelToScreenPoint: (node, pixel) => rasterPixelToScreenPoint(node, pixel, T),
    rasterPixelCornersToScreen: (node, pixel) => rasterPixelCornersToScreen(node, pixel, T),
    SelectionTransformCommand,
    VisualAlignCommand,
    VisualDistributeCommand,
  };
}

export {
  unionBounds,
  centerOf,
  rotatePointAround,
  reflectPointAround,
  modifiableSelectionRoots,
  collectModifiableSubtree,
  selectionVisualBounds,
  canonicalSourceBounds,
  canonicalSourceCenter,
  canonicalTransformedBounds,
  composeRotate,
  composeFlip,
  screenPointToRasterPixel,
  rasterPixelToScreenPoint,
  rasterPixelCornersToScreen,
  installSelectionTransformRuntime,
};