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
      renderPageComposite: this.renderPageComposite.bind(this),
      renderPageTransparentEdges: this.renderPageTransparentEdges.bind(this),
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

  drawPageBackground(context, { hideFill = false } = {}) {
    const page = context.page;
    const framebuffer = context.framebuffer;
    if (!hideFill && page.fill.mode === 'solid') {
      framebuffer.bits.fill(page.fill.color ? 1 : 0);
      framebuffer.alpha.fill(1);
    } else if (!hideFill && page.fill.mode !== 'transparent') {
      for (let y = 0; y < 300; y += 1) for (let x = 0; x < 400; x += 1) {
        const color = fillValue(page, this.runtime, x, y, x, y, { background: true });
        if (color != null) framebuffer.plot(x, y, color, true);
      }
    }
    // Page-level painting remains an opaque white/black mark, even on transparent pages.
    for (const [key, value] of Object.entries(page.overlay || {})) {
      const [x, y] = key.split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) framebuffer.plot(x, y, value, true);
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

  // Single source of truth for both 1-bit output and actual composited alpha.
  renderPageComposite(project, pageId, assets, { hidePageBackground = false } = {}) {
    const framebuffer = new Framebuffer(400, 300);
    const context = this.context(project, pageId, assets, framebuffer);
    this.drawPageBackground(context, { hideFill: hidePageBackground });
    for (const root of context.tree.roots()) this.renderNode(context, root.id);
    return { bits: framebuffer.bits, alpha: framebuffer.alpha };
  }

  // Scope transparency marks to the transformed bounds of *visible* nodes.
  // This mask is separate from the page backdrop, and from the pixels each node paints.
  renderNodeBoundsMask(project, pageId, assets) {
    const mask = new Framebuffer(400, 300);
    const context = this.context(project, pageId, assets, mask);
    const visit = id => {
      const node = context.tree.node(id);
      if (!node || node.visible === false || !hasArea(context.currentClip)) return;
      const bounds = this.sourceBounds(node, context);
      if (hasArea(bounds)) {
        const layer = context.createLayer(bounds);
        layer.alpha.fill(1);
        context.compositeNodeLayer(node, layer, bounds);
      }
      const visible = this.visualBounds(node.id, { project, pageId, assets });
      context.withClip(visible, () => {
        for (const child of context.tree.childrenOf(node.id)) visit(child.id);
      });
    };
    for (const root of context.tree.roots()) visit(root.id);
    return mask.alpha;
  }

  // Mark only transparent pixels *inside* visible layer bounds, and only at
  // their contours. Never recolor the blank page background or opaque artwork.
  renderPageTransparentEdges(project, pageId, assets) {
    const bounds = this.renderNodeBoundsMask(project, pageId, assets);
    const content = this.renderPageComposite(project, pageId, assets, { hidePageBackground: true }).alpha;
    const edges = new Uint8Array(bounds.length);
    const hole = i => bounds[i] === 1 && content[i] === 0;
    for (let y = 0; y < 300; y += 1) {
      for (let x = 0; x < 400; x += 1) {
        const i = y * 400 + x;
        if (!hole(i)) continue;
        if (x === 0 || !hole(i - 1) || x === 399 || !hole(i + 1)
          || y === 0 || !hole(i - 400) || y === 299 || !hole(i + 400))
          edges[i] = 1;
      }
    }
    return edges;
  }

  // Hardware preview/output is always opaque 1-bit, with transparent pixels flattened to white.
  renderPage(project, pageId, assets) {
    const { bits, alpha } = this.renderPageComposite(project, pageId, assets);
    const output = bits.slice();
    for (let index = 0; index < output.length; index += 1)
      if (!alpha[index]) output[index] = 0;
    return output;
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
