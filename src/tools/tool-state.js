function clone(value) {
  return structuredClone(value);
}

function toolDefaults(preferences, tool) {
  const defaults = preferences?.tools?.[tool];
  return defaults ? clone(defaults) : {};
}

function installToolStateRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Workspace = PE?.ui?.Workspace;
  const preferences = PE?.preferences;
  if (!Workspace || !preferences) throw new Error('PixelEditor preferences are not initialized');
  if (PE.toolStateInstalled) return;
  PE.toolStateInstalled = true;

  PE.tools = PE.tools || {};
  PE.tools.toolDefaults = toolDefaults;

  Workspace.prototype.getToolDefaults = function getToolDefaults(tool = this.tool) {
    if (!this.editorPreferences) this.editorPreferences = preferences.loadEditorPreferences();
    return toolDefaults(this.editorPreferences, tool);
  };

  Workspace.prototype.setToolDefault = function setToolDefault(tool, key, value) {
    if (!this.editorPreferences) this.editorPreferences = preferences.loadEditorPreferences();
    const patch = { tools: { [tool]: { [key]: value } } };
    this.editorPreferences = preferences.updateEditorPreferences(this.editorPreferences, patch);
    preferences.saveEditorPreferences(this.editorPreferences);
    this.toolOptionsBar?.render?.();
    return this.getToolDefaults(tool);
  };

  Workspace.prototype.setTransparencyPreview = function setTransparencyPreview(enabled) {
    if (!this.editorPreferences) this.editorPreferences = preferences.loadEditorPreferences();
    this.editorPreferences = preferences.updateEditorPreferences(this.editorPreferences, {
      transparencyPreview: Boolean(enabled),
    });
    preferences.saveEditorPreferences(this.editorPreferences);
    this.updateTransparencyPreviewButton?.();
    this.renderOverlay?.();
    return this.editorPreferences.transparencyPreview;
  };

  const originalBeginLiveDraw = Workspace.prototype.beginLiveDraw;
  Workspace.prototype.beginLiveDraw = function beginLiveDrawWithDefaults(tool, point) {
    const result = originalBeginLiveDraw.call(this, tool, point);
    if (!result && !this.customGesture) return result;
    if (!['line', 'rectangle', 'circle', 'polygon'].includes(tool)) return result;
    const node = PE.model.nodeById(this.activePage(), this.customGesture?.nodeId);
    if (!node) return result;
    const settings = this.getToolDefaults(tool);
    node.lineWidth = settings.width;
    // Transitional V16 creation metadata; Task 3 replaces these with node.stroke.
    node.strokeColor = settings.color;
    node.strokeStyle = settings.style;
    this.renderCanvas?.();
    return result;
  };

  const originalBeginPaint = Workspace.prototype.beginPaint;
  Workspace.prototype.beginPaint = function beginPaintWithDefaults(point) {
    const result = originalBeginPaint.call(this, point);
    if (this.customGesture?.type === 'paint') {
      const settings = this.getToolDefaults(this.tool);
      this.customGesture.brushWidth = settings.width || 1;
      if (this.tool === 'pencil') this.customGesture.toolColor = settings.color ?? 1;
    }
    return result;
  };
}

export { toolDefaults, installToolStateRuntime };
