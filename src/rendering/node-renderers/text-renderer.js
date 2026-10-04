import { fillValue } from '../effects/fill.js';
import { finishNode } from './helpers.js';

const textRenderer = {
  visualBounds(node) { return { x: node.x || 0, y: node.y || 0, w: node.w || 0, h: node.h || 0 }; },
  render(node, context) {
    const bounds = this.visualBounds(node);
    const layer = context.createLayer(bounds);
    const runtime = context.renderer.runtime;
    const mask = runtime.TextRenderer.mask(node);
    if (node.invert) {
      for (let y = 0; y < node.h; y += 1) for (let x = 0; x < node.w; x += 1) layer.plot(node.x + x, node.y + y, 1, true);
    }
    for (let y = 0; y < mask.h; y += 1) for (let x = 0; x < mask.w; x += 1) {
      if (!mask.mask[y * mask.w + x]) continue;
      if (node.invert) layer.plot(node.x + x, node.y + y, 0, true);
      else {
        const value = fillValue(node, runtime, node.x + x, node.y + y, x, y);
        if (value != null) layer.plot(node.x + x, node.y + y, value, true);
      }
    }
    finishNode(context, node, layer, bounds);
  },
};

export { textRenderer };
