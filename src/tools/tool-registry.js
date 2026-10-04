const TOOL_DEFINITIONS = [
  { id: 'pointer', kind: 'pointer', cursor: 'native', options: 'selection' },
  { id: 'select', kind: 'selection', cursor: 'crosshair', options: 'selection' },
  { id: 'pencil', kind: 'paint', cursor: 'brush', options: 'paint' },
  { id: 'eraser', kind: 'paint', cursor: 'brush', options: 'paint' },
  { id: 'bucket', kind: 'bucket', cursor: 'crosshair', options: 'fill', shortcut: 'b' },
  { id: 'line', kind: 'draw', cursor: 'crosshair', options: 'shape' },
  { id: 'rectangle', kind: 'draw', cursor: 'crosshair', options: 'shape' },
  { id: 'circle', kind: 'draw', cursor: 'crosshair', options: 'shape' },
  { id: 'polygon', kind: 'draw', cursor: 'crosshair', options: 'shape' },
  { id: 'image', kind: 'image', cursor: 'crosshair', options: 'none' },
  { id: 'text', kind: 'draw', cursor: 'crosshair', options: 'text' },
];

class ToolRegistry {
  constructor(definitions = []) {
    this.definitions = new Map();
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    const id = String(definition?.id || '');
    if (!id) throw new Error('Tool definition requires an id');
    const normalized = Object.freeze({ ...definition, id });
    this.definitions.set(id, normalized);
    return normalized;
  }

  get(id) {
    return this.definitions.get(String(id || '')) || null;
  }

  has(id) {
    return this.definitions.has(String(id || ''));
  }

  ids() {
    return [...this.definitions.keys()];
  }

  values() {
    return [...this.definitions.values()];
  }
}

function installToolRegistry(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE) throw new Error('PixelEditor core is not initialized');
  PE.tools = PE.tools || {};
  PE.tools.ToolRegistry = ToolRegistry;
  if (!PE.tools.registry) PE.tools.registry = new ToolRegistry(TOOL_DEFINITIONS);
  return PE.tools.registry;
}

export { TOOL_DEFINITIONS, ToolRegistry, installToolRegistry };
