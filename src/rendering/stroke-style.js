import { normalizeStrokeWidth, normalizeStrokeColor, isStrokeVisible } from '../model/stroke-values.js';

const SHAPE_TYPES = new Set(['line', 'rectangle', 'circle', 'polygon']);
const STROKE_STYLES = new Set(['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot']);
const PATTERNS = Object.freeze({ 'short-dash': [4, 2], 'long-dash': [8, 3], dot: [1, 2], 'dash-dot': [4, 2, 1, 2] });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function normalizeStroke(stroke = {}) {
  const source = stroke && typeof stroke === 'object' ? stroke : {};
  return {
    width: normalizeStrokeWidth(source.width, 1),
    color: normalizeStrokeColor(source.color),
    style: STROKE_STYLES.has(source.style) ? source.style : 'solid',
  };
}

function strokePattern(style) { return style === 'solid' ? null : (PATTERNS[style] ? [...PATTERNS[style]] : null); }

function forEachStyledPathPoint(points, style, emit) {
  const pattern = strokePattern(style);
  if (!pattern) { (points || []).forEach((point, index) => emit(point, index)); return; }
  let run = 0, remaining = pattern[0];
  for (let index = 0; index < points.length; index += 1) {
    if ((run & 1) === 0) emit(points[index], index);
    remaining -= 1;
    if (remaining <= 0) { run = (run + 1) % pattern.length; remaining = pattern[run]; }
  }
}

function thinLinePoints(rasterThinLine, x1, y1, x2, y2) {
  const points = [];
  rasterThinLine(x1, y1, x2, y2, (x, y) => points.push({ x, y }));
  return points;
}

function appendPath(target, points) {
  for (const point of points) {
    const last = target.at(-1);
    if (!last || last.x !== point.x || last.y !== point.y) target.push(point);
  }
}

function rectanglePath(node, rasterThinLine) {
  const x0 = Math.round(node.x || 0), y0 = Math.round(node.y || 0);
  const x1 = x0 + Math.max(1, Math.round(node.w || 1)) - 1, y1 = y0 + Math.max(1, Math.round(node.h || 1)) - 1;
  const points = [];
  appendPath(points, thinLinePoints(rasterThinLine, x0, y0, x1, y0));
  appendPath(points, thinLinePoints(rasterThinLine, x1, y0, x1, y1));
  appendPath(points, thinLinePoints(rasterThinLine, x1, y1, x0, y1));
  appendPath(points, thinLinePoints(rasterThinLine, x0, y1, x0, y0));
  if (points.length > 1 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) points.pop();
  return points;
}

function polygonPath(node, rasterThinLine) {
  const source = node.points || [], points = [];
  if (source.length < 2) return points;
  for (let index = 0; index < source.length; index += 1) {
    const a = source[index], b = source[(index + 1) % source.length];
    appendPath(points, thinLinePoints(rasterThinLine, a.x, a.y, b.x, b.y));
  }
  if (points.length > 1 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) points.pop();
  return points;
}

function circlePath(node) {
  const w = Math.max(1, Math.round(node.w || 1)), h = Math.max(1, Math.round(node.h || 1));
  const rx = Math.max(0, (w - 1) / 2), ry = Math.max(0, (h - 1) / 2);
  const cx = Math.round(node.x || 0) + rx, cy = Math.round(node.y || 0) + ry;
  const steps = Math.max(24, Math.ceil(Math.PI * 2 * Math.max(rx, ry) * 2)), points = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = -Math.PI / 2 + index / steps * Math.PI * 2;
    const point = { x: Math.round(cx + Math.cos(angle) * rx), y: Math.round(cy + Math.sin(angle) * ry) };
    const last = points.at(-1);
    if (!last || last.x !== point.x || last.y !== point.y) points.push(point);
  }
  if (points.length > 1 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) points.pop();
  return points;
}

function pathForNode(node, rasterThinLine) {
  if (node.type === 'line') return thinLinePoints(rasterThinLine, node.x1, node.y1, node.x2, node.y2);
  if (node.type === 'rectangle') return rectanglePath(node, rasterThinLine);
  if (node.type === 'circle') return circlePath(node);
  if (node.type === 'polygon') return polygonPath(node, rasterThinLine);
  return [];
}

const pixelKey = (x, y) => `${x},${y}`;

function exactSolidPixels(node, stroke, runtime, forEachStrokePixel) {
  const pixels = new Map(), add = (x, y) => pixels.set(pixelKey(x, y), { x, y });
  if (node.type === 'line') {
    forEachStrokePixel(node.x1, node.y1, node.x2, node.y2, stroke.width, add);
    return [...pixels.values()];
  }
  if (node.type === 'polygon') {
    const points = node.points || [];
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index], b = points[(index + 1) % points.length];
      forEachStrokePixel(a.x, a.y, b.x, b.y, stroke.width, add);
    }
    return [...pixels.values()];
  }
  if (node.type === 'rectangle') {
    const w = Math.max(1, Math.round(node.w || 1)), h = Math.max(1, Math.round(node.h || 1));
    const width = clamp(stroke.width, 1, Math.max(1, Math.floor(Math.min(w, h) / 2) || 1));
    const radii = runtime.normalizeRadii(node, w, h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (!runtime.pointInRoundedRectLocal(x, y, w, h, radii)) continue;
      const iw = w - 2 * width, ih = h - 2 * width;
      const inner = { tl: Math.max(0, radii.tl - width), tr: Math.max(0, radii.tr - width), bl: Math.max(0, radii.bl - width), br: Math.max(0, radii.br - width) };
      const inside = iw > 0 && ih > 0 && x >= width && y >= width && x < w - width && y < h - width && runtime.pointInRoundedRectLocal(x - width, y - width, iw, ih, inner);
      if (!inside) add(Math.round(node.x || 0) + x, Math.round(node.y || 0) + y);
    }
    return [...pixels.values()];
  }
  if (node.type === 'circle') {
    const w = Math.max(1, Math.round(node.w || 1)), h = Math.max(1, Math.round(node.h || 1));
    const width = clamp(stroke.width, 1, Math.max(1, Math.floor(Math.min(w, h) / 2) || 1));
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (runtime.ellipseInside(x, y, w, h, 0) && !runtime.ellipseInside(x, y, w, h, width)) add(Math.round(node.x || 0) + x, Math.round(node.y || 0) + y);
    }
  }
  return [...pixels.values()];
}

function styledStrokePixels(node, runtime, pixelRuntime) {
  const stroke = normalizeStroke(node.stroke);
  if (!isStrokeVisible(stroke)) return [];
  if (stroke.style === 'solid') return exactSolidPixels(node, stroke, runtime, pixelRuntime.forEachStrokePixel);
  const points = pathForNode(node, pixelRuntime.rasterThinLine), pixels = new Map();
  const add = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (node.type === 'rectangle') {
      const lx = x - Math.round(node.x || 0), ly = y - Math.round(node.y || 0);
      if (lx < 0 || ly < 0 || lx >= node.w || ly >= node.h || !runtime.pointInRoundedRectLocal(lx, ly, node.w, node.h, runtime.normalizeRadii(node, node.w, node.h))) return;
    }
    if (node.type === 'circle') {
      const lx = x - Math.round(node.x || 0), ly = y - Math.round(node.y || 0);
      if (!runtime.ellipseInside(lx, ly, node.w, node.h, 0)) return;
    }
    pixels.set(pixelKey(x, y), { x, y });
  };
  const width = stroke.width, offsetStart = -Math.floor((width - 1) / 2);
  const horizontal = node.type === 'line' ? Math.abs(node.x2 - node.x1) >= Math.abs(node.y2 - node.y1) : null;
  forEachStyledPathPoint(points, stroke.style, point => {
    if (node.type === 'line') {
      for (let index = 0; index < width; index += 1) {
        const offset = offsetStart + index;
        add(point.x + (horizontal ? 0 : offset), point.y + (horizontal ? offset : 0));
      }
    } else for (let oy = 0; oy < width; oy += 1) for (let ox = 0; ox < width; ox += 1) add(point.x + offsetStart + ox, point.y + offsetStart + oy);
  });
  return [...pixels.values()];
}

function sourceShapeBounds(node) {
  if (node.type === 'rectangle' || node.type === 'circle') return { x: node.x || 0, y: node.y || 0, w: node.w || 0, h: node.h || 0 };
  if (node.type === 'line') {
    const x1 = Number(node.x1) || 0, x2 = Number(node.x2) || 0, y1 = Number(node.y1) || 0, y2 = Number(node.y2) || 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) + 1, h: Math.abs(y2 - y1) + 1 };
  }
  const points = node.points || [];
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...points.map(point => point.x)), minY = Math.min(...points.map(point => point.y));
  const maxX = Math.max(...points.map(point => point.x)), maxY = Math.max(...points.map(point => point.y));
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function strokeBounds(node, runtime, pixelRuntime) {
  if (node.type === 'rectangle' || node.type === 'circle') return sourceShapeBounds(node);
  const pixels = styledStrokePixels(node, runtime, pixelRuntime);
  if (!pixels.length) return sourceShapeBounds(node);
  const minX = Math.min(...pixels.map(point => point.x)), minY = Math.min(...pixels.map(point => point.y));
  const maxX = Math.max(...pixels.map(point => point.x)), maxY = Math.max(...pixels.map(point => point.y));
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function validateStrokeProject(project) {
  for (const page of project?.pages || []) for (const node of page.nodes || []) {
    if (!SHAPE_TYPES.has(node.type)) continue;
    if (Object.hasOwn(node, 'lineWidth')) throw new Error('V17 图形不得包含 lineWidth');
    const expected = normalizeStroke(node.stroke);
    if (!node.stroke || expected.width !== node.stroke.width || expected.color !== node.stroke.color || expected.style !== node.stroke.style) throw new Error('V17 描边数据无效');
  }
  return project;
}

const strokeStyle = { normalizeStroke, strokePattern, forEachStyledPathPoint, styledStrokePixels, strokeBounds, validateStrokeProject };
if (globalThis.PixelEditor) globalThis.PixelEditor.strokeStyle = strokeStyle;

export { normalizeStroke, strokePattern, forEachStyledPathPoint, styledStrokePixels, strokeBounds, validateStrokeProject, strokeStyle };
