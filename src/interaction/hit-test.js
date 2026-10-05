import { pageById, TreeModel } from '../model/index.js';
import { FramebufferRenderer } from '../rendering/renderer.js';

function rectIntersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function contains(bounds, x, y) {
  return x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.w && y < bounds.y + bounds.h;
}

class HitTest {
  constructor(project, pageId, assets) {
    this.project = project;
    this.pageId = pageId;
    this.assets = assets;
    this.page = pageById(project, pageId);
    this.tree = new TreeModel(this.page);
  }

  bounds(id) {
    const context = { project: this.project, pageId: this.pageId, assets: this.assets };
    return FramebufferRenderer.visibleBounds
      ? FramebufferRenderer.visibleBounds(id, context)
      : FramebufferRenderer.visualBounds(id, context);
  }

  candidates({ ignoreLocked = false } = {}) {
    return this.tree.visualOrder().filter(node => node.visible !== false
      && this.tree.isEffectivelyVisible(node.id)
      && (!ignoreLocked || !this.tree.isEffectivelyLocked(node.id)));
  }

  topmostAt(x, y, options = {}) {
    const candidates = this.candidates(options);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const node = candidates[index];
      if (contains(this.bounds(node.id), x, y)) return node;
    }
    return null;
  }

  intersecting(rect, options = {}) {
    return this.candidates(options).filter(node => rectIntersects(this.bounds(node.id), rect));
  }
}

export { HitTest, rectIntersects };
