import { installElementClipboardRuntime } from './clipboard/element-clipboard.js';
import { installFontImportRuntime } from './fonts/font-import.js';
import { installFontManagerRuntime } from './fonts/font-manager.js';
import { installEditBoundariesRuntime } from './media/edit-boundaries.js';
import { installImageRuntime } from './media/image-runtime.js';
import { installRasterLayerRuntime } from './media/raster-layer.js';
import { installRasterSizingRuntime } from './media/raster-sizing.js';
import { installEditorPreferencesRuntime } from './preferences/editor-preferences.js';
import { installPaintBrushRuntime } from './raster/paint-brush.js';
import { installTriStateRasterRuntime } from './raster/tristate-raster.js';
import { installPixelStrokeRuntime } from './rendering/pixel-stroke.js';
import { installSelectionOverlayRuntime } from './rendering/selection-overlay.js';
import { installStrokeStyleRuntime } from './rendering/stroke-style.js';
import { installTextLayoutRuntime } from './rendering/text-layout.js';
import { installTransparencyOverlayRuntime } from './rendering/transparency-overlay.js';
import { installToolOptionsRuntime } from './tools/tool-options-bar.js';
import { installToolStateRuntime } from './tools/tool-state.js';
import { installSelectionTransformRuntime } from './transforms/selection-transform.js';
import { installTransformModelRuntime } from './transforms/transform-model.js';
import { installContextMenuRuntime } from './ui/context-menu.js';

function installRuntimeModules() {
  installEditorPreferencesRuntime(globalThis);
  installToolStateRuntime(globalThis);
  installToolOptionsRuntime(globalThis);
  installImageRuntime(globalThis);
  installPixelStrokeRuntime(globalThis);
  installStrokeStyleRuntime(globalThis);
  installTriStateRasterRuntime(globalThis);
  installRasterLayerRuntime(globalThis);
  installPaintBrushRuntime(globalThis);
  installRasterSizingRuntime(globalThis);
  installEditBoundariesRuntime(globalThis);
  installTransformModelRuntime(globalThis);
  installSelectionTransformRuntime(globalThis);
  installElementClipboardRuntime(globalThis);
  installContextMenuRuntime(globalThis);
  installSelectionOverlayRuntime(globalThis);
  installTransparencyOverlayRuntime(globalThis);
  installTextLayoutRuntime(globalThis);
  installFontManagerRuntime(globalThis);
  installFontImportRuntime(globalThis);
}

installRuntimeModules();

export { installRuntimeModules };
