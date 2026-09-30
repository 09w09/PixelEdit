import { installFontManagerRuntime } from './fonts/font-manager.js';
import { installImageRuntime } from './media/image-runtime.js';
import { installRasterLayerRuntime } from './media/raster-layer.js';
import { installPixelStrokeRuntime } from './rendering/pixel-stroke.js';
import { installSelectionOverlayRuntime } from './rendering/selection-overlay.js';
import { installTextLayoutRuntime } from './rendering/text-layout.js';

function installRuntimeModules() {
  installImageRuntime(globalThis);
  installPixelStrokeRuntime(globalThis);
  installRasterLayerRuntime(globalThis);
  installSelectionOverlayRuntime(globalThis);
  installTextLayoutRuntime(globalThis);
  installFontManagerRuntime(globalThis);
}

installRuntimeModules();

export { installRuntimeModules };
