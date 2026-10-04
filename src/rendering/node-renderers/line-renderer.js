import { renderStroke, canonicalStrokeBounds } from '../effects/stroke.js';
import { finishNode } from './helpers.js';

const lineRenderer = {
  visualBounds(node, context) { return canonicalStrokeBounds(node, context.renderer.runtime); },
  render(node, context) {
    const bounds = this.visualBounds(node, context);
    const layer = context.createLayer(bounds);
    renderStroke(layer, node, context.renderer.runtime);
    finishNode(context, node, layer, bounds);
  },
};

export { lineRenderer };
