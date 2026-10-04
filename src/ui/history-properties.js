const TRANSFORM_TYPES = new Set(['rectangle', 'circle', 'line', 'polygon', 'text', 'image', 'raster']);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function transformControlsMarkup(node, locked, transformModel) {
  if (!node || !TRANSFORM_TYPES.has(node.type)) return '';
  const transform = transformModel.normalizeTransform(node.transform);
  const disabled = locked ? ' disabled' : '';
  return `<div class="property-section" id="elementTransformModule">
    <h4>变换</h4>
    <div class="field">
      <label for="propRotation">旋转角度</label>
      <input id="propRotation" type="number" step="1" min="-180" max="180" value="${escapeHtml(transform.rotation)}"${disabled}>
    </div>
    <label class="check"><input id="propFlipX" type="checkbox" ${transform.flipX ? 'checked' : ''}${disabled}> 水平翻转</label>
    <label class="check"><input id="propFlipY" type="checkbox" ${transform.flipY ? 'checked' : ''}${disabled}> 垂直翻转</label>
  </div>`;
}

function installHistoryPropertiesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const HistoryDock = PE?.ui?.HistoryDock;
  const T = PE?.transformModel;
  if (!HistoryDock || !T) throw new Error('PixelEditor history/property dependencies are not initialized');
  if (PE.historyPropertiesInstalled) return;
  PE.historyPropertiesInstalled = true;

  class V17HistoryDock extends HistoryDock {
    render() {
    const bus = this.editor.bus;
    const entries = bus.entries.map((entry, index) => ({ entry, index })).reverse();
    this.el.innerHTML = entries.map(({ entry, index }) =>
      `<button class="history-item ${index === bus.cursor ? 'active' : ''}" data-history-index="${index}">${index ? index : ''} ${this.escape(entry.label)}</button>`
    ).join('');
    this.el.querySelectorAll('[data-history-index]').forEach(button => {
      button.onclick = () => {
        bus.jump(Number(button.dataset.historyIndex));
        this.editor.state.selection.clear();
        this.editor.renderAll();
      };
    });
  }
  }
  PE.ui.HistoryDock = V17HistoryDock;

  PE.historyProperties = {
    TRANSFORM_TYPES,
    transformControlsMarkup: (node, locked = false) => transformControlsMarkup(node, locked, T),
  };
}

export { TRANSFORM_TYPES, transformControlsMarkup, installHistoryPropertiesRuntime };
