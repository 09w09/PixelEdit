function clone(value) {
  return structuredClone(value);
}

function toolDefaults(preferences, tool) {
  const defaults = preferences?.tools?.[tool];
  return defaults ? clone(defaults) : {};
}

function installToolStateRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.preferences) throw new Error('PixelEditor preferences are not initialized');
  if (PE.toolStateInstalled) return;
  PE.toolStateInstalled = true;
  PE.tools = PE.tools || {};
  PE.tools.toolDefaults = toolDefaults;
}

export { toolDefaults, installToolStateRuntime };
