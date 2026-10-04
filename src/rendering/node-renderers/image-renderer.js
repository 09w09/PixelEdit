import { finishNode } from './helpers.js';

const imageRenderer = {
  visualBounds(node) { return { x: node.x || 0, y: node.y || 0, w: node.w || 0, h: node.h || 0 }; },
  render(node, context) {
    const bounds = this.visualBounds(node);
    const layer = context.createLayer(bounds);
    const result = context.renderer.binaryImage.binaryImageForNode(node, context.assets);
    if (result) for (let y = 0; y < result.height; y += 1) for (let x = 0; x < result.width; x += 1) {
      const index = y * result.width + x;
      if (!result.alpha[index]) continue;
      layer.plot(node.x + x, node.y + y, result.bits[index], true);
    }
    finishNode(context, node, layer, bounds);
  },
};

export { imageRenderer };
