function normalizeMergeDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return null;
  const operation = String(descriptor.operation || '').trim();
  const channel = String(descriptor.channel || '').trim();
  if (!operation || !channel) return null;
  const targets = [...new Set((descriptor.targets || []).filter(value => value != null).map(value => String(value)))].sort();
  return { operation, targets, channel };
}

function mergeDescriptorKey(descriptor) {
  const normalized = normalizeMergeDescriptor(descriptor);
  return normalized ? JSON.stringify(normalized) : '';
}

function resolveMergeDescriptor(command) {
  if (!command) return null;
  let descriptor = command.mergeDescriptor;
  if (typeof descriptor === 'function') descriptor = descriptor.call(command);
  return normalizeMergeDescriptor(descriptor);
}

function diffLeafPaths(before, after, prefix = '') {
  if (Object.is(before, after)) return [];
  const beforeObject = before && typeof before === 'object';
  const afterObject = after && typeof after === 'object';
  const beforeArray = Array.isArray(before);
  const afterArray = Array.isArray(after);
  if (!beforeObject || !afterObject || beforeArray || afterArray) return prefix ? [prefix] : [];

  const paths = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const next = prefix ? `${prefix}.${key}` : key;
    paths.push(...diffLeafPaths(before[key], after[key], next));
  }
  return paths;
}

function selectionSignature(selection) {
  return JSON.stringify({ ids: selection?.ids || [], primaryId: selection?.primaryId || null });
}

function installCommandCoalescingRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const C = PE?.commands;
  const M = PE?.model;
  const R = PE?.renderer;
  const Workspace = PE?.ui?.Workspace;
  const SelectionSet = M?.SelectionSet;
  if (!C?.CommandBus || !C?.MoveSelectionCommand || !C?.UpdateNodesCommand || !M || !R?.FramebufferRenderer || !Workspace || !SelectionSet) {
    throw new Error('PixelEditor history coalescing dependencies are not initialized');
  }
  if (PE.commandCoalescingInstalled) return;
  PE.commandCoalescingInstalled = true;

  const clone = C.cloneProject || (value => structuredClone(value));
  const Bus = C.CommandBus;

  Bus.prototype.breakMergeChain = function breakMergeChain(reason = '') {
    this._mergeChainKey = null;
    this._mergeChainCursor = null;
    this._mergeBreakReason = String(reason || '');
  };

  Bus.prototype.execute = function executeSemantically(command) {
    if (!command || typeof command.execute !== 'function') throw new Error('invalid command');
    const changed = command.execute(this.state);
    if (changed === false) return false;

    const after = clone(this.state.project);
    const descriptor = resolveMergeDescriptor(command);
    const descriptorKey = mergeDescriptorKey(descriptor);
    const canMerge = Boolean(descriptorKey)
      && this._mergeChainKey === descriptorKey
      && this._mergeChainCursor === this.cursor
      && this.cursor > 0
      && this.cursor === this.entries.length - 1
      && this.entries[this.cursor]?.mergeDescriptorKey === descriptorKey;

    if (canMerge) {
      const entry = this.entries[this.cursor];
      entry.snapshot = after;
      entry.label = command.label || entry.label;
      entry.mergeDescriptor = descriptor;
      entry.mergeDescriptorKey = descriptorKey;
      this.state.dirty = true;
      return true;
    }

    if (this.cursor < this.entries.length - 1) this.entries.splice(this.cursor + 1);
    this.entries.push({
      label: command.label || '编辑',
      snapshot: after,
      mergeDescriptor: descriptor,
      mergeDescriptorKey: descriptorKey || null,
    });
    this.cursor = this.entries.length - 1;
    while (this.entries.length > this.limit + 1) {
      this.entries.shift();
      this.cursor -= 1;
    }
    this.state.dirty = true;

    if (descriptorKey) {
      this._mergeChainKey = descriptorKey;
      this._mergeChainCursor = this.cursor;
      this._mergeBreakReason = '';
    } else {
      this.breakMergeChain('nonmergeable-command');
    }
    return true;
  };

  Bus.prototype.restore = function restoreWithBoundary(index) {
    this.breakMergeChain('history-navigation');
    if (index < 0 || index >= this.entries.length) return false;
    this.state.project = clone(this.entries[index].snapshot);
    this.cursor = index;
    this.state.dirty = true;
    return true;
  };
  Bus.prototype.undo = function undoWithBoundary() {
    this.breakMergeChain('undo');
    return this.cursor > 0 ? this.restore(this.cursor - 1) : false;
  };
  Bus.prototype.redo = function redoWithBoundary() {
    this.breakMergeChain('redo');
    return this.cursor < this.entries.length - 1 ? this.restore(this.cursor + 1) : false;
  };
  Bus.prototype.jump = function jumpWithBoundary(index) {
    this.breakMergeChain('jump');
    return this.restore(index);
  };
  Bus.prototype.reset = function resetWithBoundary(project = this.state.project, label = '初始状态') {
    this.entries = [{ label, snapshot: clone(project) }];
    this.cursor = 0;
    this.breakMergeChain('reset');
  };

  Object.defineProperty(C.MoveSelectionCommand.prototype, 'mergeDescriptor', {
    configurable: true,
    get() {
      return { operation: 'move', targets: this.ids || [], channel: 'geometry' };
    },
  });

  const BaseUpdateNodesCommand = C.UpdateNodesCommand;
  class SemanticUpdateNodesCommand extends BaseUpdateNodesCommand {
    constructor(ids, patch, pageId = null, label = '编辑属性', historyOptions = {}) {
      super(ids, patch, pageId, label);
      this.historyOptions = historyOptions && typeof historyOptions === 'object' ? historyOptions : {};
      this._resolvedHistoryChannel = null;
    }

    execute(state) {
      const page = M.pageById(state.project, this.pageId || state.project.activePageId);
      const before = new Map();
      if (page) {
        for (const id of this.ids || []) {
          const node = M.nodeById(page, id);
          if (node) before.set(id, structuredClone(node));
        }
      }
      const changed = super.execute(state);
      if (changed === false) return false;
      if (this.historyOptions.merge === false) {
        this._resolvedHistoryChannel = null;
        return changed;
      }
      if (typeof this.historyOptions.historyChannel === 'string' && this.historyOptions.historyChannel.trim()) {
        this._resolvedHistoryChannel = this.historyOptions.historyChannel.trim();
        return changed;
      }
      const paths = new Set();
      if (page) {
        for (const [id, oldNode] of before) {
          const current = M.nodeById(page, id);
          for (const path of diffLeafPaths(oldNode, current)) {
            if (path && !['id', 'parentId'].includes(path)) paths.add(path);
          }
        }
      }
      this._resolvedHistoryChannel = paths.size === 1 ? [...paths][0] : null;
      return changed;
    }

    get mergeDescriptor() {
      return this._resolvedHistoryChannel
        ? { operation: 'property', targets: this.ids || [], channel: this._resolvedHistoryChannel }
        : null;
    }
  }
  C.UpdateNodesCommand = SemanticUpdateNodesCommand;

  if (C.UpdatePageCommand) {
    const BaseUpdatePageCommand = C.UpdatePageCommand;
    class SemanticUpdatePageCommand extends BaseUpdatePageCommand {
      constructor(pageId, patch, label = '编辑页面', historyOptions = {}) {
        super(pageId, patch, label);
        this.historyOptions = historyOptions && typeof historyOptions === 'object' ? historyOptions : {};
        this._resolvedHistoryChannel = null;
      }
      execute(state) {
        const page = M.pageById(state.project, this.pageId || state.project.activePageId);
        const before = page ? structuredClone(page) : null;
        const changed = super.execute(state);
        if (changed === false) return false;
        if (this.historyOptions.merge === false) return changed;
        if (typeof this.historyOptions.historyChannel === 'string' && this.historyOptions.historyChannel.trim()) {
          this._resolvedHistoryChannel = this.historyOptions.historyChannel.trim();
          return changed;
        }
        const paths = new Set(diffLeafPaths(before, page).filter(path => path && !['id', 'nodes'].includes(path)));
        this._resolvedHistoryChannel = paths.size === 1 ? [...paths][0] : null;
        return changed;
      }
      get mergeDescriptor() {
        return this._resolvedHistoryChannel
          ? { operation: 'property', targets: [`page:${this.pageId}`], channel: this._resolvedHistoryChannel }
          : null;
      }
    }
    C.UpdatePageCommand = SemanticUpdatePageCommand;
  }

  for (const method of ['replace', 'toggle', 'addMany', 'removeMany', 'clear']) {
    const original = SelectionSet.prototype[method];
    if (typeof original !== 'function') continue;
    SelectionSet.prototype[method] = function selectionBoundaryMethod(...args) {
      const before = selectionSignature(this);
      const result = original.apply(this, args);
      if (selectionSignature(this) !== before) this._historyBoundary?.('selection-change');
      return result;
    };
  }

  function attachSelectionBoundary(editor) {
    const selection = editor?.state?.selection;
    if (!selection) return;
    selection._historyBoundary = reason => editor.bus?.breakMergeChain?.(reason);
  }

  const originalExec = Workspace.prototype.exec;
  Workspace.prototype.exec = function execWithSelectionBoundary(command) {
    attachSelectionBoundary(this);
    return originalExec.call(this, command);
  };

  const originalRenderAll = Workspace.prototype.renderAll;
  Workspace.prototype.renderAll = function renderAllWithSelectionBoundary(options = {}) {
    attachSelectionBoundary(this);
    return originalRenderAll.call(this, options);
  };

  const originalSetTool = Workspace.prototype.setTool;
  Workspace.prototype.setTool = function setToolWithMergeBoundary(tool) {
    const before = this.tool;
    const result = originalSetTool.call(this, tool);
    if (this.tool !== before) this.bus?.breakMergeChain?.('tool-change');
    return result;
  };

  const originalSelectPage = Workspace.prototype.selectPage;
  Workspace.prototype.selectPage = function selectPageWithMergeBoundary(id) {
    const before = this.state.project.activePageId;
    const result = originalSelectPage.call(this, id);
    if (result && this.state.project.activePageId !== before) this.bus?.breakMergeChain?.('page-change');
    return result;
  };

  Workspace.prototype.setSelectionAxis = function setSelectionAxisSemantically(axis, targetValue) {
    const page = this.activePage();
    const tree = new M.TreeModel(page);
    const roots = this.state.selection.transformRoots(tree);
    const targetNumber = Math.round(Number(targetValue));
    if (!roots.length || !Number.isFinite(targetNumber) || !['x', 'y'].includes(axis)) return false;
    return this.exec({
      label: '设置位置',
      mergeDescriptor: { operation: 'property', targets: roots, channel: axis },
      execute: state => {
        const currentPage = M.pageById(state.project, page.id);
        if (!currentPage) return false;
        const currentTree = new M.TreeModel(currentPage);
        let changed = false;
        for (const id of roots) {
          if (currentTree.isEffectivelyLocked(id)) continue;
          const bounds = R.FramebufferRenderer.visualBounds(id, {
            project: state.project,
            pageId: currentPage.id,
            assets: state.assets,
          });
          const delta = Math.round(targetNumber - bounds[axis]);
          if (!delta) continue;
          C.moveNodeTree(currentPage, id, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0, currentTree);
          changed = true;
        }
        return changed;
      },
    });
  };

  Workspace.prototype.setSelectionSize = function setSelectionSizeSemantically(axis, targetValue) {
    const page = this.activePage();
    const ids = this.state.selection.ids.filter(id => ['rectangle', 'circle', 'text', 'image'].includes(M.nodeById(page, id)?.type));
    const size = Math.max(1, Math.round(Number(targetValue)));
    if (!ids.length || !Number.isFinite(size) || !['w', 'h'].includes(axis)) return false;
    return this.exec(new C.UpdateNodesCommand(ids, node => {
      const ratio = node.w / Math.max(1, node.h);
      if (axis === 'w') return node.aspectLocked
        ? { w: size, h: Math.max(1, Math.round(size / ratio)) }
        : { w: size };
      return node.aspectLocked
        ? { h: size, w: Math.max(1, Math.round(size * ratio)) }
        : { h: size };
    }, page.id, '调整尺寸', { historyChannel: axis }));
  };

  PE.commandCoalescing = {
    normalizeMergeDescriptor,
    mergeDescriptorKey,
    resolveMergeDescriptor,
    diffLeafPaths,
    attachSelectionBoundary,
  };
}

export {
  normalizeMergeDescriptor,
  mergeDescriptorKey,
  resolveMergeDescriptor,
  diffLeafPaths,
  installCommandCoalescingRuntime,
};