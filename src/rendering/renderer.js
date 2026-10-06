import { TreeModel, pageById, nodeById } from '../model/index.js';
import { Framebuffer } from './framebuffer.js';
import { RenderContext } from './render-context.js';
import { CANVAS_BOUNDS, intersectBounds, hasArea, unionBounds } from './effects/clipping.js';
import { fillValue } from './effects/fill.js';
import { transformedBounds } from '../transforms/transform-model.js';
import { createBinaryImagePipeline } from './binary-image.js';
import * as primitives from './bitmap-primitives.js';
import { graphicDitherPixel, patternPixel } from './pattern-renderer.js';
import { TextRenderer } from './base-text-renderer.js';
import { ImageRenderer } from './base-image-renderer.js';
import { rectangleRenderer } from './node-renderers/rectangle-renderer.js';
import { circleRenderer } from './node-renderers/circle-renderer.js';
import { lineRenderer } from './node-renderers/line-renderer.js';
import { polygonRenderer } from './node-renderers/polygon-renderer.js';
import { textRenderer } from './node-renderers/text-renderer.js';
import { imageRenderer } from './node-renderers/image-renderer.js';
import { rasterRenderer } from './node-renderers/raster-renderer.js';

const renderRuntime = Object.freeze({ ...primitives, graphicDitherPixel, patternPixel, TextRenderer, ImageRenderer });

class Renderer {
  constructor({ runtime = renderRuntime } = {}) {
    this.runtime = runtime;
    this.nodeRenderers = Object.freeze({ rectangle: rectangleRenderer, circle: circleRenderer, line: lineRenderer, polygon: polygonRenderer, text: textRenderer, image: imageRenderer, raster: rasterRenderer });
    this.nodeTypes = new Set(Object.keys(this.nodeRenderers));
    this.binaryImage = createBinaryImagePipeline(this.runtime);
    this.facade = Object.freeze({
      renderPage: this.renderPage.bind(this),
      renderSubtree: this.renderSubtree.bind(this),
      subtreeRgba: this.subtreeRgba.bind(this),
      visualBounds: this.visualBounds.bind(this),
      visibleBounds: this.visibleBounds.bind(this),
      visualSubtreeBounds: this.visualSubtreeBounds.bind(this),
      _bounds: node => this.sourceBounds(node, null),
    });
  }

  page(project, pageId) { return pageById(project, pageId); }

  context(project, pageId, assets, framebuffer) {
    const page = this.page(project, pageId);
    if (!page) throw new Error('page not found');
    return new RenderContext({ renderer: this, project, page, tree: new TreeModel(page), assets, framebuffer });
  }

  sourceBounds(node, context) {
    if (!node) return { x: 0, y: 0, w: 0, h: 0 };
    const nodeRenderer = this.nodeRenderers[node.type];
    if (!nodeRenderer) return { x: node.x || 0, y: node.y || 0, w: node.w || 0, h: node.h || 0 };
    return nodeRenderer.visualBounds(node, context || { renderer: this });
  }

  visualBounds(nodeId, context) {
    const page = this.page(context.project, context.pageId);
    const node = nodeById(page, nodeId);
    if (!node) return { x: 0, y: 0, w: 0, h: 0 };
    const source = this.sourceBounds(node, { renderer: this, project: context.project, page, pageId: context.pageId, assets: context.assets });
    return transformedBounds(node, { baseBounds: () => source });
  }

  ancestorClip(nodeId, context) {
    const page = this.page(context.project, context.pageId);
    const tree = new TreeModel(page);
    let clip = { ...CANVAS_BOUNDS }, node = tree.node(nodeId);
    const visited = new Set();
    while (node?.parentId && node.parentId !== page.id && !visited.has(node.parentId)) {
      visited.add(node.parentId);
      const parent = tree.node(node.parentId);
      if (!parent) break;
      clip = intersectBounds(clip, this.visualBounds(parent.id, context));
      if (!hasArea(clip)) break;
      node = parent;
    }
    return clip;
  }

  visibleBounds(nodeId, context) { return intersectBounds(this.visualBounds(nodeId, context), this.ancestorClip(nodeId, context)); }

  drawPageBackground(context) {
    const page = context.page;
    for (let y = 0; y < 300; y += 1) for (let x = 0; x < 400; x += 1) {
      const value = fillValue(page, this.runtime, x, y, x, y, { background: true });
      context.framebuffer.plot(x, y, value == null ? 0 : value, true);
    }
    for (const [key, value] of Object.entries(page.overlay || {})) {
      const [x, y] = key.split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) context.framebuffer.plot(x, y, value, true);
    }
  }

  renderNode(context, nodeId) {
    const node = context.tree.node(nodeId);
    if (!node || node.visible === false || !hasArea(context.currentClip)) return;
    const nodeRenderer = this.nodeRenderers[node.type];
    if (nodeRenderer) nodeRenderer.render(node, context);
    const bounds = this.visualBounds(node.id, { project: context.project, pageId: context.page.id, assets: context.assets });
    context.withClip(bounds, () => { for (const child of context.tree.childrenOf(node.id)) this.renderNode(context, child.id); });
  }

  renderPage(project, pageId, assets) {
    const framebuffer = new Framebuffer(400, 300, { base: 0, opaque: true });
    const context = this.context(project, pageId, assets, framebuffer);
    this.drawPageBackground(context);
    for (const root of context.tree.roots()) this.renderNode(context, root.id);
    return framebuffer.toUint8Array();
  }

  renderSubtree(project, pageId, nodeId, assets, base = 0) {
    const framebuffer = new Framebuffer(400, 300, { base, opaque: true });
    const context = this.context(project, pageId, assets, framebuffer);
    if (!context.tree.node(nodeId)) return framebuffer.toUint8Array();
    context.clipStack[0] = this.ancestorClip(nodeId, { project, pageId, assets });
    this.renderNode(context, nodeId);
    return framebuffer.toUint8Array();
  }

  visualSubtreeBounds(nodeId, context) {
    const page = this.page(context.project, context.pageId);
    if (!page) return { x: 0, y: 0, w: 0, h: 0 };
    const tree = new TreeModel(page), list = [];
    const visit = (id, clip) => {
      const node = tree.node(id);
      if (!node || node.visible === false || !hasArea(clip)) return;
      const raw = this.visualBounds(id, context), visible = intersectBounds(raw, clip);
      if (hasArea(visible)) list.push(visible);
      const childClip = intersectBounds(clip, raw);
      for (const child of tree.childrenOf(id)) visit(child.id, childClip);
    };
    if (tree.node(nodeId)) visit(nodeId, this.ancestorClip(nodeId, context));
    return unionBounds(list);
  }

  subtreeRgba(project, pageId, nodeId, assets) {
    const bounds = this.visualSubtreeBounds(nodeId, { project, pageId, assets });
    const x0 = Math.max(0, Math.floor(bounds.x)), y0 = Math.max(0, Math.floor(bounds.y));
    const x1 = Math.min(400, Math.ceil(bounds.x + bounds.w)), y1 = Math.min(300, Math.ceil(bounds.y + bounds.h));
    const width = Math.max(1, x1 - x0), height = Math.max(1, y1 - y0);
    const white = this.renderSubtree(project, pageId, nodeId, assets, 0), black = this.renderSubtree(project, pageId, nodeId, assets, 1);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const source = (y0 + y) * 400 + x0 + x, a = white[source], b = black[source], offset = (y * width + x) * 4;
      if (a === 0 && b === 1) data[offset + 3] = 0;
      else { const value = a ? 0 : 255; data[offset] = data[offset + 1] = data[offset + 2] = value; data[offset + 3] = 255; }
    }
    return { x: x0, y: y0, w: width, h: height, data };
  }
}

const pipeline = new Renderer();
const FramebufferRenderer = pipeline.facade;

export { Renderer, pipeline, FramebufferRenderer, renderRuntime };
