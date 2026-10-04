import { Framebuffer, integerLayerBounds } from './framebuffer.js';
import { CANVAS_BOUNDS, intersectBounds, hasArea } from './effects/clipping.js';
import { transformFramebuffer } from './effects/transform.js';
import { nodeTransformMatrix } from '../transforms/transform-model.js';

class RenderContext {
  constructor({ renderer, project, page, tree, assets, framebuffer }) {
    this.renderer = renderer;
    this.project = project;
    this.page = page;
    this.tree = tree;
    this.assets = assets;
    this.framebuffer = framebuffer;
    this.clipStack = [{ ...CANVAS_BOUNDS }];
    this.transformStack = [];
  }

  get currentClip() { return this.clipStack.at(-1); }

  pushClip(bounds) {
    const next = intersectBounds(this.currentClip, bounds);
    this.clipStack.push(next);
    return next;
  }

  popClip() { if (this.clipStack.length > 1) this.clipStack.pop(); }

  withClip(bounds, callback) {
    const clip = this.pushClip(bounds);
    try { if (hasArea(clip)) return callback(clip); return undefined; }
    finally { this.popClip(); }
  }

  createLayer(bounds) {
    const box = integerLayerBounds(bounds);
    return new Framebuffer(box.w, box.h, { originX: box.x, originY: box.y });
  }

  compositeNodeLayer(node, layer, sourceBounds) {
    const matrix = nodeTransformMatrix(node, sourceBounds);
    this.transformStack.push(matrix);
    try {
      const output = transformFramebuffer(layer, node, sourceBounds);
      this.framebuffer.composite(output, this.currentClip);
      return output;
    } finally {
      this.transformStack.pop();
    }
  }
}

export { RenderContext };
