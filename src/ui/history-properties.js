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
  const C = PE?.commands;
  const HistoryDock = PE?.ui?.HistoryDock;
  const Properties = PE?.ui?.Properties;
  const T = PE?.transformModel;
  if (!C || !HistoryDock || !Properties || !T) throw new Error('PixelEditor history/property dependencies are not initialized');
  if (PE.historyPropertiesInstalled) return;
  PE.historyPropertiesInstalled = true;

  HistoryDock.prototype.render = function renderNewestHistoryFirst() {
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
  };

  const originalTransform = Properties.prototype.transform;
  Properties.prototype.transform = function transformWithOrientation(nodes, locked) {
    const base = originalTransform.call(this, nodes, locked);
    if (nodes.length !== 1 || !TRANSFORM_TYPES.has(nodes[0]?.type)) return base;
    return base + transformControlsMarkup(nodes[0], locked, T);
  };

  const originalBind = Properties.prototype.bind;
  Properties.prototype.bind = function bindElementTransform(nodes, locked) {
    originalBind.call(this, nodes, locked);
    if (locked || nodes.length !== 1 || !TRANSFORM_TYPES.has(nodes[0]?.type)) return;

    const node = nodes[0];
    const page = this.editor.activePage();
    const updateTransform = (patch, label, channel) => this.editor.exec(new C.UpdateNodesCommand(
      [node.id],
      current => ({ transform: T.normalizeTransform({ ...current.transform, ...patch }) }),
      page.id,
      label,
      { historyChannel: channel },
    ));

    const rotation = this.el.querySelector('#propRotation');
    const flipX = this.el.querySelector('#propFlipX');
    const flipY = this.el.querySelector('#propFlipY');

    if (rotation) rotation.onchange = () => {
      const value = Number(rotation.value);
      if (!Number.isFinite(value)) return;
      updateTransform({ rotation: T.normalizeRotation(value) }, '旋转元素', 'transform.rotation');
    };
    if (flipX) flipX.onchange = () => updateTransform({ flipX: flipX.checked }, '水平翻转元素', 'transform.flipX');
    if (flipY) flipY.onchange = () => updateTransform({ flipY: flipY.checked }, '垂直翻转元素', 'transform.flipY');
  };

  PE.historyProperties = {
    TRANSFORM_TYPES,
    transformControlsMarkup: (node, locked = false) => transformControlsMarkup(node, locked, T),
  };
}

export { TRANSFORM_TYPES, transformControlsMarkup, installHistoryPropertiesRuntime };