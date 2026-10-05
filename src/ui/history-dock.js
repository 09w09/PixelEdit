const U = globalThis.PixelEditor.ui;

class HistoryDock {
  constructor(editor, el) {
    this.editor = editor;
    this.el = el;
  }

  render() {
    const bus = this.editor.bus;
    const entries = bus.entries.map((entry, index) => ({ entry, index })).reverse();
    this.el.innerHTML = entries.map(({ entry, index }) =>
      `<button class="history-item ${index === bus.cursor ? 'active' : ''}" data-history-index="${index}">${index ? index : ''} ${this.escape(entry.label)}</button>`,
    ).join('');
    this.el.querySelectorAll('[data-history-index]').forEach(button => {
      button.onclick = () => {
        bus.jump(Number(button.dataset.historyIndex));
        this.editor.state.selection.clear();
        this.editor.renderAll();
      };
    });
  }

  escape(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }
}

U.HistoryDock = HistoryDock;

export { HistoryDock };
