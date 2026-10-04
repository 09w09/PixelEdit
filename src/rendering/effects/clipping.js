const CANVAS_BOUNDS = Object.freeze({ x: 0, y: 0, w: 400, h: 300 });

function finiteBounds(bounds) {
  if (!bounds) return null;
  const x = Number(bounds.x), y = Number(bounds.y), w = Number(bounds.w), h = Number(bounds.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

function hasArea(bounds) { return Boolean(bounds && bounds.w > 0 && bounds.h > 0); }

function intersectBounds(a, b) {
  const left = finiteBounds(a), right = finiteBounds(b);
  if (!left || !right) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.max(left.x, right.x), y = Math.max(left.y, right.y);
  const endX = Math.min(left.x + left.w, right.x + right.w);
  const endY = Math.min(left.y + left.h, right.y + right.h);
  return { x, y, w: Math.max(0, endX - x), h: Math.max(0, endY - y) };
}

function containsPixel(bounds, x, y) {
  return hasArea(bounds) && x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.w && y < bounds.y + bounds.h;
}

function unionBounds(items) {
  const list = (items || []).map(finiteBounds).filter(hasArea);
  if (!list.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...list.map(item => item.x)), y = Math.min(...list.map(item => item.y));
  const right = Math.max(...list.map(item => item.x + item.w)), bottom = Math.max(...list.map(item => item.y + item.h));
  return { x, y, w: right - x, h: bottom - y };
}

export { CANVAS_BOUNDS, finiteBounds, hasArea, intersectBounds, containsPixel, unionBounds };
