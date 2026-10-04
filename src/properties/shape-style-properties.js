import { STROKE_COLOR_OPTIONS } from '../model/stroke-values.js';

const SHAPE_TYPES = new Set(['line', 'rectangle', 'circle', 'polygon']);
const FILLABLE_SHAPES = new Set(['rectangle', 'circle', 'polygon']);

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
function common(nodes, getter) {
  if (!nodes.length) return null;
  const first = getter(nodes[0]);
  return nodes.every(node => JSON.stringify(getter(node)) === JSON.stringify(first)) ? first : null;
}
function field(id, label, value, { min = '', max = '', disabled = false, mixed = false } = {}) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" ${mixed ? 'placeholder="—" class="mixed"' : ''} value="${mixed ? '' : esc(value)}" ${min !== '' ? `min="${min}"` : ''} ${max !== '' ? `max="${max}"` : ''} step="1" ${disabled ? 'disabled' : ''}></div>`;
}
function select(id, label, options, value, { disabled = false, mixed = false } = {}) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}" ${disabled ? 'disabled' : ''}>${mixed ? '<option value="" selected>—</option>' : ''}${options.map(([optionValue, text]) => `<option value="${esc(optionValue)}" ${!mixed && String(optionValue) === String(value) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`;
}
function section(title, body) { return `<div class="property-section"><h4>${title}</h4>${body}</div>`; }

function shapeStylePropertyMarkup(properties, nodes, locked = false) {
  const PE = globalThis.PixelEditor;
  const normalizeStroke = PE?.strokeStyle?.normalizeStroke || PE?.schemaV17?.normalizeStroke;
  const normalizeFill = PE?.schemaV17?.normalizeFill;
  if (!normalizeStroke || !normalizeFill || !nodes.length || !nodes.every(node => node.type === nodes[0].type && SHAPE_TYPES.has(node.type))) return '';
  const node = nodes[0], get = key => common(nodes, item => item[key]);
  let html = '';
  if (node.type === 'line') html += section('直线', `<div class="row">${field('propX1', 'X1', get('x1') ?? '', { disabled: locked, mixed: get('x1') == null })}${field('propY1', 'Y1', get('y1') ?? '', { disabled: locked, mixed: get('y1') == null })}</div><div class="row">${field('propX2', 'X2', get('x2') ?? '', { disabled: locked, mixed: get('x2') == null })}${field('propY2', 'Y2', get('y2') ?? '', { disabled: locked, mixed: get('y2') == null })}</div>`);
  if (node.type === 'rectangle') html += section('圆角', `<div class="corner-grid"><div class="row">${field('propRTL', '左上', get('rTL') ?? '', { min: 0, max: 200, disabled: locked, mixed: get('rTL') == null })}${field('propRTR', '右上', get('rTR') ?? '', { min: 0, max: 200, disabled: locked, mixed: get('rTR') == null })}</div><div class="row">${field('propRBL', '左下', get('rBL') ?? '', { min: 0, max: 200, disabled: locked, mixed: get('rBL') == null })}${field('propRBR', '右下', get('rBR') ?? '', { min: 0, max: 200, disabled: locked, mixed: get('rBR') == null })}</div></div>`);
  if (node.type === 'polygon') html += nodes.length === 1 ? section('多边形', `${field('propPointCount', '顶点数量', node.points.length, { min: 3, max: 24, disabled: locked })}<div id="polygonPointList">${node.points.map((point, index) => `<div class="point-row"><span>P${index + 1}</span>${field(`propPoint${index}X`, 'X', point.x, { disabled: locked })}${field(`propPoint${index}Y`, 'Y', point.y, { disabled: locked })}</div>`).join('')}</div>`) : section('多边形', '<div class="muted">多选时隐藏顶点列表</div>');
  const width = common(nodes, item => normalizeStroke(item.stroke).width), color = common(nodes, item => normalizeStroke(item.stroke).color), style = common(nodes, item => normalizeStroke(item.stroke).style);
  html += section('描边', `${field('propStrokeWidth', '线宽', width ?? '', { min: 0, max: 100, disabled: locked, mixed: width == null })}<div class="row">${select('propStrokeColor', '颜色', STROKE_COLOR_OPTIONS, color, { disabled: locked, mixed: color == null })}${select('propStrokeStyle', '样式', [['solid', '实线'], ['short-dash', '短虚线'], ['long-dash', '长虚线'], ['dot', '点线'], ['dash-dot', '点划线']], style, { disabled: locked, mixed: style == null })}</div>`);
  if (FILLABLE_SHAPES.has(node.type) && properties?.fillFields) html += properties.fillFields(nodes, locked);
  return html;
}

function installShapeStylePropertiesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (PE) PE.shapeStyleProperties = { SHAPE_TYPES, FILLABLE_SHAPES, shapeStylePropertyMarkup };
  return PE?.shapeStyleProperties || null;
}

export { SHAPE_TYPES, FILLABLE_SHAPES, shapeStylePropertyMarkup, installShapeStylePropertiesRuntime };
