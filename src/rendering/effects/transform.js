import { Framebuffer, integerLayerBounds } from '../framebuffer.js';
import { isIdentityTransform, nodeTransformMatrix, inverseTransformPoint, transformedBounds } from '../../transforms/transform-model.js';

function transformFramebuffer(layer, node, sourceBounds) {
  if (isIdentityTransform(node?.transform)) return layer;
  const worldBounds = transformedBounds(node, { baseBounds: () => sourceBounds });
  const targetBounds = integerLayerBounds(worldBounds);
  const output = new Framebuffer(targetBounds.w, targetBounds.h, { originX: targetBounds.x, originY: targetBounds.y });
  const matrix = nodeTransformMatrix(node, sourceBounds);

  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const world = { x: output.originX + x + 0.5, y: output.originY + y + 0.5 };
      const source = inverseTransformPoint(matrix, world);
      const sx = Math.floor(source.x - layer.originX);
      const sy = Math.floor(source.y - layer.originY);
      if (sx < 0 || sy < 0 || sx >= layer.width || sy >= layer.height) continue;
      const index = sy * layer.width + sx;
      if (!layer.alpha[index]) continue;
      output.plot(output.originX + x, output.originY + y, layer.bits[index], true);
    }
  }
  return output;
}

export { transformFramebuffer };
