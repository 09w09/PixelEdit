import { normalizeStrokeWidth, normalizeStrokeColor, isStrokeVisible } from '../model/stroke-values.js';

const SHAPE_TYPES = new Set(['line', 'rectangle', 'circle', 'polygon']);
const CLOSED_SHAPE_TYPES = new Set(['rectangle', 'circle', 'polygon']);
const STROKE_STYLES = new Set(['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot']);
const PATTERNS = Object.freeze({
  'short-dash': [4, 2],
  'long-dash': [8, 3],
  dot: [1, 2],
  'dash-dot': [4, 2, 1, 2],
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function normalizeStroke(stroke = {}) {
  const source = stroke && typeof stroke === 'object' ? stroke : {};
  const width = normalizeStrokeWidth(source.width, 1);
  const color = normalizeStrokeColor(source.color);
  const style = STROKE_STYLES.has(source.style) ? source.style : 'solid';
  return { width, color, style };
}

function normalizeFill(fill = {}) {
  const source = fill && typeof fill === 'object' ? fill : {};
  const mode = ['transparent', 'solid', 'dither', 'pattern'].includes(source.mode) ? source.mode : 'transparent';
  const color = Number(source.color) === 0 ? 0 : 1;
  return { mode, color };
}

function strokePattern(style) {
  if (style === 'solid') return null;
  return PATTERNS[style] ? [...PATTERNS[style]] : null;
}

function forEachStyledPathPoint(points, style, emit) {
  const path = points || [];
  const pattern = strokePattern(style);
  if (!pattern) {
    path.forEach((point, index) => emit(point, index));
    return;
  }
  let run = 0;
  let remaining = pattern[0];
  for (let index = 0; index < path.length; index += 1) {
    if ((run & 1) === 0) emit(path[index], index);
    remaining -= 1;
    if (remaining <= 0) {
      run = (run + 1) % pattern.length;
      remaining = pattern[run];
    }
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
  const x0 = Math.round(node.x || 0);
  const y0 = Math.round(node.y || 0);
  const x1 = x0 + Math.max(1, Math.round(node.w || 1)) - 1;
  const y1 = y0 + Math.max(1, Math.round(node.h || 1)) - 1;
  const points = [];
  appendPath(points, thinLinePoints(rasterThinLine, x0, y0, x1, y0));
  appendPath(points, thinLinePoints(rasterThinLine, x1, y0, x1, y1));
  appendPath(points, thinLinePoints(rasterThinLine, x1, y1, x0, y1));
  appendPath(points, thinLinePoints(rasterThinLine, x0, y1, x0, y0));
  if (points.length > 1 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) points.pop();
  return points;
}

function polygonPath(node, rasterThinLine) {
  const source = node.points || [];
  const points = [];
  if (source.length < 2) return points;
  for (let index = 0; index < source.length; index += 1) {
    const a = source[index];
    const b = source[(index + 1) % source.length];
    appendPath(points, thinLinePoints(rasterThinLine, a.x, a.y, b.x, b.y));
  }
  if (points.length > 1 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) points.pop();
  return points;
}

function circlePath(node) {
  const w = Math.max(1, Math.round(node.w || 1));
  const h = Math.max(1, Math.round(node.h || 1));
  const rx = Math.max(0, (w - 1) / 2);
  const ry = Math.max(0, (h - 1) / 2);
  const cx = Math.round(node.x || 0) + rx;
  const cy = Math.round(node.y || 0) + ry;
  const steps = Math.max(24, Math.ceil(Math.PI * 2 * Math.max(rx, ry) * 2));
  const points = [];
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

function pixelKey(x, y) { return `${x},${y}`; }

function exactSolidPixels(node, stroke, R, forEachStrokePixel) {
  const pixels = new Map();
  const add = (x, y) => pixels.set(pixelKey(x, y), { x, y });
  if (node.type === 'line') {
    forEachStrokePixel(node.x1, node.y1, node.x2, node.y2, stroke.width, add);
    return [...pixels.values()];
  }
  if (node.type === 'polygon') {
    const pts = node.points || [];
    for (let index = 0; index < pts.length; index += 1) {
      const a = pts[index];
      const b = pts[(index + 1) % pts.length];
      forEachStrokePixel(a.x, a.y, b.x, b.y, stroke.width, add);
    }
    return [...pixels.values()];
  }
  if (node.type === 'rectangle') {
    const w = Math.max(1, Math.round(node.w || 1));
    const h = Math.max(1, Math.round(node.h || 1));
    const width = clamp(stroke.width, 1, Math.max(1, Math.floor(Math.min(w, h) / 2) || 1));
    const radii = R.normalizeRadii(node, w, h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (!R.pointInRoundedRectLocal(x, y, w, h, radii)) continue;
      const iw = w - 2 * width;
      const ih = h - 2 * width;
      const innerRadii = {
        tl: Math.max(0, radii.tl - width), tr: Math.max(0, radii.tr - width),
        bl: Math.max(0, radii.bl - width), br: Math.max(0, radii.br - width),
      };
      const insideInner = iw > 0 && ih > 0 && x >= width && y >= width && x < w - width && y < h - width && R.pointInRoundedRectLocal(x - width, y - width, iw, ih, innerRadii);
      if (!insideInner) add(Math.round(node.x || 0) + x, Math.round(node.y || 0) + y);
    }
    return [...pixels.values()];
  }
  if (node.type === 'circle') {
    const w = Math.max(1, Math.round(node.w || 1));
    const h = Math.max(1, Math.round(node.h || 1));
    const width = clamp(stroke.width, 1, Math.max(1, Math.floor(Math.min(w, h) / 2) || 1));
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (R.ellipseInside(x, y, w, h, 0) && !R.ellipseInside(x, y, w, h, width)) add(Math.round(node.x || 0) + x, Math.round(node.y || 0) + y);
    }
  }
  return [...pixels.values()];
}

function styledStrokePixels(node, R, pixelRuntime) {
  const stroke = normalizeStroke(node.stroke);
  if (!isStrokeVisible(stroke)) return [];
  if (stroke.style === 'solid') return exactSolidPixels(node, stroke, R, pixelRuntime.forEachStrokePixel);
  const points = pathForNode(node, pixelRuntime.rasterThinLine);
  const pixels = new Map();
  const add = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (node.type === 'rectangle') {
      const lx = x - Math.round(node.x || 0), ly = y - Math.round(node.y || 0);
      if (lx < 0 || ly < 0 || lx >= node.w || ly >= node.h || !R.pointInRoundedRectLocal(lx, ly, node.w, node.h, R.normalizeRadii(node, node.w, node.h))) return;
    }
    if (node.type === 'circle') {
      const lx = x - Math.round(node.x || 0), ly = y - Math.round(node.y || 0);
      if (!R.ellipseInside(lx, ly, node.w, node.h, 0)) return;
    }
    pixels.set(pixelKey(x, y), { x, y });
  };
  const width = stroke.width;
  const offsetStart = -Math.floor((width - 1) / 2);
  const lineDominantHorizontal = node.type === 'line' ? Math.abs(node.x2 - node.x1) >= Math.abs(node.y2 - node.y1) : null;
  forEachStyledPathPoint(points, stroke.style, point => {
    if (node.type === 'line') {
      for (let index = 0; index < width; index += 1) {
        const offset = offsetStart + index;
        add(point.x + (lineDominantHorizontal ? 0 : offset), point.y + (lineDominantHorizontal ? offset : 0));
      }
      return;
    }
    for (let oy = 0; oy < width; oy += 1) for (let ox = 0; ox < width; ox += 1) add(point.x + offsetStart + ox, point.y + offsetStart + oy);
  });
  return [...pixels.values()];
}

function sourceShapeBounds(node) {
  if (node.type === 'rectangle' || node.type === 'circle') {
    return { x: node.x || 0, y: node.y || 0, w: node.w || 0, h: node.h || 0 };
  }
  if (node.type === 'line') {
    const x1 = Number(node.x1) || 0, x2 = Number(node.x2) || 0;
    const y1 = Number(node.y1) || 0, y2 = Number(node.y2) || 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) + 1, h: Math.abs(y2 - y1) + 1 };
  }
  const points = node.points || [];
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxX = Math.max(...points.map(point => point.x));
  const maxY = Math.max(...points.map(point => point.y));
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function strokeBounds(node, R, pixelRuntime) {
  if (node.type === 'rectangle' || node.type === 'circle') return sourceShapeBounds(node);
  const pixels = styledStrokePixels(node, R, pixelRuntime);
  if (!pixels.length) return sourceShapeBounds(node);
  const minX = Math.min(...pixels.map(point => point.x));
  const minY = Math.min(...pixels.map(point => point.y));
  const maxX = Math.max(...pixels.map(point => point.x));
  const maxY = Math.max(...pixels.map(point => point.y));
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function unionBounds(bounds) {
  const valid = bounds.filter(item => item && item.w > 0 && item.h > 0);
  if (!valid.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...valid.map(item => item.x));
  const y = Math.min(...valid.map(item => item.y));
  const right = Math.max(...valid.map(item => item.x + item.w));
  const bottom = Math.max(...valid.map(item => item.y + item.h));
  return { x, y, w: right - x, h: bottom - y };
}

function fillValue(node, R, ax, ay, lx, ly) {
  const fill = normalizeFill(node.fill);
  if (fill.mode === 'transparent') return null;
  if (fill.mode === 'solid') return fill.color;
  if (fill.mode === 'dither') return R.graphicDitherPixel(node.dither, ax, ay, lx, ly);
  if (fill.mode === 'pattern') return R.patternPixel(node.pattern, ax, ay, lx, ly);
  return null;
}

function shapeFillOverlay(node, R) {
  const overlay = {};
  if (!CLOSED_SHAPE_TYPES.has(node.type) || normalizeFill(node.fill).mode === 'transparent') return overlay;
  const put = (keyX, keyY, ax, ay, lx, ly) => {
    const value = fillValue(node, R, ax, ay, lx, ly);
    if (value != null) overlay[pixelKey(keyX, keyY)] = value;
  };

  if (node.type === 'rectangle') {
    const w = Math.max(1, Math.round(node.w || 1));
    const h = Math.max(1, Math.round(node.h || 1));
    const radii = R.normalizeRadii(node, w, h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (R.pointInRoundedRectLocal(x, y, w, h, radii)) put(x, y, Math.round(node.x || 0) + x, Math.round(node.y || 0) + y, x, y);
    }
    return overlay;
  }

  if (node.type === 'circle') {
    const w = Math.max(1, Math.round(node.w || 1));
    const h = Math.max(1, Math.round(node.h || 1));
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (R.ellipseInside(x, y, w, h, 0)) put(x, y, Math.round(node.x || 0) + x, Math.round(node.y || 0) + y, x, y);
    }
    return overlay;
  }

  const points = node.points || [];
  if (points.length < 3) return overlay;
  const minX = Math.floor(Math.min(...points.map(point => point.x)));
  const maxX = Math.ceil(Math.max(...points.map(point => point.x)));
  const minY = Math.floor(Math.min(...points.map(point => point.y)));
  const maxY = Math.ceil(Math.max(...points.map(point => point.y)));
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    if (R.pointInPolygon(points, x + 0.5, y + 0.5)) put(x, y, x, y, x - minX, y - minY);
  }
  return overlay;
}

function addCanonicalShapeOverlay(node, R, pixelRuntime) {
  const stroke = normalizeStroke(node.stroke);
  const existing = structuredClone(node.overlay || {});
  const fillOverlay = shapeFillOverlay(node, R);
  const strokeOverlay = {};
  for (const pixel of styledStrokePixels(node, R, pixelRuntime)) {
    const local = node.type === 'rectangle' || node.type === 'circle';
    const x = local ? pixel.x - Math.round(node.x || 0) : pixel.x;
    const y = local ? pixel.y - Math.round(node.y || 0) : pixel.y;
    strokeOverlay[pixelKey(x, y)] = stroke.color;
  }
  node.overlay = { ...fillOverlay, ...strokeOverlay, ...existing };
  if (CLOSED_SHAPE_TYPES.has(node.type)) node.fill = { ...normalizeFill(node.fill), mode: 'transparent' };
}

function adaptProject(project, R, pixelRuntime) {
  const clone = structuredClone(project);
  for (const page of clone.pages || []) {
    if (page.fill?.mode === 'solid') {
      if (Number(page.fill.color) === 1) {
        page.fill = { mode: 'pattern', color: 1 };
        page.pattern = { type: 'horizontal', lineWidth: 1, gap: 0, align: 'global', offsetX: 0, offsetY: 0 };
      } else page.fill = { mode: 'solid', color: 0 };
    }
    for (const node of page.nodes || []) if (SHAPE_TYPES.has(node.type)) addCanonicalShapeOverlay(node, R, pixelRuntime);
  }
  return clone;
}

function validateStrokeProject(project) {
  for (const page of project.pages || []) for (const node of page.nodes || []) {
    if (!SHAPE_TYPES.has(node.type)) continue;
    if (Object.hasOwn(node, 'lineWidth')) throw new Error('V17 图形不得包含 lineWidth');
    const normalized = normalizeStroke(node.stroke);
    if (!node.stroke || normalized.width !== node.stroke.width || normalized.color !== node.stroke.color || normalized.style !== node.stroke.style) throw new Error('V17 描边数据无效');
  }
  return project;
}

function installStrokeStyleRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const R = PE?.renderer;
  const P = PE?.persistence;
  const pixelRuntime = PE?.pixelStrokeRuntime;
  if (!M?.createNode || !R?.FramebufferRenderer || !P?.ProjectSerializer || !pixelRuntime) throw new Error('PixelEditor stroke dependencies are not initialized');
  if (PE.strokeStyleInstalled) return;
  PE.strokeStyleInstalled = true;

  const originalCreateNode = M.createNode;
  M.createNode = function createV17StrokeNode(type, props = {}) {
    const node = originalCreateNode(type, props);
    if (SHAPE_TYPES.has(type)) {
      node.stroke = normalizeStroke(props.stroke ?? node.stroke);
      delete node.lineWidth;
      delete node.strokeColor;
      delete node.strokeStyle;
    }
    return node;
  };

  const framebuffer = R.FramebufferRenderer;
  const originalRenderPage = framebuffer.renderPage;
  const originalRenderSubtree = framebuffer.renderSubtree;
  const originalVisualBounds = framebuffer.visualBounds;

  function visualBounds(nodeId, context) {
    const page = M.pageById(context.project, context.pageId);
    const node = M.nodeById(page, nodeId);
    if (SHAPE_TYPES.has(node?.type)) return strokeBounds(node, R, pixelRuntime);
    return originalVisualBounds.call(framebuffer, nodeId, context);
  }

  function visualSubtreeBounds(nodeId, context) {
    const page = M.pageById(context.project, context.pageId);
    const tree = new M.TreeModel(page);
    const list = [];
    const visit = id => {
      const node = tree.node(id);
      if (!node || node.visible === false) return;
      list.push(visualBounds(id, context));
      for (const child of tree.childrenOf(id)) visit(child.id);
    };
    visit(nodeId);
    return unionBounds(list);
  }

  framebuffer.renderPage = function renderStrokePage(project, pageId, assets) {
    return originalRenderPage(adaptProject(project, R, pixelRuntime), pageId, assets);
  };
  framebuffer.renderSubtree = function renderStrokeSubtree(project, pageId, nodeId, assets, base = 0) {
    return originalRenderSubtree(adaptProject(project, R, pixelRuntime), pageId, nodeId, assets, base);
  };
  framebuffer.visualBounds = visualBounds;
  framebuffer.visualSubtreeBounds = visualSubtreeBounds;
  framebuffer._bounds = function boundsWithStroke(node) {
    if (SHAPE_TYPES.has(node?.type)) return strokeBounds(node, R, pixelRuntime);
    return node ? { x: node.x || 0, y: node.y || 0, w: node.w || 0, h: node.h || 0 } : { x: 0, y: 0, w: 0, h: 0 };
  };
  framebuffer.subtreeRgba = function subtreeRgbaWithStroke(project, pageId, nodeId, assets) {
    const bounds = visualSubtreeBounds(nodeId, { project, pageId, assets });
    const x0 = Math.max(0, Math.floor(bounds.x));
    const y0 = Math.max(0, Math.floor(bounds.y));
    const x1 = Math.min(400, Math.ceil(bounds.x + bounds.w));
    const y1 = Math.min(300, Math.ceil(bounds.y + bounds.h));
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    const white = framebuffer.renderSubtree(project, pageId, nodeId, assets, 0);
    const black = framebuffer.renderSubtree(project, pageId, nodeId, assets, 1);
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
  };

  const originalSerialize = P.ProjectSerializer.serialize.bind(P.ProjectSerializer);
  const originalDeserialize = P.ProjectSerializer.deserialize.bind(P.ProjectSerializer);
  P.ProjectSerializer.serialize = function serializeStrokeProject(project, assets) {
    validateStrokeProject(project);
    return originalSerialize(project, assets);
  };
  P.ProjectSerializer.deserialize = function deserializeStrokeProject(raw) {
    const result = originalDeserialize(raw);
    validateStrokeProject(result.project);
    return result;
  };

  PE.strokeStyle = {
    normalizeStroke,
    normalizeFill,
    strokePattern,
    forEachStyledPathPoint,
    styledStrokePixels,
    shapeFillOverlay,
    validateStrokeProject,
  };
}

export { normalizeStroke, strokePattern, forEachStyledPathPoint, styledStrokePixels, installStrokeStyleRuntime };
