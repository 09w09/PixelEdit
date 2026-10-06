import * as model from '../model/index.js';
import * as commands from '../commands/index.js';
import * as persistence from '../persistence/index.js';
import * as primitives from '../rendering/bitmap-primitives.js';
import { FramebufferRenderer, Renderer, pipeline } from '../rendering/renderer.js';
import { graphicDitherPixel, patternPixel } from '../rendering/pattern-renderer.js';
import { TextRenderer } from '../rendering/base-text-renderer.js';
import { ImageRenderer } from '../rendering/base-image-renderer.js';
import { OverlayRenderer } from '../rendering/base-overlay-renderer.js';
import { Framebuffer } from '../rendering/framebuffer.js';
import { RenderContext } from '../rendering/render-context.js';
import { rasterThinLine, forEachStrokePixel, lineStrokeBounds } from '../rendering/pixel-stroke.js';
import * as textLayout from '../rendering/text-layout.js';
import { hierarchyClip } from '../rendering/hierarchy-clipping.js';
import { strokeStyle } from '../rendering/stroke-style.js';
import { HitTest, rectIntersects } from '../interaction/hit-test.js';
import { SnapEngine } from '../interaction/snap-engine.js';
import { InteractionController } from '../interaction/interaction-controller.js';
import { transformModel } from '../transforms/transform-model.js';
import { selectionGeometry } from '../selection/selection-geometry.js';
import { selectionOverlay } from '../rendering/selection-overlay.js';
import * as selectionTransform from '../transforms/selection-transform.js';
import * as floodFill from '../raster/flood-fill.js';
import * as paintBrush from '../raster/paint-brush.js';
import * as tristateRaster from '../raster/tristate-raster.js';
import { rasterLayer } from '../media/raster-layer.js';
import { OverlayPipeline } from '../rendering/overlay-pipeline.js';
import {
  PREVIEW_FILL,
  PREVIEW_OPACITY,
  transparentPixelRects,
  transparencyPreviewMarkup,
} from '../rendering/transparency-overlay.js';
import * as canvasCursor from '../tools/canvas-cursor.js';
import { createContextMenuService } from '../ui/context-menu.js';
import { classifyContextRegion, installNativeContextMenuBoundary } from '../ui/context-menu-boundary.js';
import * as workspaceLayout from '../preferences/workspace-layout-runtime.js';
import * as preferences from '../preferences/editor-preferences.js';
import * as fontOptions from '../fonts/font-options.js';
import * as fontImport from '../fonts/font-import.js';
import * as fonts from '../fonts/font-manager.js';
import * as imageRuntime from '../media/image-runtime.js';
import * as photopeaTransformModule from '../transforms/photopea-transform-ui.js';
import { ElementClipboard } from '../clipboard/element-clipboard.js';
import { ToolController } from '../tools/tool-controller.js';
import { ToolRegistry, toolRegistry } from '../tools/tool-registry.js';
import { PropertyDescriptor, PropertyProvider, PropertySession, normalizeNumber } from '../properties/property-system.js';
import { Toolbar } from '../ui/toolbar.js';
import { PageDock } from '../ui/page-dock.js';
import { HistoryDock } from '../ui/history-dock.js';
import { Properties } from '../ui/properties.js';

const pixelStroke = Object.freeze({ rasterThinLine, forEachStrokePixel, lineStrokeBounds });
const clipboard = Object.freeze({ ElementClipboard });
const contextMenuBoundary = Object.freeze({ classifyContextRegion, installNativeContextMenuBoundary });
const plotThickLine = (framebuffer, x1, y1, x2, y2, width = 1, value = 1) => (
  forEachStrokePixel(x1, y1, x2, y2, width, (x, y) => primitives.plotPixel(framebuffer, x, y, value))
);

function createServices() {
  const renderer = Object.freeze({
    ...primitives,
    FramebufferRenderer,
    Renderer,
    pipeline,
    graphicDitherPixel,
    patternPixel,
    TextRenderer,
    ImageRenderer,
    OverlayRenderer,
    Framebuffer,
    RenderContext,
    plotThickLine,
  });
  const interaction = Object.freeze({ HitTest, rectIntersects, SnapEngine, InteractionController });
  const ui = Object.freeze({ Toolbar, PageDock, HistoryDock, Properties });
  const tools = Object.freeze({ ToolController, ToolRegistry, registry: toolRegistry });
  const contextMenu = createContextMenuService({ model, commands, interaction, target: globalThis });
  const transparencyOverlay = Object.freeze({
    PREVIEW_FILL,
    PREVIEW_OPACITY,
    transparentPixelRects: node => transparentPixelRects(node, tristateRaster.decodeTriStatePixels),
    transparencyPreviewMarkup: node => transparencyPreviewMarkup(node, tristateRaster.decodeTriStatePixels),
    markup(editor) {
      if (!editor?.editorPreferences?.transparencyPreview) return '';
      const id = editor.state.selection.primaryId;
      if (!id) return '';
      const node = model.nodeById(editor.activePage(), id);
      if (!node || node.type !== 'raster') return '';
      return transparencyPreviewMarkup(node, tristateRaster.decodeTriStatePixels);
    },
  });
  const photopeaTransformUI = Object.freeze({
    integerVisualBounds: photopeaTransformModule.integerVisualBounds,
    withEdgeHandles: photopeaTransformModule.withEdgeHandles,
    resizeCursorForHandle: photopeaTransformModule.resizeCursorForHandle,
    edgeHandlesMarkup: editor => photopeaTransformModule.edgeHandlesMarkup(editor, {
      model,
      selectionGeometry,
      selectionOverlay,
    }),
  });
  const overlayPipeline = new OverlayPipeline({
    transparencyOverlay,
    photopeaTransformUI,
    canvasCursor,
    selection: selectionOverlay,
  });
  const services = {
    version: model.PROJECT_VERSION,
    model,
    commands,
    persistence,
    renderer,
    interaction,
    ui,
    tools,
    clipboard,
    binaryImage: pipeline.binaryImage,
    transformModel,
    selectionGeometry,
    selectionOverlay,
    selectionTransform,
    floodFill,
    paintBrush,
    tristateRaster,
    rasterLayer,
    overlayPipeline,
    transparencyOverlay,
    canvasCursor,
    contextMenu,
    contextMenuBoundary,
    workspaceLayout,
    preferences,
    fontOptions,
    fontImport,
    fonts,
    imageRuntime,
    svgVectorRuntime: imageRuntime,
    photopeaTransformUI,
    textLayout,
    hierarchyClip,
    strokeStyle,
    pixelStroke,
  };
  const propertyProvider = new PropertyProvider(services);
  services.propertyProvider = propertyProvider;
  services.properties = Object.freeze({
    PropertyDescriptor,
    PropertyProvider,
    PropertySession,
    normalizeNumber,
    provider: propertyProvider,
  });
  return Object.freeze(services);
}

const services = createServices();

export { createServices, services };
