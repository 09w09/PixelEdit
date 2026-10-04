import { RASTER_TRANSPARENT, RASTER_BLACK, pixelsFromRasterNode } from '../../raster/tristate-raster.js';
import { finishNode } from './helpers.js';

const rasterRenderer = {
  visualBounds(node) { return { x: node.x || 0, y: node.y || 0, w: node.w || 0, h: node.h || 0 }; },
  render(node, context) {
    const bounds = this.visualBounds(node);
    const layer = context.createLayer(bounds);
    const pixels = pixelsFromRasterNode(node);
    for (let y = 0; y < node.h; y += 1) for (let x = 0; x < node.w; x += 1) {
      const state = pixels[y * node.w + x];
      if (state === RASTER_TRANSPARENT) continue;
      layer.plot(node.x + x, node.y + y, state === RASTER_BLACK ? 1 : 0, true);
    }
    finishNode(context, node, layer, bounds);
  },
};

export { rasterRenderer };
