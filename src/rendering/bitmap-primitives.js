const WIDTH = 400;
const HEIGHT = 300;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

function plotPixel(framebuffer, x, y, value = 1) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  framebuffer[y * WIDTH + x] = value ? 1 : 0;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - x1, py - y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - x2, py - y2);
  const t = c1 / c2;
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

function plotThickLine(framebuffer, x1, y1, x2, y2, lineWidth = 1, value = 1) {
  const width = Math.max(1, Math.round(lineWidth));
  const radius = width / 2;
  const minX = Math.floor(Math.min(x1, x2) - radius);
  const maxX = Math.ceil(Math.max(x1, x2) + radius);
  const minY = Math.floor(Math.min(y1, y2) - radius);
  const maxY = Math.ceil(Math.max(y1, y2) + radius);
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    if (distanceToSegment(x + 0.5, y + 0.5, x1 + 0.5, y1 + 0.5, x2 + 0.5, y2 + 0.5) <= radius) plotPixel(framebuffer, x, y, value);
  }
}

function pointInPolygon(points, x, y) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index], b = points[previous];
    if (((a.y > y) !== (b.y > y)) && (x < (b.x - a.x) * (y - a.y) / (b.y - a.y || 1e-9) + a.x)) inside = !inside;
  }
  return inside;
}

function ellipseInside(x, y, width, height, inset = 0) {
  const rx = (width - 1) / 2 - inset;
  const ry = (height - 1) / 2 - inset;
  if (rx < 0 || ry < 0) return false;
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const dx = (x - cx) / (rx || 0.5), dy = (y - cy) / (ry || 0.5);
  return dx * dx + dy * dy <= 1;
}

function normalizeRadii(node, width, height) {
  const max = Math.floor(Math.min(width, height) / 2);
  return {
    tl: clamp(Math.round(node.rTL || 0), 0, max),
    tr: clamp(Math.round(node.rTR || 0), 0, max),
    bl: clamp(Math.round(node.rBL || 0), 0, max),
    br: clamp(Math.round(node.rBR || 0), 0, max),
  };
}

function pointInRoundedRectLocal(x, y, width, height, radii) {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const test = (cx, cy, radius) => radius <= 0 || ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2);
  if (x < radii.tl && y < radii.tl) return test(radii.tl - 0.5, radii.tl - 0.5, radii.tl);
  if (x >= width - radii.tr && y < radii.tr) return test(width - radii.tr - 0.5, radii.tr - 0.5, radii.tr);
  if (x < radii.bl && y >= height - radii.bl) return test(radii.bl - 0.5, height - radii.bl - 0.5, radii.bl);
  if (x >= width - radii.br && y >= height - radii.br) return test(width - radii.br - 0.5, height - radii.br - 0.5, radii.br);
  return true;
}

export { WIDTH, HEIGHT, clamp, mod, plotPixel, distanceToSegment, plotThickLine, pointInPolygon, ellipseInside, normalizeRadii, pointInRoundedRectLocal };
