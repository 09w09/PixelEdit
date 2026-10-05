import { fontOptions, fontRecordForFamily, resolveTextToolSelection } from '../fonts/font-options.js';
import { updateEditorPreferences, saveEditorPreferences } from '../preferences/editor-preferences.js';

const clampSize = value => Math.max(1, Math.min(200, Math.round(Number(value) || 16)));
const ALIGN_H = new Set(['left', 'center', 'right']);
const ALIGN_V = new Set(['top', 'middle', 'bottom']);

function saveTextPreferences(editor, patch) {
  editor.editorPreferences = updateEditorPreferences(editor.editorPreferences, { tools: { text: patch } });
  saveEditorPreferences(editor.editorPreferences);
  editor.toolOptionsBar?.render?.();
  return editor.getToolDefaults('text');
}

function applyTextToolFamily(editor, family) {
  const current = editor.getToolDefaults('text');
  const currentRecord = fontRecordForFamily(editor.state.project, current.fontFamily);
  const lastScalableFontSize = currentRecord?.fixedSize ? current.lastScalableFontSize : current.fontSize;
  const requested = resolveTextToolSelection({ ...current, lastScalableFontSize }, editor.state.project, family);
  return saveTextPreferences(editor, {
    fontFamily: requested.fontFamily,
    fontSize: requested.fixed ? requested.fixedSize : clampSize(lastScalableFontSize),
    lastScalableFontSize: clampSize(lastScalableFontSize),
  });
}

function applyTextToolSize(editor, value) {
  const current = editor.getToolDefaults('text');
  if (fontRecordForFamily(editor.state.project, current.fontFamily)?.fixedSize) return current;
  const size = clampSize(value);
  return saveTextPreferences(editor, { fontSize: size, lastScalableFontSize: size });
}

function applyTextToolAlignment(editor, key, value) {
  if (key === 'alignH') return saveTextPreferences(editor, { alignH: ALIGN_H.has(value) ? value : 'left' });
  if (key === 'alignV') return saveTextPreferences(editor, { alignV: ALIGN_V.has(value) ? value : 'top' });
  return editor.getToolDefaults('text');
}

function fallbackRemovedFamily(editor, family) {
  const current = editor.getToolDefaults('text');
  if (current.fontFamily !== family) return false;
  const size = clampSize(current.lastScalableFontSize ?? current.fontSize ?? 16);
  saveTextPreferences(editor, { fontFamily: 'sans-serif', fontSize: size, lastScalableFontSize: size });
  return true;
}

function optionSelect(editor, resolved) {
  const select = document.createElement('select');
  select.id = 'toolOptionFont';
  select.setAttribute('aria-label', '字体');
  for (const option of fontOptions(editor.state.project)) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  }
  select.value = resolved.fontFamily;
  select.addEventListener('change', () => applyTextToolFamily(editor, select.value));
  return select;
}

function sizeInput(editor, resolved) {
  const input = document.createElement('input');
  input.id = 'toolOptionFontSize';
  input.type = 'number';
  input.min = '1';
  input.max = '200';
  input.step = '1';
  input.value = String(resolved.fontSize);
  input.disabled = resolved.fixed;
  input.setAttribute('aria-label', '字号');
  input.addEventListener('change', () => applyTextToolSize(editor, input.value));
  return input;
}

function selectInput(id, options, value, ariaLabel, onChange) {
  const select = document.createElement('select');
  select.id = id;
  select.setAttribute('aria-label', ariaLabel);
  for (const [optionValue, label] of options) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function labeled(text, control) {
  const label = document.createElement('label');
  label.className = 'tool-option-field';
  const span = document.createElement('span');
  span.textContent = text;
  label.append(span, control);
  return label;
}

function actionButton(id, label, onClick, { danger = false } = {}) {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.textContent = label;
  if (danger) button.classList.add('danger');
  button.addEventListener('click', onClick);
  return button;
}

function fontActionGroup(editor, resolved) {
  const group = document.createElement('div');
  group.className = 'tool-option-group font-actions';
  const importButton = actionButton('importFontBtn', '导入字体', () => {
    document.querySelector('#fileFont')?.click();
  });
  group.appendChild(importButton);

  const record = fontRecordForFamily(editor.state.project, resolved.fontFamily);
  if (record) {
    const removeButton = actionButton('removeFontBtn', '移除当前字体', () => {
      editor.removeImportedFont?.(resolved.fontFamily);
    }, { danger: true });
    group.appendChild(removeButton);
  }
  return group;
}

function renderTextToolOptions(editor, container) {
  const settings = editor.getToolDefaults('text');
  const resolved = resolveTextToolSelection(settings, editor.state.project, settings.fontFamily);
  const fields = document.createElement('div');
  fields.className = 'tool-option-group';
  fields.append(labeled('字体', optionSelect(editor, resolved)), labeled('字号', sizeInput(editor, resolved)));

  const alignment = document.createElement('div');
  alignment.className = 'tool-option-group';
  const alignH = selectInput(
    'toolOptionAlignH',
    [['left', '左'], ['center', '居中'], ['right', '右']],
    ALIGN_H.has(settings.alignH) ? settings.alignH : 'left',
    '水平对齐',
    value => applyTextToolAlignment(editor, 'alignH', value),
  );
  const alignV = selectInput(
    'toolOptionAlignV',
    [['top', '上'], ['middle', '居中'], ['bottom', '下']],
    ALIGN_V.has(settings.alignV) ? settings.alignV : 'top',
    '垂直对齐',
    value => applyTextToolAlignment(editor, 'alignV', value),
  );
  alignment.append(labeled('水平', alignH), labeled('垂直', alignV));

  container.replaceChildren(fields, alignment, fontActionGroup(editor, resolved));
  return resolved;
}

export {
  renderTextToolOptions,
  applyTextToolFamily,
  applyTextToolSize,
  applyTextToolAlignment,
  fallbackRemovedFamily,
};
