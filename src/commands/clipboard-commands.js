import {
  createClipboardPayload,
  cloneClipboardPayload,
  selectAllOnPage as selectAllElementsOnPage,
} from '../clipboard/element-clipboard.js';

const PE = globalThis.PixelEditor;
const M = PE.model;
const C = PE.commands;

function payloadFromIds(project, page, ids, assets = null) {
  return createClipboardPayload({
    project,
    pageId: page.id,
    selection: new M.SelectionSet(ids),
    assets,
  }, M);
}

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
      TransformModel: PE.transformModel,
    });
    if (!cloned.nodes.length) return false;
    page.nodes.push(...cloned.nodes);
    new M.TreeModel(page).validateHierarchy();
    state.selection?.replace(cloned.rootIds);
    this.createdIds = cloned.nodes.map(node => node.id);
    return true;
  }
}

class DuplicateCommand {
  constructor(ids, pageId = null) {
    this.ids = [...ids];
    this.pageId = pageId;
    this.label = '复制图层';
    this.createdIds = [];
  }

  execute(state) {
    const page = M.pageById(state.project, this.pageId || state.project.activePageId);
    if (!page || page.locked) return false;
    const payload = payloadFromIds(state.project, page, this.ids, state.assets);
    if (!payload) return false;
    const command = new PasteCommand(payload, 1, page.id);
    const changed = command.execute(state);
    this.createdIds = command.createdIds;
    return changed;
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
    const payload = payloadFromIds(state.project, page, this.ids, state.assets);
    if (!payload) return false;
    const cloned = cloneClipboardPayload(payload, page, {
      offsetIndex: 0,
      assets: state.assets,
      project: state.project,
      Model: M,
      TransformModel: PE.transformModel,
    });
    for (const node of cloned.nodes) PE.transformModel?.moveNodeGeometry?.(node, this.dx, this.dy);
    page.nodes.push(...cloned.nodes);
    new M.TreeModel(page).validateHierarchy();
    state.selection?.replace(cloned.rootIds);
    this.createdIds = cloned.nodes.map(node => node.id);
    return true;
  }
}

function copySelection(editor) {
  if (!editor.state.selection.ids.length) return null;
  return editor.clipboard.copy({
    project: editor.state.project,
    pageId: editor.activePage().id,
    selection: editor.state.selection,
    assets: editor.state.assets,
  });
}

function pasteClipboard(editor) {
  const next = editor.clipboard.nextPaste();
  if (!next) return false;
  return editor.exec(new PasteCommand(next.payload, next.offsetIndex, editor.activePage().id));
}

function selectAllOnPage(editor) {
  const changed = selectAllElementsOnPage(editor.activePage(), editor.state.selection);
  editor.pageSelectedId = null;
  editor.renderAll({ canvas: false, history: false });
  return changed;
}

Object.assign(C, {
  PasteCommand,
  DuplicateCommand,
  AltDragDuplicateCommand,
  cloneClipboardPayload: (payload, page, offsetIndex = 0) => cloneClipboardPayload(payload, page, {
    offsetIndex,
    Model: M,
    TransformModel: PE.transformModel,
  }),
  payloadFromIds,
});

export {
  PasteCommand,
  DuplicateCommand,
  AltDragDuplicateCommand,
  payloadFromIds,
  copySelection,
  pasteClipboard,
  selectAllOnPage,
};
