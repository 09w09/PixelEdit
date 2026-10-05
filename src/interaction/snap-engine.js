import { pageById, TreeModel } from '../model/index.js';
import { FramebufferRenderer } from '../rendering/renderer.js';

function alignmentValues(bounds) {
  return {
    x: [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w],
    y: [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h],
  };
}

class SnapEngine {
  constructor(project, pageId, assets) {
    this.project = project;
    this.pageId = pageId;
    this.assets = assets;
    this.page = pageById(project, pageId);
    this.tree = new TreeModel(this.page);
    this._cache = null;
  }

  bounds(id) {
    return FramebufferRenderer.visualBounds(id, { project: this.project, pageId: this.pageId, assets: this.assets });
  }

  _prepare(roots) {
    const key = [...roots].sort().join('|');
    if (this._cache?.key === key) return this._cache;
    const selected = new Set();
    const visit = id => {
      if (selected.has(id)) return;
      selected.add(id);
      for (const child of this.tree.childrenOf(id)) visit(child.id);
    };
    for (const id of roots) visit(id);
    const targetsX = [0, 200, 400], targetsY = [0, 150, 300];
    const labelsX = new Map([[0, 'canvas'], [200, 'canvas'], [400, 'canvas']]);
    const labelsY = new Map([[0, 'canvas'], [150, 'canvas'], [300, 'canvas']]);
    for (const node of this.page.nodes) {
      if (selected.has(node.id) || !this.tree.isEffectivelyVisible(node.id) || this.tree.isEffectivelyLocked(node.id)) continue;
      const values = alignmentValues(this.bounds(node.id));
      for (const x of values.x) { targetsX.push(x); labelsX.set(x, 'object'); }
      for (const y of values.y) { targetsY.push(y); labelsY.set(y, 'object'); }
    }
    this._cache = { key, targetsX, targetsY, labelsX, labelsY, baseBounds: roots.map(id => this.bounds(id)) };
    return this._cache;
  }

  snapMove({ roots, dx, dy, zoom = 1, thresholdPx = 5 }) {
    const cache = this._prepare(roots);
    const movedBounds = cache.baseBounds.map(bounds => ({ x: bounds.x + Number(dx), y: bounds.y + Number(dy), w: bounds.w, h: bounds.h }));
    const union = movedBounds.length ? {
      x: Math.min(...movedBounds.map(bounds => bounds.x)),
      y: Math.min(...movedBounds.map(bounds => bounds.y)),
      w: Math.max(...movedBounds.map(bounds => bounds.x + bounds.w)) - Math.min(...movedBounds.map(bounds => bounds.x)),
      h: Math.max(...movedBounds.map(bounds => bounds.y + bounds.h)) - Math.min(...movedBounds.map(bounds => bounds.y)),
    } : { x: 0, y: 0, w: 0, h: 0 };
    const moving = alignmentValues(union);
    const threshold = Math.max(0, thresholdPx / Math.max(0.0001, zoom));
    let bestX = null, bestY = null;
    for (const source of moving.x) for (const target of cache.targetsX) {
      const delta = target - source;
      if (Math.abs(delta) <= threshold + 1e-9 && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { delta, target, kind: cache.labelsX.get(target) || 'object' };
    }
    for (const source of moving.y) for (const target of cache.targetsY) {
      const delta = target - source;
      if (Math.abs(delta) <= threshold + 1e-9 && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { delta, target, kind: cache.labelsY.get(target) || 'object' };
    }
    return {
      dx: Math.round(Number(dx) + (bestX?.delta || 0)),
      dy: Math.round(Number(dy) + (bestY?.delta || 0)),
      smartGuides: [
        ...(bestX ? [{ axis: 'x', coord: Math.round(bestX.target), source: bestX.kind }] : []),
        ...(bestY ? [{ axis: 'y', coord: Math.round(bestY.target), source: bestY.kind }] : []),
      ],
    };
  }
}

export { SnapEngine, alignmentValues };
