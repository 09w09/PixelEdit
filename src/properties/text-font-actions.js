import { fontRecordForFamily } from '../fonts/font-options.js';

function renderTextFontActions(properties, nodes, locked) {
  const family = nodes?.[0]?.fontFamily;
  const imported = Boolean(family && nodes.every(node => node.fontFamily === family) && fontRecordForFamily(properties.editor.state.project, family));
  return `<div class="font-actions"><button id="importFontBtn" type="button" ${locked ? 'disabled' : ''}>导入字体</button>${imported ? `<button id="removeFontBtn" type="button" class="danger" ${locked ? 'disabled' : ''}>移除当前字体</button>` : ''}</div>`;
}

function installTextFontActionsRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Properties = PE?.ui?.Properties;
  if (!Properties || !PE?.fontOptions) throw new Error('PixelEditor text font action dependencies are not initialized');
  if (PE.textFontActionsInstalled) return;
  PE.textFontActionsInstalled = true;

  if (!target.document?.querySelector('#pixeleditFontActionStyles')) {
    const style = target.document?.createElement('style');
    if (style) {
      style.id = 'pixeleditFontActionStyles';
      style.textContent = '.font-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 8px}';
      target.document.head.appendChild(style);
    }
  }

  const originalTypeFields = Properties.prototype.typeFields;
  Properties.prototype.typeFields = function typeFieldsWithFontActions(nodes, locked) {
    let html = originalTypeFields.call(this, nodes, locked);
    if (nodes?.[0]?.type !== 'text') return html;
    const actions = renderTextFontActions(this, nodes, locked);
    return html.replace(/<button id="importFontBtn" type="button"[^>]*>[^<]*<\/button>/, actions);
  };

  PE.textFontActions = { renderTextFontActions };
}

export { renderTextFontActions, installTextFontActionsRuntime };
