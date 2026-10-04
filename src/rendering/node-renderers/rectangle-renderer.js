import { fillValue } from '../effects/fill.js';
import { renderStroke } from '../effects/stroke.js';
import { finishNode } from './helpers.js';

const rectangleRenderer = {
  visualBounds(node) { return { x: node.x || 0, y: node.y || 0, w: node.w || 0, h: node.h || 0 }; },
  render(node, context) {
    const bounds = this.visualBounds(node);
    const layer = context.createLayer(bounds);
    const runtime = context.renderer.runtime;
    const w = Math.max(1, Math.round(node.w || 1)), h = Math.max(1, Math.round(node.h || 1));
    const radii = runtime.normalizeRadii(node, w, h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (!runtime.pointInRoundedRectLocal(x, y, w, h, radii)) continue;
      const value = fillValue(node, runtime, (node.x || 0) + x, (node.y || 0) + y, x, y);
      if (value != null) layer.plot((node.x || 0) + x, (node.y || 0) + y, value, true);
    }
    renderStroke(layer, node, runtime);
    finishNode(context, node, layer, bounds);
  },
};

export { rectangleRenderer };
