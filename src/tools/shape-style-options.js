const SHAPE_TOOLS = new Set(['line', 'rectangle', 'circle', 'polygon']);
const CLOSED_SHAPE_TOOLS = new Set(['rectangle', 'circle', 'polygon']);
const STROKE_STYLES = [
  ['solid', '实线'],
  ['short-dash', '短虚线'],
  ['long-dash', '长虚线'],
  ['dot', '点线'],
  ['dash-dot', '点划线'],
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function numberInput(id, value, min = 1, max = 100) {
  const input = document.createElement('input');
  input.id = id;
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  return input;
}

function selectInput(id, options, value) {
  const select = document.createElement('select');
  select.id = id;
  for (const [optionValue, label] of options) {
    const option = document.createElement('option');
    option.value = String(optionValue);
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = String(value);
  return select;
}

function fieldLabel(text, control) {
  const label = document.createElement('label');
  label.className = 'tool-option-field';
  const span = document.createElement('span');
  span.textContent = text;
  label.append(span, control);
  return label;
}

function group(...children) {
  const element = document.createElement('div');
  element.className = 'tool-option-group';
  element.append(...children);
  return element;
}

function normalizedFill(editor, value) {
  const normalize = globalThis.PixelEditor?.schemaV17?.normalizeFill;
  if (typeof normalize === 'function') return normalize(value);
  return {
    mode: value?.mode === 'solid' ? 'solid' : 'transparent',
    color: Number(value?.color) === 0 ? 0 : 1,
  };
}

function renderShapeToolOptions(editor, container, tool) {
  if (!container || !SHAPE_TOOLS.has(tool)) return false;
  const settings = editor.getToolDefaults(tool);
  const controls = [];

  const width = numberInput('toolOptionWidth', settings.width ?? 1, 1, 100);
  width.addEventListener('change', () => editor.setToolDefault(
    tool,
    'width',
    clamp(Math.round(Number(width.value) || 1), 1, 100),
  ));
  controls.push(fieldLabel('线宽', width));

  const color = selectInput('toolOptionColor', [[1, '黑'], [0, '白']], settings.color ?? 1);
  color.addEventListener('change', () => editor.setToolDefault(tool, 'color', Number(color.value) === 0 ? 0 : 1));
  controls.push(fieldLabel('颜色', color));

  const style = selectInput('toolOptionStyle', STROKE_STYLES, settings.style || 'solid');
  style.addEventListener('change', () => editor.setToolDefault(tool, 'style', style.value));
  controls.push(fieldLabel('样式', style));

  if (CLOSED_SHAPE_TOOLS.has(tool)) {
    const fill = normalizedFill(editor, settings.fill);
    const mode = selectInput('toolOptionFillMode', [['transparent', '透明'], ['solid', '纯色']], fill.mode);
    const fillColor = selectInput('toolOptionFillColor', [[1, '黑'], [0, '白']], fill.color);
    fillColor.disabled = fill.mode !== 'solid';

    mode.addEventListener('change', () => {
      const current = normalizedFill(editor, editor.getToolDefaults(tool).fill);
      editor.setToolDefault(tool, 'fill', { ...current, mode: mode.value === 'solid' ? 'solid' : 'transparent' });
    });
    fillColor.addEventListener('change', () => {
      const current = normalizedFill(editor, editor.getToolDefaults(tool).fill);
      editor.setToolDefault(tool, 'fill', { ...current, color: Number(fillColor.value) === 0 ? 0 : 1 });
    });

    controls.push(fieldLabel('填充', mode), fieldLabel('填充颜色', fillColor));
  }

  container.replaceChildren(group(...controls));
  return true;
}

export { SHAPE_TOOLS, CLOSED_SHAPE_TOOLS, renderShapeToolOptions };
