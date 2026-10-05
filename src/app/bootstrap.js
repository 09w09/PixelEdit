function createToolDelegatingWorkspace(BaseWorkspace) {
  return class ToolDelegatingWorkspace extends BaseWorkspace {
    setTool(tool) {
      if (this.toolController) return this.toolController.setTool(tool);
      return super.setTool(tool);
    }

    beginPaint(point) {
      if (this.toolController) return this.toolController.beginPaint(point);
      return super.beginPaint(point);
    }

    onPointerDown(event) {
      if (this.toolController?.handlePointerDown(event)) return true;
      return super.onPointerDown(event);
    }

    onPointerMove(event) {
      const result = super.onPointerMove(event);
      this.toolController?.handlePointerMove(event);
      return result;
    }

    onPointerUp(event) {
      if (this.toolController?.handlePointerUp(event)) return true;
      return super.onPointerUp(event);
    }
  };
}

function bootstrapPixelEdit(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.ui?.Workspace) throw new Error('PixelEditor V17 core is not initialized');
  PE.version = 17;
  const boot = () => {
    if (PE.app) return PE.app;
    if (typeof document === 'undefined') return null;
    if (!PE.tools?.ToolController || !PE.tools?.registry) throw new Error('PixelEditor tool system is not initialized');
    document.documentElement.dataset.pixelEditor = 'v17';
    const Workspace = createToolDelegatingWorkspace(PE.ui.Workspace);
    const editor = new Workspace();
    editor.toolController = new PE.tools.ToolController(editor, PE.tools.registry, target);
    editor.toolController.install();
    PE.app = editor.mount();
    return PE.app;
  };
  PE.boot = boot;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else queueMicrotask(boot);
  }
  return boot;
}
export { bootstrapPixelEdit };
