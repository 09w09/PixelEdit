class TreeModel {
  constructor(page) { this.page = page; }
  node(id) { return this.page?.nodes?.find(node => node.id === id) || null; }
  childrenOf(parentId) { return this.page.nodes.filter(node => node.parentId === parentId); }
  roots() { return this.childrenOf(this.page.id); }
  ancestorsOf(id) {
    const out = []; let node = this.node(id); const seen = new Set();
    while (node && node.parentId && node.parentId !== this.page.id) {
      if (seen.has(node.parentId)) throw new Error('cycle');
      seen.add(node.parentId); node = this.node(node.parentId);
      if (!node) throw new Error('orphan parent');
      out.push(node);
    }
    if (node && node.parentId !== this.page.id) throw new Error('layer must descend from page');
    return out;
  }
  descendantsOf(id) { const out = []; const walk = parentId => { for (const child of this.childrenOf(parentId)) { out.push(child); walk(child.id); } }; walk(id); return out; }
  isAncestor(ancestorId, id) { return this.ancestorsOf(id).some(node => node.id === ancestorId); }
  validateHierarchy() {
    const ids = new Set();
    for (const node of this.page.nodes) { if (node.type === 'background') throw new Error('background node is forbidden in V17'); if (ids.has(node.id)) throw new Error('duplicate node id'); ids.add(node.id); }
    for (const node of this.page.nodes) {
      if (!node.parentId) throw new Error('layer must have parent');
      let parentId = node.parentId; const seen = new Set([node.id]);
      while (parentId !== this.page.id) { if (seen.has(parentId)) throw new Error('cycle'); seen.add(parentId); const parent = this.node(parentId); if (!parent) throw new Error('orphan parent'); parentId = parent.parentId; }
    }
    return true;
  }
  validateAcyclic() { return this.validateHierarchy(); }
  isInheritedLocked(id) { const node = this.node(id); return Boolean(node) && (Boolean(this.page.locked) || this.ancestorsOf(id).some(ancestor => ancestor.locked)); }
  isEffectivelyLocked(id) { const node = this.node(id); return Boolean(node) && (Boolean(node.locked) || this.isInheritedLocked(id)); }
  isEffectivelyVisible(id) { const node = this.node(id); return Boolean(node) && node.visible !== false && !this.ancestorsOf(id).some(ancestor => ancestor.visible === false); }
  reparent(id, newParentId, index = null) {
    const node = this.node(id); if (!node) throw new Error('missing node');
    newParentId ||= this.page.id;
    if (id === newParentId) throw new Error('self parent');
    if (newParentId !== this.page.id && !this.node(newParentId)) throw new Error('missing parent');
    if (newParentId !== this.page.id && this.isAncestor(id, newParentId)) throw new Error('parent cycle');
    node.parentId = newParentId; this.reorder(id, index == null ? this.childrenOf(newParentId).length - 1 : index); return node;
  }
  reorder(id, index) {
    const node = this.node(id); if (!node) throw new Error('missing node');
    const siblings = this.childrenOf(node.parentId).filter(item => item.id !== id);
    const target = Math.max(0, Math.min(siblings.length, index == null ? siblings.length : index));
    const ordered = [...siblings.slice(0, target), node, ...siblings.slice(target)];
    const ids = new Set(ordered.map(item => item.id));
    const positions = this.page.nodes.map((item, position) => ids.has(item.id) ? position : -1).filter(position => position >= 0);
    if (positions.length !== ordered.length) return ordered;
    for (let position = 0; position < ordered.length; position += 1) this.page.nodes[positions[position]] = ordered[position];
    return ordered;
  }
  visualOrder() { const out = []; const walk = parentId => { for (const child of this.childrenOf(parentId)) { out.push(child); walk(child.id); } }; walk(this.page.id); return out; }
}

export { TreeModel };
