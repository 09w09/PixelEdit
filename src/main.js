import { installFontImportRuntime } from './fonts/font-import.js';
import { installFontManagerRuntime } from './fonts/font-manager.js';
import { installEditBoundariesRuntime } from './media/edit-boundaries.js';
import { installImageRuntime } from './media/image-runtime.js';
import { installRasterLayerRuntime } from './media/raster-layer.js';
import { installRasterSizingRuntime } from './media/raster-sizing.js';
import { installEditorPreferencesRuntime } from './preferences/editor-preferences.js';
import { installPixelStrokeRuntime } from './rendering/pixel-stroke.js';
import { installSelectionOverlayRuntime } from './rendering/selection-overlay.js';
import { installTextLayoutRuntime } from './rendering/text-layout.js';
import { installToolOptionsRuntime } from './tools/tool-options-bar.js';
import { installToolStateRuntime } from './tools/tool-state.js';

function installRuntimeModules() {
  installEditorPreferencesRuntime(globalThis);
  installToolStateRuntime(globalThis);
  installToolOptionsRuntime(globalThis);
  installImageRuntime(globalThis);
  installPixelStrokeRuntime(globalThis);
  installRasterLayerRuntime(globalThis);
  installRasterSizingRuntime(globalThis);
  installEditBoundariesRuntime(globalThis);
  installSelectionOverlayRuntime(globalThis);
  installTextLayoutRuntime(globalThis);
  installFontManagerRuntime(globalThis);
  installFontImportRuntime(globalThis);
}

installRuntimeModules();

export { installRuntimeModules };
