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
import * as rasterLayer from '../media/raster-layer.js';
import * as overlayPipeline from '../rendering/overlay-pipeline.js';
import * as canvasCursor from '../tools/canvas-cursor.js';
import * as contextMenu from '../ui/context-menu.js';
import * as workspaceLayout from '../preferences/workspace-layout-runtime.js';
import * as fontOptions from '../fonts/font-options.js';
import * as fontImport from '../fonts/font-import.js';
import * as fonts from '../fonts/font-manager.js';
import * as imageRuntime from '../media/image-runtime.js';
import * as photopeaTransformUI from '../transforms/photopea-transform-ui.js';
import { Toolbar } from '../ui/toolbar.js';
import { PageDock } from '../ui/page-dock.js';
import { HistoryDock } from '../ui/history-dock.js';

function createServices() {
  const renderer = Object.freeze({
    FramebufferRenderer,
    Renderer,
    pipeline,
    graphicDitherPixel,
    patternPixel,
  });
  const interaction = Object.freeze({ HitTest, rectIntersects, SnapEngine, InteractionController });
  const ui = Object.freeze({ Toolbar, PageDock, HistoryDock });
  return Object.freeze({
    model,
    commands,
    persistence,
    renderer,
    interaction,
    ui,
    transformModel,
    selectionGeometry,
    selectionOverlay,
    selectionTransform,
    floodFill,
    paintBrush,
    tristateRaster,
    rasterLayer,
    overlayPipeline,
    canvasCursor,
    contextMenu,
    workspaceLayout,
    fontOptions,
    fontImport,
    fonts,
    imageRuntime,
    photopeaTransformUI,
  });
}

export { createServices };
