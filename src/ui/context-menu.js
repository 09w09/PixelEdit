function selectionNodes(editor, Model) {
  const page = editor.activePage();
  return editor.state.selection.ids.map(id => Model.nodeById(page, id)).filter(Boolean);
}

function hasModifiableSelection(editor, Model) {
  const page = editor.activePage();
  const tree = new Model.TreeModel(page);
  return editor.state.selection.ids.some(id => Model.nodeById(page, id) && !tree.isEffectivelyLocked(id));
}

function commandDefinitions(editor, Model, Commands) {
  const nodes = selectionNodes(editor, Model);
  const one = nodes.length === 1 ? nodes[0] : null;
  const selected = nodes.length > 0;
  const modifiable = hasModifiableSelection(editor, Model);
  return [
    { id: 'copy', label: '复制', enabled: selected, run: () => Boolean(editor.copySelection()) },
    { id: 'paste', label: '粘贴', enabled: editor.clipboard?.hasPayload?.() === true, run: () => editor.pasteClipboard() },
    { id: 'delete', label: '删除', enabled: modifiable, danger: true, run: () => editor.exec(new Commands.DeleteNodesCommand(editor.state.selection.ids, editor.activePage().id)) },
    { id: 'flip-horizontal', label: '水平翻转', enabled: modifiable, run: () => editor.runSelectionTransform('flip-horizontal') },
    { id: 'flip-vertical', label: '垂直翻转', enabled: modifiable, run: () => editor.runSelectionTransform('flip-vertical') },
    { id: 'rotate-cw-90', label: '顺时针 90°', enabled: modifiable, run: () => editor.runSelectionTransform('rotate-cw-90') },
    { id: 'rotate-ccw-90', label: '逆时针 90°', enabled: modifiable, run: () => editor.runSelectionTransform('rotate-ccw-90') },
    {
      id: 'rotate-angle', label: '旋转角度…', enabled: modifiable,
      run: value => {
        let angle = value;
        if (angle == null && typeof prompt === 'function') angle = prompt('旋转角度（°）', '0');
        if (angle == null || String(angle).trim() === '') return false;
        return editor.runSelectionTransform('rotate-angle', Number(angle));
      },
    },
    { id: 'rasterize', label: '栅格化', enabled: Boolean(one) && modifiable, run: () => editor.rasterizeSelected() },
    { id: 'save-image', label: '图片另存为', visible: one?.type === 'image', enabled: one?.type === 'image', run: () => editor.saveSelectedImage() },
    { id: 'copy-image', label: '复制图片', visible: one?.type === 'image', enabled: one?.type === 'image', run: () => editor.copySelectedImage() },
  ];
}

function visibleCommands(editor, Model, Commands) {
  return commandDefinitions(editor, Model, Commands).filter(command => command.visible !== false);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function installContextMenuRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const I = PE?.interaction;
  const Workspace = PE?.ui?.Workspace;
  const PageDock = PE?.ui?.PageDock;
  if (!M || !C || !I || !Workspace || !PageDock) throw new Error('PixelEditor context-menu dependencies are not initialized');
  if (PE.contextMenuInstalled) return;
  PE.contextMenuInstalled = true;

  Workspace.prototype.contextCommands = function contextCommands() {
    return visibleCommands(this, M, C);
  };

  Workspace.prototype.executeContextCommand = function executeContextCommand(id, value) {
    const command = this.contextCommands().find(item => item.id === id);
    if (!command || !command.enabled) return false;
    return command.run(value);
  };

  Workspace.prototype.renderContextMenu = function renderContextMenu() {
    const menu = document.querySelector('#contextMenu');
    if (!menu) return;
    menu.innerHTML = this.contextCommands().map(command => (
      `<button type="button" data-context-command="${escapeHtml(command.id)}" ${command.enabled ? '' : 'disabled'} class="${command.danger ? 'danger' : ''}">${escapeHtml(command.label)}</button>`
    )).join('');
  };

  Workspace.prototype.openContextMenu = function openContextMenu({ source = 'canvas', nodeId = null, event = null, clientX = null, clientY = null } = {}) {
    if (nodeId && !this.state.selection.has(nodeId)) this.state.selection.replace([nodeId]);
    if (nodeId) this.pageSelectedId = null;
    this.renderAll({ canvas: false, history: false });
    const menu = document.querySelector('#contextMenu');
    if (!menu) return false;
    this.renderContextMenu();
    menu.dataset.source = source;
    menu.dataset.nodeId = nodeId || '';
    const x = clientX ?? event?.clientX ?? 0;
    const y = clientY ?? event?.clientY ?? 0;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.add('open');
    return true;
  };

  Workspace.prototype.closeContextMenu = function closeContextMenu() {
    document.querySelector('#contextMenu')?.classList.remove('open');
  };

  Workspace.prototype.onContextMenu = function sharedCanvasContextMenu(event) {
    const point = this.logicalPoint(event);
    const hit = new I.HitTest(this.state.project, this.activePage().id, this.state.assets).topmostAt(point.x, point.y, { ignoreLocked: false });
    return this.openContextMenu({ source: 'canvas', nodeId: hit?.id || null, event });
  };

  Workspace.prototype.setupContextMenu = function setupSharedContextMenu() {
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#contextMenu') && event.button !== 2) this.closeContextMenu();
    });
    document.querySelector('#contextMenu')?.addEventListener('click', event => {
      const button = event.target.closest('[data-context-command]');
      if (!button || button.disabled) return;
      const id = button.dataset.contextCommand;
      this.closeContextMenu();
      const result = this.executeContextCommand(id);
      if (result && typeof result.then === 'function') result.catch(error => this.notice?.(String(error?.message || error)));
    });
  };


  PE.contextMenu = {
    commandDefinitions: editor => commandDefinitions(editor, M, C),
    visibleCommands: editor => visibleCommands(editor, M, C),
  };
}

export { commandDefinitions, visibleCommands, installContextMenuRuntime };
