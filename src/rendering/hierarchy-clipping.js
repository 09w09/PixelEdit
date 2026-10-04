import { CANVAS_BOUNDS, finiteBounds, hasArea, intersectBounds, containsPixel, unionBounds } from './effects/clipping.js';

function ancestorClip(tree, nodeId, getBounds) {
  let clip = { ...CANVAS_BOUNDS }, node = tree.node(nodeId);
  const visited = new Set();
  while (node?.parentId && node.parentId !== tree.page.id && !visited.has(node.parentId)) {
    visited.add(node.parentId);
    const parent = tree.node(node.parentId);
    if (!parent) break;
    clip = intersectBounds(clip, getBounds(parent.id));
    if (!hasArea(clip)) break;
    node = parent;
  }
  return clip;
}

const hierarchyClip = { CANVAS_BOUNDS: { ...CANVAS_BOUNDS }, finiteBounds, hasArea, intersectBounds, containsPixel, unionBounds, ancestorClip };
if (globalThis.PixelEditor) globalThis.PixelEditor.hierarchyClip = hierarchyClip;

export { CANVAS_BOUNDS, finiteBounds, hasArea, intersectBounds, containsPixel, unionBounds, ancestorClip, hierarchyClip };
