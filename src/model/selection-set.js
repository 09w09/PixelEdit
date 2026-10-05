class SelectionSet {
  constructor(ids = []) { this._ids = []; this._primary = null; this._boundaryHandler = null; this._propertySession = null; this.replace(ids); }
  get ids() { return [...this._ids]; }
  get primaryId() { return this._primary; }
  has(id) { return this._ids.includes(id); }
  setBoundaryHandler(handler) { this._boundaryHandler = typeof handler === 'function' ? handler : null; return this; }
  _notifyBoundary(reason = 'selection-change') { this._propertySession?.control?.blur?.(); this._boundaryHandler?.(reason); }
  replace(ids = []) { const next = []; for (const id of ids) if (id && !next.includes(id)) next.push(id); const primary = next.at(-1) || null; if (JSON.stringify(next) === JSON.stringify(this._ids) && primary === this._primary) return this; this._notifyBoundary(); this._ids = next; this._primary = primary; return this; }
  toggle(id) { if (!id) return this; this._notifyBoundary(); const index = this._ids.indexOf(id); if (index >= 0) this._ids.splice(index, 1); else this._ids.push(id); this._primary = this._ids.at(-1) || null; return this; }
  addMany(ids = []) { const additions = ids.filter(id => id && !this._ids.includes(id)); if (!additions.length) return this; this._notifyBoundary(); this._ids.push(...additions); this._primary = this._ids.at(-1) || this._primary; return this; }
  removeMany(ids = []) { const removed = new Set(ids); if (!this._ids.some(id => removed.has(id))) return this; this._notifyBoundary(); this._ids = this._ids.filter(id => !removed.has(id)); if (!this._ids.includes(this._primary)) this._primary = this._ids.at(-1) || null; return this; }
  clear() { this._notifyBoundary(); this._ids = []; this._primary = null; return this; }
  transformRoots(tree) { return this._ids.filter(id => !tree.ancestorsOf(id).some(ancestor => this.has(ancestor.id))); }
}

export { SelectionSet };
