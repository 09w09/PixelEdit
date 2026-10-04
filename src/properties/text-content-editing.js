function installTextContentEditingRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const C = PE?.commands;
  const M = PE?.model;
  const Properties = PE?.ui?.Properties;
  if (!C?.UpdateNodesCommand || !M?.nodeById || !Properties) {
    throw new Error('PixelEditor text content editing dependencies are not initialized');
  }
  if (PE.textContentEditingInstalled) return;
  PE.textContentEditingInstalled = true;

  const originalBindText = Properties.prototype.bindText;
  Properties.prototype.bindText = function bindContinuousText(nodes) {
    const text = this.el.querySelector('#propText');
    if (!text) return originalBindText.call(this, nodes);

    // Reuse every existing text-property binding except the old textarea handler.
    // The old handler calls editor.exec(), which rebuilds this panel and destroys
    // the active textarea/caret after every IME composition commit.
    text.id = 'propTextContinuousBinding';
    try {
      originalBindText.call(this, nodes);
    } finally {
      text.id = 'propText';
    }

    const editor = this.editor;
    const pageId = editor.activePage().id;
    const ids = nodes.map(node => node.id);
    let composing = false;

    const currentText = () => {
      const page = editor.activePage();
      return ids.map(id => M.nodeById(page, id)?.text ?? '');
    };

    const commit = value => {
      if (currentText().every(existing => existing === value)) return false;
      const command = new C.UpdateNodesCommand(
        ids,
        { text: value },
        pageId,
        '文字',
        { historyChannel: 'text' },
      );
      const changed = editor.bus.execute(command);
      if (changed) editor.renderAll({ properties: false, layers: false });
      return changed;
    };

    text.addEventListener('focus', () => {
      editor.bus.breakMergeChain?.('text-edit-start');
    });
    text.addEventListener('compositionstart', () => {
      composing = true;
    });
    text.addEventListener('input', event => {
      if (!composing && !event.isComposing) commit(event.target.value);
    });
    text.addEventListener('compositionend', event => {
      composing = false;
      commit(event.target.value);
    });
    text.addEventListener('blur', event => {
      if (!composing) commit(event.target.value);
      editor.bus.breakMergeChain?.('text-edit-end');
    });
  };

  PE.textContentEditing = { installed: true };
}

export { installTextContentEditingRuntime };
