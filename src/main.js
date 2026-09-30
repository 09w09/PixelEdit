import { installImageRuntime } from './media/image-runtime.js';
import { installPixelStrokeRuntime } from './rendering/pixel-stroke.js';

function installRuntimeModules() {
  installImageRuntime(globalThis);
  installPixelStrokeRuntime(globalThis);
}

installRuntimeModules();

export { installRuntimeModules };
