import * as primitives from '../rendering/bitmap-primitives.js';
import { graphicDitherPixel, patternPixel } from '../rendering/pattern-renderer.js';
import { TextRenderer } from '../rendering/base-text-renderer.js';
import { ImageRenderer } from '../rendering/base-image-renderer.js';
import { OverlayRenderer } from '../rendering/base-overlay-renderer.js';
import { Framebuffer } from '../rendering/framebuffer.js';
import { RenderContext } from '../rendering/render-context.js';
import { Renderer, pipeline, FramebufferRenderer } from '../rendering/renderer.js';
import { hierarchyClip } from '../rendering/hierarchy-clipping.js';
import { strokeStyle } from '../rendering/stroke-style.js';

const PE = globalThis.PixelEditor;
Object.assign(PE.renderer, {
  ...primitives,
  graphicDitherPixel,
  patternPixel,
  TextRenderer,
  ImageRenderer,
  OverlayRenderer,
  Renderer,
  RenderContext,
  Framebuffer,
  nodeRenderers: pipeline.nodeRenderers,
  pipeline,
  FramebufferRenderer,
});
PE.hierarchyClip = hierarchyClip;
PE.strokeStyle = strokeStyle;
