import { fontOptions, fontRecordForFamily, resolveTextToolSelection } from '../fonts/font-options.js';

const clampSize = value => Math.max(1, Math.min(200, Math.round(Number(value) || 16)));

function saveTextPreferences(editor, patch) {
  const preferences = globalThis.PixelEditor?.preferences;
  editor.editorPreferences = preferences.updateEditorPreferences(editor.editorPreferences, { tools: { text: patch } });
  preferences.saveEditorPreferences(editor.editorPreferences);
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

function labeled(text, control) {
  const label = document.createElement('label');
  label.className = 'tool-option-field';
  const span = document.createElement('span');
  span.textContent = text;
  label.append(span, control);
  return label;
}

function renderTextToolOptions(editor, container) {
  const settings = editor.getToolDefaults('text');
  const resolved = resolveTextToolSelection(settings, editor.state.project, settings.fontFamily);
  const group = document.createElement('div');
  group.className = 'tool-option-group';
  group.append(labeled('字体', optionSelect(editor, resolved)), labeled('字号', sizeInput(editor, resolved)));
  container.replaceChildren(group);
  return resolved;
}

function installTextToolOptionsRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.preferences || !PE?.fontOptions) throw new Error('PixelEditor text tool dependencies are not initialized');
  if (PE.textToolOptionsInstalled) return;
  PE.textToolOptionsInstalled = true;
  PE.textToolOptions = {
    renderTextToolOptions,
    applyTextToolFamily,
    applyTextToolSize,
    fallbackRemovedFamily,
  };
}

export {
  renderTextToolOptions,
  applyTextToolFamily,
  applyTextToolSize,
  fallbackRemovedFamily,
  installTextToolOptionsRuntime,
};
