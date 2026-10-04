import { fillValue } from '../effects/fill.js';
import { renderStroke, canonicalStrokeBounds } from '../effects/stroke.js';
import { finishNode } from './helpers.js';

const polygonRenderer = {
  visualBounds(node, context) { return canonicalStrokeBounds(node, context.renderer.runtime); },
  render(node, context) {
    const bounds = this.visualBounds(node, context);
    const layer = context.createLayer(bounds);
    const runtime = context.renderer.runtime;
    const points = node.points || [];
    if (points.length >= 3) {
      const minX = Math.floor(Math.min(...points.map(point => point.x)));
      const maxX = Math.ceil(Math.max(...points.map(point => point.x)));
      const minY = Math.floor(Math.min(...points.map(point => point.y)));
      const maxY = Math.ceil(Math.max(...points.map(point => point.y)));
      for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
        if (!runtime.pointInPolygon(points, x + 0.5, y + 0.5)) continue;
        const value = fillValue(node, runtime, x, y, x - minX, y - minY);
        if (value != null) layer.plot(x, y, value, true);
      }
    }
    renderStroke(layer, node, runtime);
    finishNode(context, node, layer, bounds);
  },
};

export { polygonRenderer };
