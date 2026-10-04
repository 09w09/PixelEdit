import { STROKE_COLOR_OPTIONS, normalizeStrokeWidth, normalizeStrokeColor } from '../model/stroke-values.js';

const SHAPE_TYPES = new Set(['line', 'rectangle', 'circle', 'polygon']);
const FILLABLE_SHAPES = new Set(['rectangle', 'circle', 'polygon']);
const STROKE_STYLES = new Set(['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot']);

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

function section(title, body) {
  return `<div class="property-section"><h4>${title}</h4>${body}</div>`;
}

function strokeMarkup(nodes, locked, normalizeStroke) {
  const width = common(nodes, node => normalizeStroke(node.stroke).width);
  const color = common(nodes, node => normalizeStroke(node.stroke).color);
  const style = common(nodes, node => normalizeStroke(node.stroke).style);
  return section('描边', `${field('propStrokeWidth', '线宽', width ?? '', { min: 0, max: 100, disabled: locked, mixed: width == null })}<div class="row">${select('propStrokeColor', '颜色', STROKE_COLOR_OPTIONS, color, { disabled: locked, mixed: color == null })}${select('propStrokeStyle', '样式', [['solid', '实线'], ['short-dash', '短虚线'], ['long-dash', '长虚线'], ['dot', '点线'], ['dash-dot', '点划线']], style, { disabled: locked, mixed: style == null })}</div>`);
}

function fillMarkup(properties, nodes, locked, normalizeFill) {
  const mode = common(nodes, node => normalizeFill(node.fill).mode);
  const color = common(nodes, node => normalizeFill(node.fill).color);
  let html = section('填充', `${select('propFill', '填充', [['transparent', '透明'], ['solid', '纯色'], ['dither', '抖动'], ['pattern', '图案']], mode, { disabled: locked, mixed: mode == null })}${select('propFillColor', '颜色', [[1, '黑'], [0, '白']], color, { disabled: locked || mode !== 'solid', mixed: color == null })}`);
  if (mode === 'dither') html += properties.ditherFields(nodes, locked);
  if (mode === 'pattern') html += properties.patternFields(nodes, locked);
  return html;
}

function geometryMarkup(nodes, locked) {
  const node = nodes[0];
  const value = key => common(nodes, item => item[key]);
  if (node.type === 'line') {
    return section('直线', `<div class="row">${field('propX1', 'X1', value('x1') ?? '', { disabled: locked, mixed: value('x1') == null })}${field('propY1', 'Y1', value('y1') ?? '', { disabled: locked, mixed: value('y1') == null })}</div><div class="row">${field('propX2', 'X2', value('x2') ?? '', { disabled: locked, mixed: value('x2') == null })}${field('propY2', 'Y2', value('y2') ?? '', { disabled: locked, mixed: value('y2') == null })}</div>`);
  }
  if (node.type === 'rectangle') {
    return section('圆角', `<div class="corner-grid"><div class="row">${field('propRTL', '左上', value('rTL') ?? '', { min: 0, max: 200, disabled: locked, mixed: value('rTL') == null })}${field('propRTR', '右上', value('rTR') ?? '', { min: 0, max: 200, disabled: locked, mixed: value('rTR') == null })}</div><div class="row">${field('propRBL', '左下', value('rBL') ?? '', { min: 0, max: 200, disabled: locked, mixed: value('rBL') == null })}${field('propRBR', '右下', value('rBR') ?? '', { min: 0, max: 200, disabled: locked, mixed: value('rBR') == null })}</div></div>`);
  }
  if (node.type === 'polygon') {
    if (nodes.length !== 1) return section('多边形', '<div class="muted">多选时隐藏顶点列表</div>');
    return section('多边形', `${field('propPointCount', '顶点数量', node.points.length, { min: 3, max: 24, disabled: locked })}<div id="polygonPointList">${node.points.map((point, index) => `<div class="point-row"><span>P${index + 1}</span>${field(`propPoint${index}X`, 'X', point.x, { disabled: locked })}${field(`propPoint${index}Y`, 'Y', point.y, { disabled: locked })}</div>`).join('')}</div>`);
  }
  return '';
}

function shapeStylePropertyMarkup(properties, nodes, locked, normalizeStroke, normalizeFill) {
  if (!nodes.length || !nodes.every(node => node.type === nodes[0].type && SHAPE_TYPES.has(node.type))) return '';
  return geometryMarkup(nodes, locked)
    + strokeMarkup(nodes, locked, normalizeStroke)
    + (FILLABLE_SHAPES.has(nodes[0].type) ? fillMarkup(properties, nodes, locked, normalizeFill) : '');
}

function installShapeStylePropertiesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const C = PE?.commands;
  const Properties = PE?.ui?.Properties;
  const normalizeStroke = PE?.strokeStyle?.normalizeStroke || PE?.schemaV17?.normalizeStroke;
  const normalizeFill = PE?.schemaV17?.normalizeFill;
  if (!C?.UpdateNodesCommand || !Properties || !normalizeStroke || !normalizeFill) throw new Error('PixelEditor shape style property dependencies are not initialized');
  if (PE.shapeStylePropertiesInstalled) return;
  PE.shapeStylePropertiesInstalled = true;

  const originalTypeFields = Properties.prototype.typeFields;
  Properties.prototype.typeFields = function canonicalShapeTypeFields(nodes, locked) {
    if (!nodes.length || !nodes.every(node => node.type === nodes[0].type && SHAPE_TYPES.has(node.type))) {
      return originalTypeFields.call(this, nodes, locked);
    }
    return shapeStylePropertyMarkup(this, nodes, locked, normalizeStroke, normalizeFill);
  };

  const originalBind = Properties.prototype.bind;
  Properties.prototype.bind = function bindCanonicalShapeStyles(nodes, locked) {
    originalBind.call(this, nodes, locked);
    if (locked || !nodes.length || !nodes.every(node => node.type === nodes[0].type && SHAPE_TYPES.has(node.type))) return;
    const ids = nodes.map(node => node.id);
    const page = this.editor.activePage();
    const updateStroke = (patch, label, channel) => this.editor.exec(new C.UpdateNodesCommand(
      ids,
      node => ({ stroke: normalizeStroke({ ...normalizeStroke(node.stroke), ...patch }) }),
      page.id,
      label,
      { historyChannel: channel },
    ));
    const updateFill = (patch, label, channel) => this.editor.exec(new C.UpdateNodesCommand(
      ids,
      node => ({ fill: normalizeFill({ ...normalizeFill(node.fill), ...patch }) }),
      page.id,
      label,
      { historyChannel: channel },
    ));

    const width = this.el.querySelector('#propStrokeWidth');
    const color = this.el.querySelector('#propStrokeColor');
    const style = this.el.querySelector('#propStrokeStyle');
    if (width) width.onchange = () => updateStroke({ width: normalizeStrokeWidth(width.value, 1) }, '修改线宽', 'stroke.width');
    if (color) color.onchange = () => updateStroke({ color: normalizeStrokeColor(color.value) }, '修改描边颜色', 'stroke.color');
    if (style) style.onchange = () => updateStroke({ style: STROKE_STYLES.has(style.value) ? style.value : 'solid' }, '修改描边样式', 'stroke.style');

    if (FILLABLE_SHAPES.has(nodes[0].type)) {
      const fill = this.el.querySelector('#propFill');
      const fillColor = this.el.querySelector('#propFillColor');
      if (fill) fill.onchange = () => updateFill({ mode: fill.value }, '填充', 'fill.mode');
      if (fillColor) fillColor.onchange = () => updateFill({ color: Number(fillColor.value) === 0 ? 0 : 1 }, '填充颜色', 'fill.color');
    }
  };

  PE.shapeStyleProperties = {
    SHAPE_TYPES,
    FILLABLE_SHAPES,
    shapeStylePropertyMarkup: (properties, nodes, locked = false) => shapeStylePropertyMarkup(properties, nodes, locked, normalizeStroke, normalizeFill),
  };
}

export {
  SHAPE_TYPES,
  FILLABLE_SHAPES,
  shapeStylePropertyMarkup,
  installShapeStylePropertiesRuntime,
};
