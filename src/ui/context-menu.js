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
    { id: 'save-image', label: '图层另存为 PNG', visible: Boolean(one), enabled: Boolean(one), run: () => editor.saveSelectedImage() },
    { id: 'copy-image', label: '复制图片', visible: one?.type === 'image', enabled: one?.type === 'image', run: () => editor.copySelectedImage() },
  ];
}

function visibleCommands(editor, Model, Commands) {
  return commandDefinitions(editor, Model, Commands).filter(command => command.visible !== false);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function createContextMenuService({ model: M, commands: C, interaction: I, target = globalThis } = {}) {
  if (!M || !C || !I?.HitTest) throw new Error('PixelEditor context-menu dependencies are not initialized');

  const contextCommands = editor => visibleCommands(editor, M, C);
  const executeContextCommand = (editor, id, value) => {
    const command = contextCommands(editor).find(item => item.id === id);
    if (!command || !command.enabled) return false;
    return command.run(value);
  };
  const renderContextMenu = editor => {
    const menu = target.document?.querySelector?.('#contextMenu');
    if (!menu) return;
    menu.innerHTML = contextCommands(editor).map(command => (
      `<button type="button" data-context-command="${escapeHtml(command.id)}" ${command.enabled ? '' : 'disabled'} class="${command.danger ? 'danger' : ''}">${escapeHtml(command.label)}</button>`
    )).join('');
  };
  const openContextMenu = (editor, { source = 'canvas', nodeId = null, event = null, clientX = null, clientY = null } = {}) => {
    if (nodeId && !editor.state.selection.has(nodeId)) editor.state.selection.replace([nodeId]);
    if (nodeId) editor.pageSelectedId = null;
    editor.renderAll({ canvas: false, history: false });
    const menu = target.document?.querySelector?.('#contextMenu');
    if (!menu) return false;
    renderContextMenu(editor);
    menu.dataset.source = source;
    menu.dataset.nodeId = nodeId || '';
    menu.style.left = `${clientX ?? event?.clientX ?? 0}px`;
    menu.style.top = `${clientY ?? event?.clientY ?? 0}px`;
    menu.classList.add('open');
    return true;
  };
  const closeContextMenu = () => target.document?.querySelector?.('#contextMenu')?.classList.remove('open');
  const onContextMenu = (editor, event) => {
    const point = editor.logicalPoint(event);
    const hit = new I.HitTest(editor.state.project, editor.activePage().id, editor.state.assets).topmostAt(point.x, point.y, { ignoreLocked: false });
    return openContextMenu(editor, { source: 'canvas', nodeId: hit?.id || null, event });
  };
  const setupContextMenu = editor => {
    target.document?.addEventListener?.('pointerdown', event => {
      if (!event.target.closest('#contextMenu') && event.button !== 2) closeContextMenu();
    });
    target.document?.querySelector?.('#contextMenu')?.addEventListener('click', event => {
      const button = event.target.closest('[data-context-command]');
      if (!button || button.disabled) return;
      const id = button.dataset.contextCommand;
      closeContextMenu();
      const result = executeContextCommand(editor, id);
      if (result && typeof result.then === 'function') result.catch(error => editor.notice?.(String(error?.message || error)));
    });
  };
  return Object.freeze({
    commandDefinitions: editor => commandDefinitions(editor, M, C),
    visibleCommands: editor => visibleCommands(editor, M, C),
    contextCommands,
    executeContextCommand,
    renderContextMenu,
    openContextMenu,
    closeContextMenu,
    onContextMenu,
    setupContextMenu,
  });
}

export { commandDefinitions, visibleCommands, createContextMenuService };
