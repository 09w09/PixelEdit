function clone(value) {
  return structuredClone(value);
}

function toolDefaults(preferences, tool) {
  const defaults = preferences?.tools?.[tool];
  return defaults ? clone(defaults) : {};
}

export { toolDefaults };
