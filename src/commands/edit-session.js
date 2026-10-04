const clone = value => structuredClone(value);

function normalizeMergeDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return null;
  const operation = String(descriptor.operation || '').trim();
  const channel = String(descriptor.channel || '').trim();
  if (!operation || !channel) return null;
  const targets = [...new Set((descriptor.targets || []).filter(value => value != null).map(value => String(value)))].sort();
  return { operation, targets, channel };
}
function mergeDescriptorKey(descriptor) { const normalized = normalizeMergeDescriptor(descriptor); return normalized ? JSON.stringify(normalized) : ''; }
function resolveMergeDescriptor(command) { if (!command) return null; let descriptor = command.mergeDescriptor; if (typeof descriptor === 'function') descriptor = descriptor.call(command); return normalizeMergeDescriptor(descriptor); }
function diffLeafPaths(before, after, prefix = '') { if (Object.is(before, after)) return []; const beforeObject = before && typeof before === 'object', afterObject = after && typeof after === 'object', beforeArray = Array.isArray(before), afterArray = Array.isArray(after); if (beforeArray || afterArray) return JSON.stringify(before) === JSON.stringify(after) ? [] : (prefix ? [prefix] : []); if (!beforeObject || !afterObject) return prefix ? [prefix] : []; const paths = [], keys = new Set([...Object.keys(before), ...Object.keys(after)]); for (const key of keys) { const next = prefix ? `${prefix}.${key}` : key; paths.push(...diffLeafPaths(before[key], after[key], next)); } return paths; }

class EditSession {
  constructor(bus, descriptor = {}) {
    this.bus = bus;
    this.descriptor = normalizeMergeDescriptor(descriptor);
    this.label = String(descriptor.label || '编辑');
    this.startSnapshot = clone(bus.state.project);
    this.latestSnapshot = this.startSnapshot;
    this.startEntries = clone(bus.entries);
    this.startCursor = bus.cursor;
    this.startDirty = Boolean(bus.state.dirty);
    this.entryIndex = null;
    this.changed = false;
  }
  update(command, snapshot) {
    this.changed = true;
    this.latestSnapshot = snapshot;
    if (command?.label) this.label = command.label;
    const descriptor = resolveMergeDescriptor(command);
    if (descriptor) this.descriptor = descriptor;
  }
}

function attachSelectionBoundary(editor) { const selection = editor?.state?.selection; if (!selection?.setBoundaryHandler) return; selection.setBoundaryHandler(reason => editor.bus?.breakMergeChain?.(reason)); }
const PE = globalThis.PixelEditor;
PE.commandCoalescing = { normalizeMergeDescriptor, mergeDescriptorKey, resolveMergeDescriptor, diffLeafPaths, attachSelectionBoundary };
Object.assign(PE.commands, { EditSession, normalizeMergeDescriptor, mergeDescriptorKey, resolveMergeDescriptor, diffLeafPaths });
export { EditSession, normalizeMergeDescriptor, mergeDescriptorKey, resolveMergeDescriptor, diffLeafPaths, attachSelectionBoundary };
