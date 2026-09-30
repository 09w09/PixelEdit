import { installImageRuntime } from './media/image-runtime.js';
import { installPixelStrokeRuntime } from './rendering/pixel-stroke.js';
import { installSelectionOverlayRuntime } from './rendering/selection-overlay.js';

function installRuntimeModules() {
  installImageRuntime(globalThis);
  installPixelStrokeRuntime(globalThis);
  installSelectionOverlayRuntime(globalThis);
}

installRuntimeModules();

export { installRuntimeModules };
