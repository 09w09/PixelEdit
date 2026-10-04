import {
  normalizeToolFill,
  normalizeDither,
  normalizePattern,
} from '../model/fill-values.js';

const FILL_OPTIONS = [
  ['transparent', '透明'],
  ['solid', '纯色'],
  ['dither', '抖动'],
  ['pattern', '图案'],
];
const DITHER_OPTIONS = [
  ['bayer', 'Bayer'],
  ['blueNoise', 'Blue Noise'],
  ['random', 'Random'],
];
const PATTERN_OPTIONS = [
  ['horizontal', '横条纹'],
  ['vertical', '竖条纹'],
  ['diagSlash', '斜条纹 /'],
  ['diagBackslash', '斜条纹 \\'],
  ['crosshatch', '十字条纹'],
  ['dots', '点阵'],
  ['checkerboard', '棋盘格'],
];
const ALIGN_OPTIONS = [['global', '全局'], ['object', '对象']];

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

function numberInput(id, value, min, max) {
  const input = document.createElement('input');
  input.id = id;
  input.type = 'number';
  input.step = '1';
  input.value = String(value);
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  return input;
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

function setNestedDefault(editor, tool, key, current, patch) {
  editor.setToolDefault(tool, key, { ...current, ...patch });
}

function renderDitherOptions(editor, tool, settings) {
  const dither = normalizeDither(settings.dither);
  const type = selectInput('toolOptionDitherType', DITHER_OPTIONS, dither.type);
  const density = numberInput('toolOptionDitherDensity', dither.density, 0, 100);
  const matrix = selectInput('toolOptionDitherMatrix', [[2, '2×2'], [4, '4×4'], [8, '8×8']], dither.matrix);
  const align = selectInput('toolOptionDitherAlign', ALIGN_OPTIONS, dither.align);
  const offsetX = numberInput('toolOptionDitherOffsetX', dither.offsetX);
  const offsetY = numberInput('toolOptionDitherOffsetY', dither.offsetY);

  type.addEventListener('change', () => setNestedDefault(editor, tool, 'dither', dither, { type: type.value }));
  density.addEventListener('change', () => setNestedDefault(editor, tool, 'dither', dither, { density: Number(density.value) }));
  matrix.addEventListener('change', () => setNestedDefault(editor, tool, 'dither', dither, { matrix: Number(matrix.value) }));
  align.addEventListener('change', () => setNestedDefault(editor, tool, 'dither', dither, { align: align.value }));
  offsetX.addEventListener('change', () => setNestedDefault(editor, tool, 'dither', dither, { offsetX: Number(offsetX.value) }));
  offsetY.addEventListener('change', () => setNestedDefault(editor, tool, 'dither', dither, { offsetY: Number(offsetY.value) }));

  return group(
    fieldLabel('类型', type),
    fieldLabel('密度 %', density),
    fieldLabel('矩阵', matrix),
    fieldLabel('对齐', align),
    fieldLabel('偏移 X', offsetX),
    fieldLabel('偏移 Y', offsetY),
  );
}

function renderPatternOptions(editor, tool, settings) {
  const pattern = normalizePattern(settings.pattern);
  const type = selectInput('toolOptionPatternType', PATTERN_OPTIONS, pattern.type);
  const lineWidth = numberInput('toolOptionPatternLineWidth', pattern.lineWidth, 1, 16);
  const gap = numberInput('toolOptionPatternGap', pattern.gap, 0, 32);
  const align = selectInput('toolOptionPatternAlign', ALIGN_OPTIONS, pattern.align);
  const offsetX = numberInput('toolOptionPatternOffsetX', pattern.offsetX);
  const offsetY = numberInput('toolOptionPatternOffsetY', pattern.offsetY);

  type.addEventListener('change', () => setNestedDefault(editor, tool, 'pattern', pattern, { type: type.value }));
  lineWidth.addEventListener('change', () => setNestedDefault(editor, tool, 'pattern', pattern, { lineWidth: Number(lineWidth.value) }));
  gap.addEventListener('change', () => setNestedDefault(editor, tool, 'pattern', pattern, { gap: Number(gap.value) }));
  align.addEventListener('change', () => setNestedDefault(editor, tool, 'pattern', pattern, { align: align.value }));
  offsetX.addEventListener('change', () => setNestedDefault(editor, tool, 'pattern', pattern, { offsetX: Number(offsetX.value) }));
  offsetY.addEventListener('change', () => setNestedDefault(editor, tool, 'pattern', pattern, { offsetY: Number(offsetY.value) }));

  return group(
    fieldLabel('类型', type),
    fieldLabel('线宽', lineWidth),
    fieldLabel('间距', gap),
    fieldLabel('对齐', align),
    fieldLabel('偏移 X', offsetX),
    fieldLabel('偏移 Y', offsetY),
  );
}

function renderFillToolOptions(editor, container, tool = 'bucket') {
  const settings = editor.getToolDefaults(tool);
  const fill = normalizeToolFill(settings.fill, { mode: 'solid', color: 1 });
  const mode = selectInput('toolOptionFillMode', FILL_OPTIONS, fill.mode);
  const color = selectInput('toolOptionFillColor', [[1, '黑'], [0, '白']], fill.color);
  color.disabled = fill.mode !== 'solid';

  mode.addEventListener('change', () => {
    editor.setToolDefault(tool, 'fill', { ...fill, mode: mode.value });
  });
  color.addEventListener('change', () => {
    editor.setToolDefault(tool, 'fill', { ...fill, color: Number(color.value) === 0 ? 0 : 1 });
  });

  const children = [group(fieldLabel('填充', mode), fieldLabel('颜色', color))];
  if (fill.mode === 'dither') children.push(renderDitherOptions(editor, tool, settings));
  if (fill.mode === 'pattern') children.push(renderPatternOptions(editor, tool, settings));
  container.replaceChildren(...children);
  return { fill, dither: normalizeDither(settings.dither), pattern: normalizePattern(settings.pattern) };
}

function installFillToolOptionsRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.preferences) throw new Error('PixelEditor fill tool option dependencies are not initialized');
  if (PE.fillToolOptionsInstalled) return;
  PE.fillToolOptionsInstalled = true;
  PE.fillToolOptions = { renderFillToolOptions };
}

export { renderFillToolOptions, installFillToolOptionsRuntime };
