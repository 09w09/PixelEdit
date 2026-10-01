const CANVAS_BOUNDS = Object.freeze({ x: 0, y: 0, w: 400, h: 300 });

function finiteBounds(bounds) {
  if (!bounds) return null;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const w = Number(bounds.w);
  const h = Number(bounds.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

function intersectBounds(a, b) {
  const left = finiteBounds(a);
  const right = finiteBounds(b);
  if (!left || !right) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const endX = Math.min(left.x + left.w, right.x + right.w);
  const endY = Math.min(left.y + left.h, right.y + right.h);
  return { x, y, w: Math.max(0, endX - x), h: Math.max(0, endY - y) };
}

function hasArea(bounds) {
  return Boolean(bounds && bounds.w > 0 && bounds.h > 0);
}

function containsPixel(bounds, x, y) {
  return hasArea(bounds)
    && x >= bounds.x && y >= bounds.y
    && x < bounds.x + bounds.w && y < bounds.y + bounds.h;
}

function unionBounds(items) {
  const bounds = (items || []).map(finiteBounds).filter(hasArea);
  if (!bounds.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...bounds.map(item => item.x));
  const y = Math.min(...bounds.map(item => item.y));
  const right = Math.max(...bounds.map(item => item.x + item.w));
  const bottom = Math.max(...bounds.map(item => item.y + item.h));
  return { x, y, w: right - x, h: bottom - y };
}

function installHierarchyClippingRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const R = PE?.renderer;
  const framebuffer = R?.FramebufferRenderer;
  if (!M?.TreeModel || !framebuffer?._drawNode || !framebuffer?._drawPageBackground || !framebuffer?._bounds) {
    throw new Error('PixelEditor hierarchy clipping dependencies are not initialized');
  }
  if (PE.hierarchyClippingInstalled) return;
  PE.hierarchyClippingInstalled = true;

  const rawBoundsForNode = node => finiteBounds(framebuffer._bounds(node)) || { x: 0, y: 0, w: 0, h: 0 };
  const originalPlotPixel = R.plotPixel;

  function withClip(frame, clip, render) {
    if (!hasArea(clip)) return;
    const previous = R.plotPixel;
    R.plotPixel = function plotClippedPixel(targetFrame, x, y, value) {
      if (targetFrame === frame && !containsPixel(clip, x, y)) return;
      return previous(targetFrame, x, y, value);
    };
    try {
      render();
    } finally {
      R.plotPixel = previous;
    }
  }

  function ancestorClip(tree, nodeId, getBounds = id => rawBoundsForNode(tree.node(id))) {
    let clip = { ...CANVAS_BOUNDS };
    let node = tree.node(nodeId);
    const visited = new Set();
    while (node?.parentId && !visited.has(node.parentId)) {
      visited.add(node.parentId);
      const parent = tree.node(node.parentId);
      if (!parent) break;
      clip = intersectBounds(clip, getBounds(parent.id));
      if (!hasArea(clip)) break;
      node = parent;
    }
    return clip;
  }

  function walkSubtree(frame, tree, id, context, clip) {
    const node = tree.node(id);
    if (!node || node.visible === false || !hasArea(clip)) return;
    withClip(frame, clip, () => framebuffer._drawNode(frame, node, context));
    const childClip = intersectBounds(clip, rawBoundsForNode(node));
    if (!hasArea(childClip)) return;
    for (const child of tree.childrenOf(id)) walkSubtree(frame, tree, child.id, context, childClip);
  }

  function renderPage(project, pageId, assets) {
    const page = M.pageById(project, pageId);
    if (!page) throw new Error('page not found');
    const frame = new Uint8Array(400 * 300);
    const tree = new M.TreeModel(page);
    const context = { project, page, tree, assets };
    framebuffer._drawPageBackground(frame, page);
    for (const root of tree.roots()) walkSubtree(frame, tree, root.id, context, CANVAS_BOUNDS);
    return frame;
  }

  function renderSubtree(project, pageId, nodeId, assets, base = 0) {
    const page = M.pageById(project, pageId);
    if (!page) throw new Error('page not found');
    const frame = new Uint8Array(400 * 300);
    frame.fill(base ? 1 : 0);
    const tree = new M.TreeModel(page);
    const context = { project, page, tree, assets };
    if (tree.node(nodeId)) walkSubtree(frame, tree, nodeId, context, ancestorClip(tree, nodeId));
    return frame;
  }

  function clippedVisualBounds(nodeId, context, rawBounds, getBounds) {
    const page = M.pageById(context.project, context.pageId);
    if (!page) return { x: 0, y: 0, w: 0, h: 0 };
    const tree = new M.TreeModel(page);
    if (!tree.node(nodeId)) return { x: 0, y: 0, w: 0, h: 0 };
    return intersectBounds(rawBounds, ancestorClip(tree, nodeId, getBounds));
  }

  function visualSubtreeBounds(nodeId, context) {
    const page = M.pageById(context.project, context.pageId);
    if (!page) return { x: 0, y: 0, w: 0, h: 0 };
    const tree = new M.TreeModel(page);
    const list = [];
    const visit = (id, clip) => {
      const node = tree.node(id);
      if (!node || node.visible === false || !hasArea(clip)) return;
      const raw = rawBoundsForNode(node);
      const visible = intersectBounds(raw, clip);
      if (hasArea(visible)) list.push(visible);
      const childClip = intersectBounds(clip, raw);
      for (const child of tree.childrenOf(id)) visit(child.id, childClip);
    };
    if (tree.node(nodeId)) visit(nodeId, ancestorClip(tree, nodeId));
    return unionBounds(list);
  }

  function subtreeRgba(project, pageId, nodeId, assets) {
    const bounds = visualSubtreeBounds(nodeId, { project, pageId, assets });
    const x0 = Math.max(0, Math.floor(bounds.x));
    const y0 = Math.max(0, Math.floor(bounds.y));
    const x1 = Math.min(400, Math.ceil(bounds.x + bounds.w));
    const y1 = Math.min(300, Math.ceil(bounds.y + bounds.h));
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    const white = renderSubtree(project, pageId, nodeId, assets, 0);
    const black = renderSubtree(project, pageId, nodeId, assets, 1);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const source = (y0 + y) * 400 + x0 + x;
      const a = white[source];
      const b = black[source];
      const offset = (y * w + x) * 4;
      if (a === 0 && b === 1) data[offset + 3] = 0;
      else {
        const value = a ? 0 : 255;
        data[offset] = data[offset + 1] = data[offset + 2] = value;
        data[offset + 3] = 255;
      }
    }
    return { x: x0, y: y0, w, h, data };
  }

  framebuffer.renderPage = renderPage;
  framebuffer.renderSubtree = renderSubtree;
  framebuffer.visualSubtreeBounds = visualSubtreeBounds;
  framebuffer.subtreeRgba = subtreeRgba;

  PE.hierarchyClip = {
    CANVAS_BOUNDS: { ...CANVAS_BOUNDS },
    intersectBounds,
    hasArea,
    containsPixel,
    ancestorClip,
    clippedVisualBounds,
    rawBoundsForNode,
  };

  // Guard against an exception in a nested renderer leaving the global plotter patched.
  R.plotPixel = originalPlotPixel;
}

export {
  CANVAS_BOUNDS,
  intersectBounds,
  hasArea,
  containsPixel,
  installHierarchyClippingRuntime,
};
