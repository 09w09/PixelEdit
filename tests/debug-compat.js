import * as primitives from '../src/rendering/bitmap-primitives.js';
import { graphicDitherPixel, patternPixel } from '../src/rendering/pattern-renderer.js';
import { TextRenderer } from '../src/rendering/base-text-renderer.js';
import { ImageRenderer } from '../src/rendering/base-image-renderer.js';
import { OverlayRenderer } from '../src/rendering/base-overlay-renderer.js';
import { Framebuffer } from '../src/rendering/framebuffer.js';
import { RenderContext } from '../src/rendering/render-context.js';
import * as textLayout from '../src/rendering/text-layout.js';
import * as preferences from '../src/preferences/editor-preferences.js';
import { hierarchyClip } from '../src/rendering/hierarchy-clipping.js';
import { strokeStyle } from '../src/rendering/stroke-style.js';
import { ElementClipboard } from '../src/clipboard/element-clipboard.js';

function legacyDebugView() {
  const debug = globalThis.PixelEditorDebug;
  if (!debug) return undefined;
  const services = debug.services;
  const model = services.model;
  return {
    ...services,
    version: model.PROJECT_VERSION,
    model,
    commands: services.commands,
    renderer: {
      ...primitives,
      graphicDitherPixel,
      patternPixel,
      TextRenderer,
      ImageRenderer,
      OverlayRenderer,
      Framebuffer,
      RenderContext,
      ...services.renderer,
    },
    interaction: { ...services.interaction, Clipboard: ElementClipboard },
    persistence: services.persistence,
    ui: { ...services.ui, Workspace: debug.app?.constructor },
    commandCoalescing: services.commands,
    integerGeometry: {
      BOX_TYPES: model.BOX_TYPES,
      finiteInteger: model.finiteInteger,
      nearestEvenInteger: model.nearestEvenInteger,
      positiveInteger: model.positiveInteger,
      integerPoint: model.integerPoint,
      normalizeTransformTranslation: model.normalizeCommittedTransform,
      normalizeNodeGeometry: model.normalizeNodeGeometry,
      normalizeGeometryPatch: model.normalizeGeometryPatch,
      normalizeProjectGeometry: model.normalizeCommittedProject,
      projectGeometryViolations: model.invariantViolations,
      assertIntegerProjectGeometry: model.assertProjectInvariants,
    },
    textLayout,
    preferences,
    shapeStyleProperties: {},
    hierarchyClip,
    strokeStyle,
    ElementClipboard,
    elementClipboard: { ElementClipboard },
  };
}

Object.defineProperty(globalThis, 'PixelEditor', {
  configurable: true,
  enumerable: false,
  get: legacyDebugView,
});
