const CLIPBOARD_FORMAT_VERSION = 1;

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

function createClipboardPayload({ project, pageId, selection, assets }, Model = globalThis.PixelEditor?.model) {
  const page = Model?.pageById(project, pageId || project.activePageId);
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
    formatVersion: CLIPBOARD_FORMAT_VERSION,
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

function cloneClipboardPayload(payload, targetPage, {
  offsetIndex = 0,
  assets = null,
  project = null,
  Model = globalThis.PixelEditor?.model,
  TransformModel = globalThis.PixelEditor?.transformModel,
} = {}) {
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
  constructor(Model = globalThis.PixelEditor?.model, TransformModel = globalThis.PixelEditor?.transformModel) {
    if (!Model) throw new Error('ElementClipboard requires the model API');
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

const PE = globalThis.PixelEditor;
if (PE?.interaction) Object.assign(PE.interaction, { Clipboard: ElementClipboard });
if (PE) {
  PE.ElementClipboard = ElementClipboard;
  PE.elementClipboard = {
    CLIPBOARD_FORMAT_VERSION,
    ElementClipboard,
    createClipboardPayload,
    cloneClipboardPayload,
    restoreClipboardResources,
    selectAllOnPage,
  };
}

export {
  CLIPBOARD_FORMAT_VERSION,
  ElementClipboard,
  createClipboardPayload,
  cloneClipboardPayload,
  restoreClipboardResources,
  selectAllOnPage,
};
