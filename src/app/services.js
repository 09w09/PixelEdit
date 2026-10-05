import * as model from '../model/index.js';
import * as commands from '../commands/index.js';
import * as persistence from '../persistence/index.js';
import { FramebufferRenderer, Renderer, pipeline } from '../rendering/renderer.js';
import { graphicDitherPixel, patternPixel } from '../rendering/pattern-renderer.js';
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
import * as contextMenu from '../ui/context-menu.js';
import * as workspaceLayout from '../preferences/workspace-layout-runtime.js';
import * as fontOptions from '../fonts/font-options.js';
import * as fontImport from '../fonts/font-import.js';
import * as fonts from '../fonts/font-manager.js';
import * as imageRuntime from '../media/image-runtime.js';
import * as photopeaTransformModule from '../transforms/photopea-transform-ui.js';
import { ToolController } from '../tools/tool-controller.js';
import { ToolRegistry, toolRegistry } from '../tools/tool-registry.js';
import { PropertyDescriptor, PropertyProvider, PropertySession, normalizeNumber } from '../properties/property-system.js';
import { Toolbar } from '../ui/toolbar.js';
import { PageDock } from '../ui/page-dock.js';
import { HistoryDock } from '../ui/history-dock.js';
import { Properties } from '../ui/properties.js';

function createServices() {
  const renderer = Object.freeze({
    FramebufferRenderer,
    Renderer,
    pipeline,
    graphicDitherPixel,
    patternPixel,
  });
  const interaction = Object.freeze({ HitTest, rectIntersects, SnapEngine, InteractionController });
  const ui = Object.freeze({ Toolbar, PageDock, HistoryDock, Properties });
  const tools = Object.freeze({ ToolController, ToolRegistry, registry: toolRegistry });
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
    model,
    commands,
    persistence,
    renderer,
    interaction,
    ui,
    tools,
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
    workspaceLayout,
    fontOptions,
    fontImport,
    fonts,
    imageRuntime,
    svgVectorRuntime: imageRuntime,
    photopeaTransformUI,
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
