import { normalizeStroke } from '../../model/schema.js';
import { styledStrokePixels, strokeBounds } from '../stroke-style.js';
import { rasterThinLine, forEachStrokePixel } from '../pixel-stroke.js';

const pixelRuntime = Object.freeze({ rasterThinLine, forEachStrokePixel });

function renderStroke(layer, node, runtime) {
  const stroke = normalizeStroke(node.stroke);
  for (const pixel of styledStrokePixels(node, runtime, pixelRuntime)) layer.plot(pixel.x, pixel.y, stroke.color, true);
}

function canonicalStrokeBounds(node, runtime) {
  return strokeBounds(node, runtime, pixelRuntime);
}

export { renderStroke, canonicalStrokeBounds, pixelRuntime };
