import { installImageRuntime } from './media/image-runtime.js';
import { installPixelStrokeRuntime } from './rendering/pixel-stroke.js';
import { installSelectionOverlayRuntime } from './rendering/selection-overlay.js';
import { installTextLayoutRuntime } from './rendering/text-layout.js';

function installRuntimeModules() {
  installImageRuntime(globalThis);
  installPixelStrokeRuntime(globalThis);
  installSelectionOverlayRuntime(globalThis);
  installTextLayoutRuntime(globalThis);
}

installRuntimeModules();

export { installRuntimeModules };
