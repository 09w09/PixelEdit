// Index-based hierarchy model: avoids repeated O(n) scans during rendering,
// hit-testing and drag operations. Reindex after every structural mutation.
class TreeModel {
  constructor(page) { this.page = page; this.reindex(); }
  reindex() {
    this.byId = new Map();
    this.byParent = new Map();
    for (const node of this.page?.nodes || []) {
      this.byId.set(node.id, node);
      const siblings = this.byParent.get(node.parentId) || [];
      siblings.push(node);
      this.byParent.set(node.parentId, siblings);
    }
  }
  node(id) { return this.byId.get(id) || null; }
  childrenOf(parentId) { return this.byParent.get(parentId) || []; }
  roots() { return this.childrenOf(this.page.id); }
  ancestorsOf(id) {
    const out = [], seen = new Set();
    let node = this.node(id);
    while (node && node.parentId && node.parentId !== this.page.id) {
      if (seen.has(node.parentId)) throw new Error('cycle');
      seen.add(node.parentId);
      node = this.node(node.parentId);
      if (!node) throw new Error('orphan parent');
      out.push(node);
    }
    if (node && node.parentId !== this.page.id) throw new Error('layer must descend from page');
    return out;
  }
  descendantsOf(id) {
    const out = [];
    const visit = parentId => { for (const child of this.childrenOf(parentId)) {
      out.push(child); visit(child.id);
    } };
    visit(id);
    return out;
  }
  isAncestor(ancestorId, id) { return this.ancestorsOf(id).some(node => node.id === ancestorId); }
  validateHierarchy() {
    if (this.byId.size !== this.page.nodes.length) throw new Error('duplicate node id');
    for (const node of this.page.nodes) {
      if (node.type === 'background') throw new Error('background node is forbidden in V17');
      if (!node.parentId) throw new Error('layer must have parent');
      const seen = new Set([node.id]);
      let parentId = node.parentId;
      while (parentId !== this.page.id) {
        if (seen.has(parentId)) throw new Error('cycle');
        seen.add(parentId);
        const parent = this.node(parentId);
        if (!parent) throw new Error('orphan parent');
        parentId = parent.parentId;
      }
    }
    return true;
  }
  validateAcyclic() { return this.validateHierarchy(); }
  isInheritedLocked(id) {
    const node = this.node(id);
    return Boolean(node) && (Boolean(this.page.locked) || this.ancestorsOf(id).some(item => item.locked));
  }
  isEffectivelyLocked(id) { const node = this.node(id); return Boolean(node) && (Boolean(node.locked) || this.isInheritedLocked(id)); }
  isEffectivelyVisible(id) {
    const node = this.node(id);
    return Boolean(node) && node.visible !== false && !this.ancestorsOf(id).some(item => item.visible === false);
  }
  reparent(id, newParentId, index = null) {
    const node = this.node(id);
    if (!node) throw new Error('missing node');
    newParentId ||= this.page.id;
    if (id === newParentId) throw new Error('self parent');
    if (newParentId !== this.page.id && !this.node(newParentId)) throw new Error('missing parent');
    if (newParentId !== this.page.id && this.isAncestor(id, newParentId)) throw new Error('parent cycle');
    node.parentId = newParentId;
    this.reindex();
    this.reorder(id, index == null ? this.childrenOf(newParentId).length - 1 : index);
    return node;
  }
  reorder(id, index) {
    const node = this.node(id);
    if (!node) throw new Error('missing node');
    const siblings = this.childrenOf(node.parentId).filter(item => item.id !== id);
    const target = Math.max(0, Math.min(siblings.length, index == null ? siblings.length : index));
    const ordered = [...siblings.slice(0, target), node, ...siblings.slice(target)];
    const ids = new Set(ordered.map(item => item.id));
    const positions = this.page.nodes.map((item, position) => ids.has(item.id) ? position : -1)
      .filter(position => position >= 0);
    if (positions.length !== ordered.length) return ordered;
    for (let position = 0; position < ordered.length; position += 1)
      this.page.nodes[positions[position]] = ordered[position];
    this.reindex();
    return ordered;
  }
  visualOrder() {
    const out = [];
    const walk = parentId => { for (const child of this.childrenOf(parentId)) { out.push(child); walk(child.id); } };
    walk(this.page.id);
    return out;
  }
}
export { TreeModel };
