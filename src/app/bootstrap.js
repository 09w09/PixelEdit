import { exposeDebugApi } from '../debug/debug-api.js';
import { Workspace } from './workspace.js';
import { services } from './services.js';

let app = null;

function bootstrapPixelEdit(target = globalThis) {
  const boot = () => {
    if (app) return app;
    if (typeof document === 'undefined') return null;

    document.documentElement.dataset.pixelEditor = 'v17';
    const editor = new Workspace();
    editor.toolController = new services.tools.ToolController(editor, services.tools.registry, target);
    editor.toolController.install();
    app = editor.mount();
    exposeDebugApi(target, { app, services });
    return app;
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else queueMicrotask(boot);
  }
  return boot;
}

export { bootstrapPixelEdit };
