import { normalizeStroke } from '../../model/schema.js';
import { styledStrokePixels, strokeBounds } from '../stroke-style.js';
import { rasterThinLine, forEachStrokePixel } from '../pixel-stroke.js';
import { Framebuffer } from '../framebuffer.js';
import { isIdentityTransform, nodeTransformMatrix, transformPoint } from '../../transforms/transform-model.js';

const pixelRuntime = Object.freeze({ rasterThinLine, forEachStrokePixel });

function renderStroke(layer, node, runtime) {
  const stroke = normalizeStroke(node.stroke);
  for (const pixel of styledStrokePixels(node, runtime, pixelRuntime)) layer.plot(pixel.x, pixel.y, stroke.color, true);
}

function canonicalStrokeBounds(node, runtime) {
  return strokeBounds(node, runtime, pixelRuntime);
}

function usesVectorTransformedRectangleStroke(node, runtime) {
  if (node?.type !== 'rectangle' || isIdentityTransform(node.transform)) return false;
  const stroke = normalizeStroke(node.stroke);
  if (stroke.width !== 1 || stroke.style !== 'solid' || stroke.color === 'transparent') return false;
  const radii = runtime.normalizeRadii?.(node, node.w, node.h) || {};
  return !Object.values(radii).some(value => Number(value) !== 0);
}

function transformedRectangleStrokePixels(node, sourceBounds, runtime) {
  if (!usesVectorTransformedRectangleStroke(node, runtime)) return [];
  const matrix = nodeTransformMatrix(node, sourceBounds);
  const x0 = Math.round(Number(node.x) || 0);
  const y0 = Math.round(Number(node.y) || 0);
  const x1 = x0 + Math.max(1, Math.round(Number(node.w) || 1)) - 1;
  const y1 = y0 + Math.max(1, Math.round(Number(node.h) || 1)) - 1;
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ].map(point => transformPoint(matrix, point));
  const pixels = new Map();
  const put = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    pixels.set(`${x},${y}`, { x, y });
  };
  for (let index = 0; index < corners.length; index += 1) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    rasterThinLine(a.x, a.y, b.x, b.y, put);
  }
  return [...pixels.values()];
}

function expandLayerToPixels(layer, pixels) {
  if (!pixels.length) return layer;
  const minX = Math.min(layer.originX, ...pixels.map(point => point.x));
  const minY = Math.min(layer.originY, ...pixels.map(point => point.y));
  const maxX = Math.max(layer.originX + layer.width - 1, ...pixels.map(point => point.x));
  const maxY = Math.max(layer.originY + layer.height - 1, ...pixels.map(point => point.y));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (minX === layer.originX && minY === layer.originY && width === layer.width && height === layer.height) return layer;
  const expanded = new Framebuffer(width, height, { originX: minX, originY: minY });
  expanded.composite(layer);
  return expanded;
}

function renderTransformedRectangleStroke(layer, node, sourceBounds, runtime) {
  if (!usesVectorTransformedRectangleStroke(node, runtime)) return layer;
  const stroke = normalizeStroke(node.stroke);
  const pixels = transformedRectangleStrokePixels(node, sourceBounds, runtime);
  const output = expandLayerToPixels(layer, pixels);
  for (const pixel of pixels) output.plot(pixel.x, pixel.y, stroke.color, true);
  return output;
}

export {
  renderStroke,
  canonicalStrokeBounds,
  pixelRuntime,
  usesVectorTransformedRectangleStroke,
  transformedRectangleStrokePixels,
  renderTransformedRectangleStroke,
};
