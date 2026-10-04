function normalizedIds(ids = []) {
  const output = [];
  for (const id of ids || []) if (id && !output.includes(id)) output.push(id);
  return output;
}

function selectionSignature(ids, primaryId) {
  return JSON.stringify({ ids, primaryId: primaryId || null });
}

function nextSelectionSignature(selection, method, args) {
  const ids = selection.ids;
  let next = [...ids];
  let primary = selection.primaryId;
  if (method === 'replace') {
    next = normalizedIds(args[0]);
    primary = next.at(-1) || null;
  } else if (method === 'toggle') {
    const id = args[0];
    const index = next.indexOf(id);
    if (index >= 0) next.splice(index, 1);
    else if (id) next.push(id);
    primary = next.at(-1) || null;
  } else if (method === 'addMany') {
    const additions = args[0] || [];
    for (const id of additions) if (id && !next.includes(id)) next.push(id);
    if (additions.length) primary = next.at(-1) || primary;
  } else if (method === 'removeMany') {
    const removed = new Set(args[0] || []);
    next = next.filter(id => !removed.has(id));
    if (!next.includes(primary)) primary = next.at(-1) || null;
  } else if (method === 'clear') {
    next = [];
    primary = null;
  }
  return selectionSignature(next, primary);
}

function installPropertySelectionBoundary(target = globalThis) {
  const PE = target.PixelEditor;
  const SelectionSet = PE?.model?.SelectionSet;
  if (!SelectionSet) throw new Error('PixelEditor selection property boundary dependencies are not initialized');
  if (PE.propertySelectionBoundaryInstalled) return;
  PE.propertySelectionBoundaryInstalled = true;

  for (const method of ['replace', 'toggle', 'addMany', 'removeMany', 'clear']) {
    const original = SelectionSet.prototype[method];
    if (typeof original !== 'function') continue;
    SelectionSet.prototype[method] = function propertySessionSelectionBoundary(...args) {
      const before = selectionSignature(this.ids, this.primaryId);
      const after = nextSelectionSignature(this, method, args);
      if (before !== after) this._propertySession?.control?.blur?.();
      return original.apply(this, args);
    };
  }
}

export { installPropertySelectionBoundary };
