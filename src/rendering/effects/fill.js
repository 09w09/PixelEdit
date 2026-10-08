import { normalizeFill } from '../../model/schema.js';

function fillValue(node, runtime, worldX, worldY, localX, localY, { background = false } = {}) {
  const fill = normalizeFill(node?.fill, { background });
  if (fill.mode === 'transparent') return null;
  if (fill.mode === 'solid') return fill.color;
  if (fill.mode === 'dither') return runtime.graphicDitherPixel(node.dither, worldX, worldY, localX, localY);
  if (fill.mode === 'pattern') return runtime.patternPixel(node.pattern, worldX, worldY, localX, localY);
  return null;
}

export { fillValue };
