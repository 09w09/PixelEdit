function selectedPayloadArgs(input, pageId, selection, assets) {
  if (input?.project) return input;
  return { project: input, pageId, selection, assets };
}

function collectSubtreeIds(page, roots, Model) {
  const tree = new Model.TreeModel(page);
  const ids = new Set();
  const visit = id => {
    if (ids.has(id)) return;
    const node = tree.node(id);
    if (!node) return;
    ids.add(id);
    for (const child of tree.childrenOf(id)) visit(child.id);
  };
  for (const id of roots) visit(id);
  return ids;
}

function createClipboardPayload({ project, pageId, selection, assets }, Model) {
  const page = Model.pageById(project, pageId || project.activePageId);
  if (!page || !selection) return null;
  const tree = new Model.TreeModel(page);
  const roots = selection.transformRoots(tree);
  if (!roots.length) return null;
  const ids = collectSubtreeIds(page, roots, Model);
  const nodes = page.nodes.filter(node => ids.has(node.id)).map(node => structuredClone(node));

  const fontFamilies = new Set(nodes.filter(node => node.type === 'text').map(node => node.fontFamily));
  const fontRecords = (project.fonts || []).filter(font => fontFamilies.has(font.family)).map(font => structuredClone(font));
  const assetIds = new Set(nodes.map(node => node.assetId).filter(Boolean));
  for (const font of fontRecords) if (font.assetId) assetIds.add(font.assetId);
  const assetRecords = assets?.referenced ? assets.referenced(assetIds) : [];
  const runtimeRecords = [];
  for (const id of assetIds) {
    const runtime = assets?.getRuntime?.(id);
    if (runtime) runtimeRecords.push({ id, runtime: structuredClone(runtime) });
  }

  return {
    version: 16,
    sourcePageId: page.id,
    roots: [...roots],
    nodes,
    assetRecords,
    runtimeRecords,
    fontRecords,
  };
}

function restoreClipboardResources(payload, { assets, project } = {}) {
  if (assets) {
    for (const record of payload.assetRecords || []) if (!assets.has(record.id)) assets.set(record);
    for (const entry of payload.runtimeRecords || []) if (!assets.getRuntime(entry.id)) assets.setRuntime(entry.id, structuredClone(entry.runtime));
  }
  if (project) {
    project.fonts ||= [];
    for (const font of payload.fontRecords || []) {
      if (!project.fonts.some(existing => existing.family === font.family)) project.fonts.push(structuredClone(font));
    }
  }
}

function cloneClipboardPayload(payload, targetPage, { offsetIndex = 0, assets = null, project = null, Model, TransformModel } = {}) {
  if (!payload?.nodes?.length || !targetPage || !Model) return { nodes: [], rootIds: [], idMap: new Map() };
  restoreClipboardResources(payload, { assets, project });
  const idMap = new Map(payload.nodes.map(node => [node.id, Model.nextId(node.type)]));
  const delta = 8 * Math.max(0, Math.round(Number(offsetIndex) || 0));
  const nodes = payload.nodes.map(source => {
    const node = structuredClone(source);
    node.id = idMap.get(source.id);
    node.parentId = idMap.has(source.parentId) ? idMap.get(source.parentId) : targetPage.id;
    if (delta) TransformModel?.moveNodeGeometry?.(node, delta, delta);
    return node;
  });
  return {
    nodes,
    rootIds: payload.roots.map(id => idMap.get(id)).filter(Boolean),
    idMap,
  };
}

class ElementClipboard {
  constructor(Model, TransformModel) {
    this.Model = Model;
    this.TransformModel = TransformModel;
    this.payload = null;
    this.pasteIndex = 0;
  }

  copy(input, pageId, selection, assets) {
    const args = selectedPayloadArgs(input, pageId, selection, assets);
    this.payload = createClipboardPayload(args, this.Model);
    this.pasteIndex = 0;
    return this.payload ? structuredClone(this.payload) : null;
  }

  clear() {
    this.payload = null;
    this.pasteIndex = 0;
  }

  hasPayload() { return Boolean(this.payload?.nodes?.length); }

  nextPaste() {
    if (!this.hasPayload()) return null;
    const offsetIndex = this.pasteIndex;
    this.pasteIndex += 1;
    return { payload: structuredClone(this.payload), offsetIndex };
  }
}

function selectAllOnPage(page, selection) {
  if (!page || !selection) return false;
  selection.replace(page.nodes.map(node => node.id));
  return page.nodes.length > 0;
}

function installElementClipboardRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const I = PE?.interaction;
  const Workspace = PE?.ui?.Workspace;
  const T = PE?.transformModel;
  if (!M || !C || !I || !Workspace || !T) throw new Error('PixelEditor clipboard dependencies are not initialized');
  if (PE.elementClipboardInstalled) return;
  PE.elementClipboardInstalled = true;

  class RuntimeElementClipboard extends ElementClipboard {
    constructor() { super(M, T); }
  }
  I.Clipboard = RuntimeElementClipboard;
  PE.ElementClipboard = RuntimeElementClipboard;

  class PasteCommand {
    constructor(payload, offsetIndex = 0, pageId = null) {
      this.payload = structuredClone(payload);
      this.offsetIndex = offsetIndex;
      this.pageId = pageId;
      this.label = '粘贴';
      this.createdIds = [];
    }
    execute(state) {
      const page = M.pageById(state.project, this.pageId || state.project.activePageId);
      if (!page || page.locked || !this.payload?.nodes?.length) return false;
      const cloned = cloneClipboardPayload(this.payload, page, {
        offsetIndex: this.offsetIndex,
        assets: state.assets,
        project: state.project,
        Model: M,
        TransformModel: T,
      });
      if (!cloned.nodes.length) return false;
      page.nodes.push(...cloned.nodes);
      new M.TreeModel(page).validateHierarchy();
      state.selection?.replace(cloned.rootIds);
      this.createdIds = cloned.nodes.map(node => node.id);
      return true;
    }
  }

  class AltDragDuplicateCommand {
    constructor(ids, dx, dy, pageId = null) {
      this.ids = [...ids];
      this.dx = Number(dx) || 0;
      this.dy = Number(dy) || 0;
      this.pageId = pageId;
      this.label = '复制并移动';
      this.createdIds = [];
    }
    execute(state) {
      const page = M.pageById(state.project, this.pageId || state.project.activePageId);
      if (!page || page.locked) return false;
      const selection = new M.SelectionSet(this.ids);
      const payload = createClipboardPayload({ project: state.project, pageId: page.id, selection, assets: state.assets }, M);
      if (!payload) return false;
      const cloned = cloneClipboardPayload(payload, page, {
        offsetIndex: 0,
        assets: state.assets,
        project: state.project,
        Model: M,
        TransformModel: T,
      });
      for (const node of cloned.nodes) T.moveNodeGeometry(node, this.dx, this.dy);
      page.nodes.push(...cloned.nodes);
      new M.TreeModel(page).validateHierarchy();
      state.selection?.replace(cloned.rootIds);
      this.createdIds = cloned.nodes.map(node => node.id);
      return true;
    }
  }

  C.PasteCommand = PasteCommand;
  C.AltDragDuplicateCommand = AltDragDuplicateCommand;
  C.cloneClipboardPayload = (payload, page, offsetIndex = 0) => cloneClipboardPayload(payload, page, {
    offsetIndex,
    Model: M,
    TransformModel: T,
  });
  C.payloadFromIds = (project, page, ids, assets = null) => createClipboardPayload({
    project,
    pageId: page.id,
    selection: new M.SelectionSet(ids),
    assets,
  }, M);

  PE.workspaceCapabilities = PE.workspaceCapabilities || {};
  PE.workspaceCapabilities.copySelection = function copySelection(editor) {
    if (!editor.state.selection.ids.length) return null;
    return editor.clipboard.copy({
      project: editor.state.project,
      pageId: editor.activePage().id,
      selection: editor.state.selection,
      assets: editor.state.assets,
    });
  };

  PE.workspaceCapabilities = PE.workspaceCapabilities || {};
  PE.workspaceCapabilities.pasteClipboard = function pasteClipboard(editor) {
    const next = editor.clipboard.nextPaste();
    if (!next) return false;
    return editor.exec(new PasteCommand(next.payload, next.offsetIndex, editor.activePage().id));
  };

  PE.workspaceCapabilities = PE.workspaceCapabilities || {};
  PE.workspaceCapabilities.selectAllOnPage = function selectAllOnPage(editor) {
    const changed = selectAllOnPage(editor.activePage(), editor.state.selection);
    editor.pageSelectedId = null;
    editor.renderAll({ canvas: false, history: false });
    return changed;
  };

  PE.elementClipboard = {
    ElementClipboard: RuntimeElementClipboard,
    createClipboardPayload: args => createClipboardPayload(args, M),
    cloneClipboardPayload: (payload, targetPage, options = {}) => cloneClipboardPayload(payload, targetPage, {
      ...options,
      Model: M,
      TransformModel: T,
    }),
    restoreClipboardResources,
    selectAllOnPage,
  };
}

export {
  ElementClipboard,
  createClipboardPayload,
  cloneClipboardPayload,
  restoreClipboardResources,
  selectAllOnPage,
  installElementClipboardRuntime,
};
