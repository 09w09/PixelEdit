import { STROKE_COLOR_OPTIONS, normalizeStrokeColor } from '../model/stroke-values.js';

const SHAPE_TYPES = new Set(['line', 'rectangle', 'circle', 'polygon']);
const FILLABLE_SHAPES = new Set(['rectangle', 'circle', 'polygon']);
const STROKE_STYLES = new Set(['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot']);
const TRANSFORM_TYPES = new Set(['rectangle', 'circle', 'line', 'polygon', 'text', 'image', 'raster']);
const DEFAULT_REFRESH = Object.freeze({ canvas: true, overlay: true });

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function common(items, getter) {
  if (!items.length) return null;
  const value = getter(items[0]);
  return items.every(item => equal(getter(item), value)) ? value : null;
}
function normalizeNumber(value, { min = -Infinity, max = Infinity, integer = true } = {}) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = integer ? Math.round(number) : number;
  return Math.max(min, Math.min(max, normalized));
}
function field(id, label, value, { type = 'number', min = '', max = '', step = '1', disabled = false, mixed = false, readonly = false } = {}) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" ${mixed ? 'placeholder="—" class="mixed"' : ''} value="${mixed ? '' : esc(value)}" ${min !== '' ? `min="${min}"` : ''} ${max !== '' ? `max="${max}"` : ''} ${step ? `step="${step}"` : ''} ${disabled ? 'disabled' : ''} ${readonly ? 'readonly' : ''}></div>`;
}
function select(id, label, options, value, { disabled = false, mixed = false } = {}) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}" ${disabled ? 'disabled' : ''}>${mixed ? '<option value="" selected>—</option>' : ''}${options.map(([optionValue, text]) => `<option value="${esc(optionValue)}" ${!mixed && String(optionValue) === String(value) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`;
}
function section(title, body, id = '') {
  return `<div class="property-section" ${id ? `id="${id}"` : ''}><h4>${title}</h4>${body}</div>`;
}

class PropertyDescriptor {
  constructor({ id, scope = 'element', matches = () => true, render = () => '', bind = () => {} }) {
    if (!id) throw new Error('PropertyDescriptor requires an id');
    this.id = id;
    this.scope = scope;
    this.matches = matches;
    this.render = render;
    this.bind = bind;
  }
}

class PropertySession {
  constructor(properties) {
    this.properties = properties;
    this.editor = properties.editor;
    this.control = null;
    this.channel = '';
    this.frame = 0;
    this.refresh = {};
    this.callbacks = new Set();
  }

  claim(id) {
    return this.properties.el?.querySelector?.(`#${id}`) || null;
  }

  isCurrent(control) {
    if (!control?.isConnected) return false;
    if (!control.id) return true;
    return this.properties.el?.querySelector?.(`#${control.id}`) === control;
  }

  begin(control, channel = '') {
    if (!control || !this.isCurrent(control)) return null;
    if (this.control === control) return this;
    if (this.control) this.editor.bus?.breakMergeChain?.(`property-switch:${this.channel}`);
    this.control = control;
    this.channel = String(channel || control.id || 'property');
    this.editor.bus?.breakMergeChain?.(`property-start:${this.channel}`);
    return this;
  }

  end(reason = 'property-end') {
    if (!this.control) return;
    const channel = this.channel;
    this.control = null;
    this.channel = '';
    this.editor.bus?.breakMergeChain?.(`${reason}:${channel}`);
    this.editor.history?.render?.();
  }

  schedule(refresh = DEFAULT_REFRESH, afterFrame = null) {
    for (const key of ['canvas', 'overlay', 'previews', 'layers', 'properties', 'history']) {
      this.refresh[key] ||= Boolean(refresh?.[key]);
    }
    if (typeof afterFrame === 'function') this.callbacks.add(afterFrame);
    if (this.frame) return;
    const requestFrame = typeof globalThis.requestAnimationFrame === 'function'
      ? callback => globalThis.requestAnimationFrame(callback)
      : callback => globalThis.setTimeout(callback, 0);
    this.frame = requestFrame(() => {
      this.frame = 0;
      const flags = this.refresh;
      this.refresh = {};
      if (flags.canvas) this.editor.renderCanvas?.();
      if (flags.overlay) this.editor.renderOverlay?.();
      if (flags.layers) this.editor.pageLayers?.render?.();
      if (flags.properties) this.properties.render?.();
      if (flags.history) this.editor.history?.render?.();
      const callbacks = [...this.callbacks];
      this.callbacks.clear();
      for (const callback of callbacks) callback();
    });
  }

  execute(command, refresh = DEFAULT_REFRESH, afterFrame = null) {
    if (!command) return false;
    globalThis.PixelEditor?.commandCoalescing?.attachSelectionBoundary?.(this.editor);
    const changed = this.editor.bus.execute(command);
    if (changed) this.schedule(refresh, afterFrame);
    return changed;
  }

  bindNumber(control, {
    channel = control?.id || 'number', min = -Infinity, max = Infinity, integer = true, wheel = true,
    createCommand, readModel, refresh = DEFAULT_REFRESH, afterPreview, afterEnd,
  } = {}) {
    if (!control || typeof createCommand !== 'function') return control;
    control.dataset.propertyBound = 'number';
    let composing = false;
    const begin = () => this.begin(control, channel);
    const preview = () => {
      if (composing || !this.isCurrent(control)) return false;
      const value = normalizeNumber(control.value, { min, max, integer });
      if (value == null) return false;
      begin();
      const canonical = String(value);
      if (control.value !== canonical) control.value = canonical;
      return this.execute(createCommand(value), refresh, afterPreview);
    };
    const restore = () => {
      if (!this.isCurrent(control) || normalizeNumber(control.value, { min, max, integer }) != null) return;
      const value = typeof readModel === 'function' ? readModel() : null;
      if (value != null && Number.isFinite(Number(value))) control.value = String(value);
    };
    control.addEventListener('focus', begin);
    control.addEventListener('compositionstart', () => { composing = true; });
    control.addEventListener('compositionend', () => { composing = false; preview(); });
    control.addEventListener('input', preview);
    control.addEventListener('change', preview);
    control.addEventListener('wheel', event => {
      if (!wheel || !this.isCurrent(control) || globalThis.document?.activeElement !== control || event.deltaY === 0) return;
      event.preventDefault();
      begin();
      const before = control.value;
      if (event.deltaY < 0) control.stepUp();
      else control.stepDown();
      if (control.value !== before) preview();
    }, { passive: false });
    control.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      preview();
      control.blur();
    });
    control.addEventListener('blur', () => {
      restore();
      if (typeof afterEnd === 'function' && this.isCurrent(control)) afterEnd(control);
      if (this.control === control) this.end('property-blur');
    });
    return control;
  }

  bindText(control, { channel = control?.id || 'text', createCommand, refresh = DEFAULT_REFRESH, afterPreview } = {}) {
    if (!control || typeof createCommand !== 'function') return control;
    control.dataset.propertyBound = 'text';
    const preview = () => {
      if (!this.isCurrent(control)) return false;
      this.begin(control, channel);
      return this.execute(createCommand(control.value), refresh, afterPreview);
    };
    control.addEventListener('focus', () => this.begin(control, channel));
    control.addEventListener('input', preview);
    control.addEventListener('change', preview);
    control.addEventListener('blur', () => { if (this.control === control) this.end('property-blur'); });
    return control;
  }

  bindTextarea(control, { channel = control?.id || 'textarea', createCommand, refresh = DEFAULT_REFRESH, afterPreview } = {}) {
    if (!control || typeof createCommand !== 'function') return control;
    control.dataset.propertyBound = 'textarea';
    let composing = false;
    const preview = () => {
      if (composing || !this.isCurrent(control)) return false;
      this.begin(control, channel);
      return this.execute(createCommand(control.value), refresh, afterPreview);
    };
    control.addEventListener('focus', () => this.begin(control, channel));
    control.addEventListener('compositionstart', () => { composing = true; });
    control.addEventListener('input', event => { if (!composing && !event.isComposing) preview(); });
    control.addEventListener('compositionend', () => { composing = false; preview(); });
    control.addEventListener('change', () => { if (!composing) preview(); });
    control.addEventListener('blur', () => {
      if (!composing) preview();
      if (this.control === control) this.end('property-blur');
    });
    return control;
  }

  bindSelect(control, { createCommand, refresh = DEFAULT_REFRESH, structural = false, afterPreview } = {}) {
    if (!control || typeof createCommand !== 'function') return control;
    control.dataset.propertyBound = 'select';
    control.addEventListener('change', () => {
      if (!this.isCurrent(control)) return false;
      this.end('property-discrete');
      this.editor.bus?.breakMergeChain?.(`property-select:${control.id}`);
      const changed = this.execute(createCommand(control.value), structural ? { ...refresh, properties: false, history: false } : refresh, afterPreview);
      this.editor.bus?.breakMergeChain?.(`property-select-end:${control.id}`);
      if (changed && structural) {
        this.properties.render();
        this.editor.history?.render?.();
      } else if (!structural) this.editor.history?.render?.();
      return changed;
    });
    return control;
  }

  bindCheckbox(control, { createCommand, refresh = DEFAULT_REFRESH, structural = false, afterPreview } = {}) {
    if (!control || typeof createCommand !== 'function') return control;
    control.dataset.propertyBound = 'checkbox';
    control.addEventListener('change', () => {
      if (!this.isCurrent(control)) return false;
      this.end('property-discrete');
      this.editor.bus?.breakMergeChain?.(`property-checkbox:${control.id}`);
      const changed = this.execute(createCommand(Boolean(control.checked)), structural ? { ...refresh, properties: false, history: false } : refresh, afterPreview);
      this.editor.bus?.breakMergeChain?.(`property-checkbox-end:${control.id}`);
      if (changed && structural) {
        this.properties.render();
        this.editor.history?.render?.();
      } else if (!structural) this.editor.history?.render?.();
      return changed;
    });
    return control;
  }
}

class PropertyProvider {
  constructor(PE) {
    this.PE = PE;
    this.sessions = new WeakMap();
    this.descriptors = [
      new PropertyDescriptor({ id: 'page', scope: 'page', render: context => this.pageMarkup(context), bind: context => this.bindPage(context) }),
      new PropertyDescriptor({ id: 'general', render: context => this.generalMarkup(context), bind: context => this.bindGeneral(context) }),
      new PropertyDescriptor({ id: 'position', render: context => this.positionMarkup(context), bind: context => this.bindPosition(context) }),
      new PropertyDescriptor({ id: 'type', matches: context => context.sameType, render: context => this.typeMarkup(context), bind: context => this.bindType(context) }),
    ];
  }

  attach(properties) {
    properties.provider = this;
    const session = new PropertySession(properties);
    this.sessions.set(properties, session);
    properties.session = session;
    return session;
  }

  session(properties) {
    return this.sessions.get(properties) || this.attach(properties);
  }

  context(properties) {
    const editor = properties.editor;
    const page = editor.activePage();
    const ids = [...editor.state.selection.ids];
    const nodes = ids.map(id => this.PE.model.nodeById(page, id)).filter(Boolean);
    const tree = new this.PE.model.TreeModel(page);
    return {
      properties, editor, page, ids, nodes, tree,
      pageSelected: editor.pageSelectedId === page.id && !nodes.length,
      allLocked: nodes.length > 0 && nodes.every(node => tree.isEffectivelyLocked(node.id)),
      sameType: nodes.length > 0 && nodes.every(node => node.type === nodes[0].type),
      session: this.session(properties),
    };
  }

  render(properties) {
    const context = this.context(properties);
    context.session.end('properties-render');
    if (context.pageSelected) return this.renderPage(properties, context.page);
    if (!context.nodes.length) {
      properties.el.innerHTML = '<div class="muted">未选择图层</div>';
      return;
    }
    const descriptors = this.descriptors.filter(descriptor => descriptor.scope === 'element' && descriptor.matches(context));
    let html = descriptors.map(descriptor => descriptor.render(context)).join('');
    if (!context.sameType) html += '<div class="muted">不同类型：仅显示通用、位置、可见与锁定属性</div>';
    properties.el.innerHTML = html;
    for (const descriptor of descriptors) descriptor.bind(context);
    this.renderPreviews(properties, context.nodes);
  }

  renderPage(properties, page) {
    const context = this.context(properties);
    context.page = page;
    context.pageSelected = true;
    context.session.end('properties-render');
    const descriptors = this.descriptors.filter(descriptor => descriptor.scope === 'page' && descriptor.matches(context));
    properties.el.innerHTML = descriptors.map(descriptor => descriptor.render(context)).join('');
    for (const descriptor of descriptors) descriptor.bind(context);
    this.renderPreviews(properties, [page]);
  }

  bounds(properties, nodes) {
    const page = properties.editor.activePage();
    return nodes.map(node => this.PE.renderer.FramebufferRenderer.visualBounds(node.id, {
      project: properties.editor.state.project,
      pageId: page.id,
      assets: properties.editor.state.assets,
    }));
  }

  fontOptionsArray(properties) {
    const options = this.PE.fontOptions?.fontOptions?.(properties.editor.state.project) || [];
    return options.map(option => [option.value, option.label]);
  }

  ditherFields(nodes, locked) {
    const get = key => common(nodes, node => node.dither?.[key]);
    return section('抖动', `${select('propDitherType', '类型', [['bayer', 'Bayer'], ['blueNoise', 'Blue Noise'], ['random', 'Random']], get('type'), { disabled: locked, mixed: get('type') == null })}${field('propDitherDensity', '密度 %', get('density') ?? '', { min: 0, max: 100, disabled: locked, mixed: get('density') == null })}<div class="row">${select('propDitherMatrix', '矩阵', [[2, '2×2'], [4, '4×4'], [8, '8×8']], get('matrix'), { disabled: locked, mixed: get('matrix') == null })}${select('propDitherAlign', '对齐', [['global', '全局'], ['object', '对象']], get('align'), { disabled: locked, mixed: get('align') == null })}</div><div class="row">${field('propDitherOffsetX', '偏移 X', get('offsetX') ?? '', { disabled: locked, mixed: get('offsetX') == null })}${field('propDitherOffsetY', '偏移 Y', get('offsetY') ?? '', { disabled: locked, mixed: get('offsetY') == null })}</div><div class="preview-wrap"><canvas class="pixel-preview" id="ditherPreview" width="8" height="8"></canvas><span class="muted">8×8 实际像素预览</span></div>`, 'ditherModule');
  }

  patternFields(nodes, locked) {
    const get = key => common(nodes, node => node.pattern?.[key]);
    return section('图案', `${select('propPatternType', '类型', [['horizontal', '横条纹'], ['vertical', '竖条纹'], ['diagSlash', '斜条纹 /'], ['diagBackslash', '斜条纹 \\'], ['crosshatch', '十字条纹'], ['dots', '点阵'], ['checkerboard', '棋盘格']], get('type'), { disabled: locked, mixed: get('type') == null })}<div class="row">${field('propPatternLineWidth', '线宽', get('lineWidth') ?? '', { min: 1, max: 16, disabled: locked, mixed: get('lineWidth') == null })}${field('propPatternGap', '间距', get('gap') ?? '', { min: 0, max: 32, disabled: locked, mixed: get('gap') == null })}</div>${select('propPatternAlign', '对齐', [['global', '全局'], ['object', '对象']], get('align'), { disabled: locked, mixed: get('align') == null })}<div class="row">${field('propPatternOffsetX', '偏移 X', get('offsetX') ?? '', { disabled: locked, mixed: get('offsetX') == null })}${field('propPatternOffsetY', '偏移 Y', get('offsetY') ?? '', { disabled: locked, mixed: get('offsetY') == null })}</div><div class="preview-wrap"><canvas class="pixel-preview" id="patternPreview" width="8" height="8"></canvas><span class="muted">8×8 实际像素预览</span></div>`, 'patternModule');
  }

  fillFields(nodes, locked, textOnly = false) {
    const normalizeFill = this.PE.schemaV17.normalizeFill;
    const mode = common(nodes, node => normalizeFill(node.fill).mode);
    const color = common(nodes, node => normalizeFill(node.fill).color);
    const options = textOnly ? [['solid', '纯色'], ['dither', '抖动'], ['pattern', '图案']] : [['transparent', '透明'], ['solid', '纯色'], ['dither', '抖动'], ['pattern', '图案']];
    let html = section('填充', `${select('propFill', '填充', options, mode, { disabled: locked, mixed: mode == null })}${select('propFillColor', '颜色', [[1, '黑'], [0, '白']], color, { disabled: locked || mode !== 'solid', mixed: color == null })}`);
    if (mode === 'dither') html += this.ditherFields(nodes, locked);
    if (mode === 'pattern') html += this.patternFields(nodes, locked);
    return html;
  }

  pageMarkup({ page }) {
    const fill = this.PE.schemaV17.normalizeFill(page.fill, { background: true });
    const locked = Boolean(page.locked);
    let html = section('页面', `${field('propPageName', '名称', page.name, { type: 'text' })}<label class="check"><input id="propPageLocked" type="checkbox" ${locked ? 'checked' : ''}> 锁定页面</label>`)
      + section('背景', `${select('propFill', '填充', [['solid', '纯色'], ['dither', '抖动'], ['pattern', '图案']], fill.mode, { disabled: locked })}${fill.mode === 'solid' ? select('propBgSolid', '颜色', [[0, '白'], [1, '黑']], fill.color, { disabled: locked }) : ''}`);
    if (fill.mode === 'dither') html += this.ditherFields([page], locked);
    if (fill.mode === 'pattern') html += this.patternFields([page], locked);
    return html;
  }

  generalMarkup({ nodes, allLocked }) {
    const name = common(nodes, node => node.name);
    const visible = common(nodes, node => node.visible !== false);
    const locked = common(nodes, node => Boolean(node.locked));
    return section('通用', `${field('propName', '名称', name ?? '', { type: 'text', disabled: allLocked || nodes.length !== 1, mixed: name == null })}<label class="check"><input id="propVisible" type="checkbox" ${visible === true ? 'checked' : ''}> 可见${visible == null ? '（混合）' : ''}</label><label class="check"><input id="propLocked" type="checkbox" ${locked === true ? 'checked' : ''}> 锁定${locked == null ? '（混合）' : ''}</label>`);
  }

  positionMarkup({ properties, nodes, allLocked }) {
    const boxes = this.bounds(properties, nodes);
    const x = common(boxes, box => box.x), y = common(boxes, box => box.y), w = common(boxes, box => box.w), h = common(boxes, box => box.h);
    const boxTypes = nodes.every(node => ['rectangle', 'circle', 'text', 'image', 'raster'].includes(node.type));
    const aspect = boxTypes ? common(nodes, node => Boolean(node.aspectLocked)) : null;
    let html = section('位置', `<div class="row">${field('propX', 'X', x ?? '', { disabled: allLocked, mixed: x == null })}${field('propY', 'Y', y ?? '', { disabled: allLocked, mixed: y == null })}</div>${boxTypes ? `<div class="row">${field('propW', 'W', w ?? '', { min: 1, max: 400, disabled: allLocked, mixed: w == null })}${field('propH', 'H', h ?? '', { min: 1, max: 300, disabled: allLocked, mixed: h == null })}</div><label class="check"><input id="propAspect" type="checkbox" ${aspect === true ? 'checked' : ''} ${allLocked ? 'disabled' : ''}> 锁定比例${aspect == null ? '（混合）' : ''}</label>` : ''}`);
    if (nodes.length === 1 && TRANSFORM_TYPES.has(nodes[0].type)) {
      const transform = this.PE.transformModel.normalizeTransform(nodes[0].transform);
      html += section('变换', `${field('propRotation', '旋转角度', transform.rotation, { min: -180, max: 180, disabled: allLocked })}<label class="check"><input id="propFlipX" type="checkbox" ${transform.flipX ? 'checked' : ''} ${allLocked ? 'disabled' : ''}> 水平翻转</label><label class="check"><input id="propFlipY" type="checkbox" ${transform.flipY ? 'checked' : ''} ${allLocked ? 'disabled' : ''}> 垂直翻转</label>`, 'elementTransformModule');
    }
    return html;
  }

  shapeMarkup({ properties, nodes, allLocked }) {
    const node = nodes[0];
    const get = key => common(nodes, item => item[key]);
    const normalizeStroke = this.PE.strokeStyle?.normalizeStroke || this.PE.schemaV17.normalizeStroke;
    let html = '';
    if (node.type === 'line') html += section('直线', `<div class="row">${field('propX1', 'X1', get('x1') ?? '', { disabled: allLocked, mixed: get('x1') == null })}${field('propY1', 'Y1', get('y1') ?? '', { disabled: allLocked, mixed: get('y1') == null })}</div><div class="row">${field('propX2', 'X2', get('x2') ?? '', { disabled: allLocked, mixed: get('x2') == null })}${field('propY2', 'Y2', get('y2') ?? '', { disabled: allLocked, mixed: get('y2') == null })}</div>`);
    if (node.type === 'rectangle') html += section('圆角', `<div class="corner-grid"><div class="row">${field('propRTL', '左上', get('rTL') ?? '', { min: 0, max: 200, disabled: allLocked, mixed: get('rTL') == null })}${field('propRTR', '右上', get('rTR') ?? '', { min: 0, max: 200, disabled: allLocked, mixed: get('rTR') == null })}</div><div class="row">${field('propRBL', '左下', get('rBL') ?? '', { min: 0, max: 200, disabled: allLocked, mixed: get('rBL') == null })}${field('propRBR', '右下', get('rBR') ?? '', { min: 0, max: 200, disabled: allLocked, mixed: get('rBR') == null })}</div></div>`);
    if (node.type === 'polygon') {
      html += nodes.length === 1
        ? section('多边形', `${field('propPointCount', '顶点数量', node.points.length, { min: 3, max: 24, disabled: allLocked })}<div id="polygonPointList">${node.points.map((point, index) => this.pointFieldMarkup(index, point, allLocked)).join('')}</div>`)
        : section('多边形', '<div class="muted">多选时隐藏顶点列表</div>');
    }
    const strokeWidth = common(nodes, item => normalizeStroke(item.stroke).width);
    const strokeColor = common(nodes, item => normalizeStroke(item.stroke).color);
    const strokeStyle = common(nodes, item => normalizeStroke(item.stroke).style);
    html += section('描边', `${field('propStrokeWidth', '线宽', strokeWidth ?? '', { min: 0, max: 100, disabled: allLocked, mixed: strokeWidth == null })}<div class="row">${select('propStrokeColor', '颜色', STROKE_COLOR_OPTIONS, strokeColor, { disabled: allLocked, mixed: strokeColor == null })}${select('propStrokeStyle', '样式', [['solid', '实线'], ['short-dash', '短虚线'], ['long-dash', '长虚线'], ['dot', '点线'], ['dash-dot', '点划线']], strokeStyle, { disabled: allLocked, mixed: strokeStyle == null })}</div>`);
    if (FILLABLE_SHAPES.has(node.type)) html += this.fillFields(nodes, allLocked);
    return html;
  }

  textMarkup({ properties, nodes, allLocked }) {
    const node = nodes[0];
    const fontFamily = common(nodes, item => item.fontFamily);
    const meta = (properties.editor.state.project.fonts || []).find(record => record.family === fontFamily);
    const fontSize = common(nodes, item => item.fixedFontSize || item.fontSize);
    const letterSpacing = common(nodes, item => item.letterSpacing);
    const lineSpacing = common(nodes, item => item.lineSpacing);
    const alignH = common(nodes, item => item.alignH), alignV = common(nodes, item => item.alignV);
    const wrap = common(nodes, item => item.wrap !== false), bold = common(nodes, item => Boolean(item.bold)), invert = common(nodes, item => Boolean(item.invert));
    let html = section('文字', `${nodes.length === 1 ? `<div class="field"><label>内容</label><textarea id="propText" ${allLocked ? 'disabled' : ''}>${esc(node.text)}</textarea></div>` : ''}${select('propFont', '字体', this.fontOptionsArray(properties), fontFamily, { disabled: allLocked, mixed: fontFamily == null })}<div class="row">${field('propFontSize', '字号', fontSize ?? '', { min: 1, max: 200, disabled: allLocked || Boolean(meta?.fixedSize), mixed: fontSize == null })}${field('propLetterSpacing', '字距', letterSpacing ?? '', { min: -20, max: 100, disabled: allLocked, mixed: letterSpacing == null })}</div>${field('propLineSpacing', '行距', lineSpacing ?? '', { min: -20, max: 200, disabled: allLocked, mixed: lineSpacing == null })}<div class="row">${select('propAlignH', '水平对齐', [['left', '左'], ['center', '中'], ['right', '右']], alignH, { disabled: allLocked, mixed: alignH == null })}${select('propAlignV', '垂直对齐', [['top', '上'], ['middle', '中'], ['bottom', '下']], alignV, { disabled: allLocked, mixed: alignV == null })}</div><label class="check"><input id="propWrap" type="checkbox" ${wrap === true ? 'checked' : ''} ${allLocked ? 'disabled' : ''}> 自动换行${wrap == null ? '（混合）' : ''}</label><label class="check"><input id="propBold" type="checkbox" ${bold === true ? 'checked' : ''} ${allLocked ? 'disabled' : ''}> 粗体${bold == null ? '（混合）' : ''}</label><label class="check"><input id="propInvert" type="checkbox" ${invert === true ? 'checked' : ''} ${allLocked ? 'disabled' : ''}> 黑底白字${invert == null ? '（混合）' : ''}</label>`);
    html += this.fillFields(nodes, allLocked, true);
    return html;
  }

  imageMarkup({ nodes, allLocked }) {
    if (nodes.length !== 1) return '';
    const node = nodes[0], image = node.image || {};
    return section('图片', `${field('propImageFile', '文件', node.sourceName || node.name, { type: 'text', readonly: true, disabled: allLocked })}<button id="replaceImageBtn" type="button" ${allLocked ? 'disabled' : ''}>替换图片</button><div class="row">${select('propImageFit', '适应方式', [['original', '原始'], ['contain', '包含'], ['cover', '覆盖'], ['stretch', '拉伸']], image.fit, { disabled: allLocked })}${select('propInterpolation', '插值', [['nearest', '最近邻'], ['bilinear', '双线性']], image.interpolation, { disabled: allLocked })}</div><h4>裁剪</h4><div class="row">${field('propCropX', 'X', image.cropX, { min: 0, max: node.sourceWidth - 1, disabled: allLocked })}${field('propCropY', 'Y', image.cropY, { min: 0, max: node.sourceHeight - 1, disabled: allLocked })}</div><div class="row">${field('propCropW', 'W', image.cropW, { min: 1, max: node.sourceWidth, disabled: allLocked })}${field('propCropH', 'H', image.cropH, { min: 1, max: node.sourceHeight, disabled: allLocked })}</div>${select('propBwMode', '黑白模式', [['threshold', '阈值'], ['dither', '抖动']], image.bwMode, { disabled: allLocked })}${image.bwMode === 'threshold' ? field('propThreshold', '阈值', image.threshold, { min: 0, max: 255, disabled: allLocked }) : `${select('propImageDitherAlgorithm', '算法', [['bayer', 'Bayer'], ['blueNoise', 'Blue Noise'], ['floydSteinberg', 'Floyd-Steinberg'], ['atkinson', 'Atkinson']], image.ditherAlgorithm, { disabled: allLocked })}${image.ditherAlgorithm === 'bayer' ? select('propImageBayerMatrix', 'Bayer 矩阵', [[2, '2×2'], [4, '4×4'], [8, '8×8']], image.bayerMatrix, { disabled: allLocked }) : ''}<div class="preview-wrap"><canvas id="imageDitherPreview" class="image-preview" width="64" height="48"></canvas></div>`}<label class="check"><input id="propImageInvert" type="checkbox" ${image.invert ? 'checked' : ''} ${allLocked ? 'disabled' : ''}>反相</label>`);
  }

  rasterMarkup() {
    return section('栅格', '<div class="muted">固定像素画布：黑、白、透明三态。铅笔写入黑/白，橡皮写入透明；调整边框只扩展透明区域或裁剪，不重采样。</div>');
  }

  typeMarkup(context) {
    const type = context.nodes[0]?.type;
    if (SHAPE_TYPES.has(type)) return this.shapeMarkup(context);
    if (type === 'text') return this.textMarkup(context);
    if (type === 'image') return this.imageMarkup(context);
    if (type === 'raster') return this.rasterMarkup(context);
    return '';
  }

  selectionBounds(editor, ids = editor.state.selection.ids) {
    const page = editor.activePage();
    const boxes = ids.map(id => this.PE.renderer.FramebufferRenderer.visualBounds(id, {
      project: editor.state.project, pageId: page.id, assets: editor.state.assets,
    })).filter(box => box && box.w > 0 && box.h > 0);
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
    const right = Math.max(...boxes.map(box => box.x + box.w)), bottom = Math.max(...boxes.map(box => box.y + box.h));
    return { x, y, w: right - x, h: bottom - y };
  }

  axisCommand(editor, axis, targetValue) {
    const M = this.PE.model, C = this.PE.commands, R = this.PE.renderer;
    const page = editor.activePage(), tree = new M.TreeModel(page), roots = editor.state.selection.transformRoots(tree);
    return {
      label: '设置位置', mergeDescriptor: { operation: 'property', targets: roots, channel: axis },
      execute: state => {
        const currentPage = M.pageById(state.project, page.id);
        if (!currentPage) return false;
        const currentTree = new M.TreeModel(currentPage);
        let changed = false;
        for (const id of roots) {
          if (currentTree.isEffectivelyLocked(id)) continue;
          const bounds = R.FramebufferRenderer.visualBounds(id, { project: state.project, pageId: currentPage.id, assets: state.assets });
          const delta = Math.round(targetValue - bounds[axis]);
          if (!delta) continue;
          C.moveNodeTree(currentPage, id, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0, currentTree);
          changed = true;
        }
        return changed;
      },
    };
  }

  sizeCommand(editor, axis, value, ids) {
    const C = this.PE.commands;
    const page = editor.activePage();
    return new C.UpdateNodesCommand(ids, node => {
      if (node.type === 'raster' && this.PE.rasterLayer?.resizeRaster) {
        const geometry = { x: node.x, y: node.y, w: node.w, h: node.h, [axis]: value };
        if (node.aspectLocked) {
          const ratio = node.w / Math.max(1, node.h);
          if (axis === 'w') geometry.h = Math.max(1, Math.round(value / ratio));
          else geometry.w = Math.max(1, Math.round(value * ratio));
        }
        return this.PE.rasterLayer.resizeRaster(node, geometry);
      }
      const ratio = node.w / Math.max(1, node.h);
      if (axis === 'w') return node.aspectLocked ? { w: value, h: Math.max(1, Math.round(value / ratio)) } : { w: value };
      return node.aspectLocked ? { h: value, w: Math.max(1, Math.round(value * ratio)) } : { h: value };
    }, page.id, '调整尺寸', { historyChannel: axis });
  }

  bindDither(context, current, createCommand) {
    const { session } = context;
    const preview = () => this.renderPreviews(context.properties, current());
    for (const [id, key, min, max] of [['propDitherDensity', 'density', 0, 100], ['propDitherOffsetX', 'offsetX', -Infinity, Infinity], ['propDitherOffsetY', 'offsetY', -Infinity, Infinity]]) {
      const control = session.claim(id);
      if (control) session.bindNumber(control, { channel: `dither.${key}`, min, max, createCommand: value => createCommand(key, value), readModel: () => current()?.[0]?.dither?.[key], refresh: { canvas: true }, afterPreview: preview });
    }
    for (const [id, key, parse] of [['propDitherType', 'type', value => value], ['propDitherMatrix', 'matrix', Number], ['propDitherAlign', 'align', value => value]]) {
      const control = session.claim(id);
      if (control) session.bindSelect(control, { createCommand: value => createCommand(key, parse(value)), refresh: { canvas: true }, afterPreview: preview });
    }
  }

  bindPattern(context, current, createCommand) {
    const { session } = context;
    const preview = () => this.renderPreviews(context.properties, current());
    for (const [id, key, min, max] of [['propPatternLineWidth', 'lineWidth', 1, 16], ['propPatternGap', 'gap', 0, 32], ['propPatternOffsetX', 'offsetX', -Infinity, Infinity], ['propPatternOffsetY', 'offsetY', -Infinity, Infinity]]) {
      const control = session.claim(id);
      if (control) session.bindNumber(control, { channel: `pattern.${key}`, min, max, createCommand: value => createCommand(key, value), readModel: () => current()?.[0]?.pattern?.[key], refresh: { canvas: true }, afterPreview: preview });
    }
    for (const [id, key] of [['propPatternType', 'type'], ['propPatternAlign', 'align']]) {
      const control = session.claim(id);
      if (control) session.bindSelect(control, { createCommand: value => createCommand(key, value), refresh: { canvas: true }, afterPreview: preview });
    }
  }

  bindPage(context) {
    const { editor, page, session } = context;
    const M = this.PE.model, C = this.PE.commands, normalizeFill = this.PE.schemaV17.normalizeFill;
    const current = () => M.pageById(editor.state.project, page.id);
    const command = (patch, label, channel) => new C.UpdatePageCommand(page.id, patch, label, { historyChannel: channel });
    const name = session.claim('propPageName');
    if (name) session.bindText(name, { channel: 'page.name', createCommand: value => command({ name: value }, '重命名页面', 'name'), refresh: { layers: true } });
    const locked = session.claim('propPageLocked');
    if (locked) session.bindCheckbox(locked, { createCommand: value => command({ locked: value }, value ? '锁定页面' : '解锁页面', 'locked'), refresh: { canvas: true, overlay: true, layers: true }, structural: true });
    if (current()?.locked) return;
    const fillControl = session.claim('propFill');
    if (fillControl) session.bindSelect(fillControl, { createCommand: mode => command(item => ({ fill: { ...normalizeFill(item.fill, { background: true }), mode } }), '背景填充', 'fill.mode'), refresh: { canvas: true }, structural: true });
    const solid = session.claim('propBgSolid');
    if (solid) session.bindSelect(solid, { createCommand: value => command(item => ({ fill: { ...normalizeFill(item.fill, { background: true }), mode: 'solid', color: Number(value) === 1 ? 1 : 0 } }), '背景颜色', 'fill.color'), refresh: { canvas: true } });
    this.bindDither(context, () => [current()], (key, value) => command(item => ({ dither: { ...(item.dither || M.defaultDither()), [key]: value } }), '修改背景抖动', `dither.${key}`));
    this.bindPattern(context, () => [current()], (key, value) => command(item => ({ pattern: { ...(item.pattern || M.defaultPattern()), [key]: value } }), '修改背景图案', `pattern.${key}`));
  }

  bindGeneral(context) {
    const { page, nodes, ids, session, allLocked } = context;
    const C = this.PE.commands;
    const name = session.claim('propName');
    if (name && !name.disabled && nodes.length === 1) session.bindText(name, { channel: 'name', createCommand: value => new C.UpdateNodesCommand(ids, { name: value }, page.id, '重命名图层', { historyChannel: 'name' }), refresh: { layers: true } });
    const visible = session.claim('propVisible');
    if (visible) {
      visible.indeterminate = common(nodes, node => node.visible !== false) == null;
      session.bindCheckbox(visible, { createCommand: value => new C.SetVisibilityCommand(ids, value, page.id), refresh: { canvas: true, overlay: true, layers: true } });
    }
    const locked = session.claim('propLocked');
    if (locked) {
      locked.indeterminate = common(nodes, node => Boolean(node.locked)) == null;
      session.bindCheckbox(locked, { createCommand: value => new C.ToggleLockCommand(ids, value, page.id), refresh: { canvas: false, overlay: true, layers: true }, structural: true });
    }
    if (allLocked) return;
  }

  bindPosition(context) {
    const { editor, page, nodes, ids, session, allLocked } = context;
    const C = this.PE.commands, M = this.PE.model, T = this.PE.transformModel;
    if (!allLocked) {
      for (const axis of ['x', 'y']) {
        const control = session.claim(`prop${axis.toUpperCase()}`);
        if (control && !control.disabled) session.bindNumber(control, { channel: axis, createCommand: value => this.axisCommand(editor, axis, value), readModel: () => this.selectionBounds(editor)?.[axis], refresh: { canvas: true, overlay: true } });
      }
      const sizable = ids.filter(id => ['rectangle', 'circle', 'text', 'image', 'raster'].includes(M.nodeById(page, id)?.type));
      if (sizable.length === ids.length) {
        for (const axis of ['w', 'h']) {
          const control = session.claim(`prop${axis.toUpperCase()}`);
          if (control && !control.disabled) session.bindNumber(control, { channel: axis, min: 1, max: axis === 'w' ? 400 : 300, createCommand: value => this.sizeCommand(editor, axis, value, sizable), readModel: () => this.selectionBounds(editor)?.[axis], refresh: { canvas: true, overlay: true } });
        }
        const aspect = session.claim('propAspect');
        if (aspect && !aspect.disabled) {
          aspect.indeterminate = common(nodes, node => Boolean(node.aspectLocked)) == null;
          session.bindCheckbox(aspect, { createCommand: value => new C.UpdateNodesCommand(ids, { aspectLocked: value }, page.id, '锁定比例', { historyChannel: 'aspectLocked' }), refresh: {} });
        }
      }
    }
    if (nodes.length === 1 && TRANSFORM_TYPES.has(nodes[0].type) && !allLocked) {
      const id = nodes[0].id, current = () => M.nodeById(editor.activePage(), id);
      const update = (patch, label, channel) => new C.UpdateNodesCommand([id], node => ({ transform: T.normalizeTransform({ ...node.transform, ...patch }) }), page.id, label, { historyChannel: channel });
      const rotation = session.claim('propRotation');
      if (rotation) session.bindNumber(rotation, { channel: 'transform.rotation', min: -180, max: 180, createCommand: value => update({ rotation: T.normalizeRotation(value) }, '旋转元素', 'transform.rotation'), readModel: () => T.normalizeTransform(current()?.transform).rotation, refresh: { canvas: true, overlay: true } });
      for (const [controlId, key, label] of [['propFlipX', 'flipX', '水平翻转元素'], ['propFlipY', 'flipY', '垂直翻转元素']]) {
        const control = session.claim(controlId);
        if (control) session.bindCheckbox(control, { createCommand: value => update({ [key]: value }, label, `transform.${key}`), refresh: { canvas: true, overlay: true } });
      }
    }
  }

  bindShape(context) {
    const { editor, page, nodes, ids, session, allLocked } = context;
    if (allLocked) return;
    const C = this.PE.commands, M = this.PE.model;
    const type = nodes[0].type;
    const normalizeStroke = this.PE.strokeStyle?.normalizeStroke || this.PE.schemaV17.normalizeStroke;
    const normalizeFill = this.PE.schemaV17.normalizeFill;
    const current = () => ids.map(id => M.nodeById(editor.activePage(), id)).filter(Boolean);
    const update = (patch, label, channel) => new C.UpdateNodesCommand(ids, patch, page.id, label, { historyChannel: channel });
    if (type === 'line') for (const [controlId, key] of [['propX1', 'x1'], ['propY1', 'y1'], ['propX2', 'x2'], ['propY2', 'y2']]) {
      const control = session.claim(controlId);
      if (control) session.bindNumber(control, { channel: key, min: -9999, max: 9999, createCommand: value => update({ [key]: value }, '修改直线', key), readModel: () => current()[0]?.[key], refresh: { canvas: true, overlay: true } });
    }
    if (type === 'rectangle') for (const [controlId, key] of [['propRTL', 'rTL'], ['propRTR', 'rTR'], ['propRBL', 'rBL'], ['propRBR', 'rBR']]) {
      const control = session.claim(controlId);
      if (control) session.bindNumber(control, { channel: key, min: 0, max: 200, createCommand: value => update({ [key]: value }, '修改圆角', key), readModel: () => current()[0]?.[key], refresh: { canvas: true, overlay: true } });
    }
    if (type === 'polygon' && nodes.length === 1) this.bindPolygon(context, nodes[0].id);
    const strokeWidth = session.claim('propStrokeWidth');
    if (strokeWidth) session.bindNumber(strokeWidth, { channel: 'stroke.width', min: 0, max: 100, createCommand: value => update(node => ({ stroke: normalizeStroke({ ...normalizeStroke(node.stroke), width: value }) }), '修改线宽', 'stroke.width'), readModel: () => normalizeStroke(current()[0]?.stroke).width, refresh: { canvas: true, overlay: true } });
    const strokeColor = session.claim('propStrokeColor');
    if (strokeColor) session.bindSelect(strokeColor, { createCommand: value => update(node => ({ stroke: normalizeStroke({ ...normalizeStroke(node.stroke), color: normalizeStrokeColor(value) }) }), '修改描边颜色', 'stroke.color'), refresh: { canvas: true } });
    const strokeStyle = session.claim('propStrokeStyle');
    if (strokeStyle) session.bindSelect(strokeStyle, { createCommand: value => update(node => ({ stroke: normalizeStroke({ ...normalizeStroke(node.stroke), style: STROKE_STYLES.has(value) ? value : 'solid' }) }), '修改描边样式', 'stroke.style'), refresh: { canvas: true } });
    if (!FILLABLE_SHAPES.has(type)) return;
    const fillControl = session.claim('propFill');
    if (fillControl) session.bindSelect(fillControl, { createCommand: mode => update(node => ({ fill: normalizeFill({ ...normalizeFill(node.fill), mode }) }), '填充', 'fill.mode'), refresh: { canvas: true }, structural: true });
    const fillColor = session.claim('propFillColor');
    if (fillColor) session.bindSelect(fillColor, { createCommand: value => update(node => ({ fill: normalizeFill({ ...normalizeFill(node.fill), color: Number(value) === 0 ? 0 : 1 }) }), '填充颜色', 'fill.color'), refresh: { canvas: true } });
    this.bindDither(context, current, (key, value) => update(node => ({ dither: { ...(node.dither || M.defaultDither()), [key]: value } }), '修改抖动', `dither.${key}`));
    this.bindPattern(context, current, (key, value) => update(node => ({ pattern: { ...(node.pattern || M.defaultPattern()), [key]: value } }), '修改图案', `pattern.${key}`));
  }

  resizedPoints(points, count) {
    const result = (points || []).map(point => ({ ...point }));
    while (result.length < count) {
      const last = result.at(-1) || { x: 0, y: 0 }, previous = result.at(-2) || last;
      result.push({ x: last.x + (last.x - previous.x || 10), y: last.y + (last.y - previous.y) });
    }
    while (result.length > count) result.pop();
    return result;
  }

  pointFieldMarkup(index, point, locked = false) {
    return `<div class="point-row"><span>P${index + 1}</span>${field(`propPoint${index}X`, 'X', Math.round(Number(point?.x) || 0), { disabled: locked })}${field(`propPoint${index}Y`, 'Y', Math.round(Number(point?.y) || 0), { disabled: locked })}</div>`;
  }

  bindPolygon(context, polygonId) {
    const { editor, page, session } = context;
    const M = this.PE.model, C = this.PE.commands;
    const current = () => M.nodeById(editor.activePage(), polygonId);
    const bindCoordinates = () => {
      const polygon = current();
      if (!polygon?.points) return;
      polygon.points.forEach((_, index) => {
        for (const [suffix, key] of [['X', 'x'], ['Y', 'y']]) {
          const control = session.claim(`propPoint${index}${suffix}`);
          if (!control || control.disabled || control.dataset.propertyBound) continue;
          session.bindNumber(control, { channel: `points.${index}.${key}`, createCommand: value => new C.UpdateNodesCommand([polygonId], node => {
            const points = (node.points || []).map(point => ({ ...point }));
            if (!points[index]) return {};
            points[index][key] = value;
            return { points };
          }, page.id, '修改顶点', { historyChannel: `points.${index}.${key}` }), readModel: () => current()?.points?.[index]?.[key], refresh: { canvas: true, overlay: true } });
        }
      });
    };
    const count = session.claim('propPointCount');
    if (count) session.bindNumber(count, { channel: 'points.count', min: 3, max: 24, createCommand: value => new C.UpdateNodesCommand([polygonId], node => ({ points: this.resizedPoints(node.points, value) }), page.id, '顶点数量', { historyChannel: 'points.count' }), readModel: () => current()?.points?.length, refresh: { canvas: true, overlay: true }, afterPreview: () => {
      const list = context.properties.el?.querySelector?.('#polygonPointList'), latest = current();
      if (!list || !latest) return;
      list.innerHTML = latest.points.map((point, index) => this.pointFieldMarkup(index, point)).join('');
      bindCoordinates();
    } });
    bindCoordinates();
  }

  bindText(context) {
    const { editor, page, nodes, ids, session, allLocked } = context;
    if (allLocked) return;
    const M = this.PE.model, C = this.PE.commands, normalizeFill = this.PE.schemaV17.normalizeFill;
    const current = () => ids.map(id => M.nodeById(editor.activePage(), id)).filter(Boolean);
    const update = (patch, label, channel) => new C.UpdateNodesCommand(ids, patch, page.id, label, { historyChannel: channel });
    const text = session.claim('propText');
    if (text && nodes.length === 1) session.bindTextarea(text, { channel: 'text', createCommand: value => update({ text: value }, '文字', 'text'), refresh: { canvas: true, overlay: true } });
    const font = session.claim('propFont');
    if (font) session.bindSelect(font, { structural: true, createCommand: value => {
      const record = (editor.state.project.fonts || []).find(item => item.family === value);
      return update(node => ({ fontFamily: value, fixedFontSize: record?.fixedSize || null, fontSize: record?.fixedSize || node.fontSize }), '字体', 'fontFamily');
    }, refresh: { canvas: true, overlay: true } });
    for (const [controlId, key, min, max] of [['propFontSize', 'fontSize', 1, 200], ['propLetterSpacing', 'letterSpacing', -20, 100], ['propLineSpacing', 'lineSpacing', -20, 200]]) {
      const control = session.claim(controlId);
      if (control && !control.disabled) session.bindNumber(control, { channel: key, min, max, createCommand: value => update({ [key]: value }, '文字排版', key), readModel: () => current()[0]?.[key], refresh: { canvas: true, overlay: true } });
    }
    for (const [controlId, key] of [['propAlignH', 'alignH'], ['propAlignV', 'alignV']]) {
      const control = session.claim(controlId);
      if (control) session.bindSelect(control, { createCommand: value => update({ [key]: value }, '文字排版', key), refresh: { canvas: true } });
    }
    for (const [controlId, key] of [['propWrap', 'wrap'], ['propBold', 'bold'], ['propInvert', 'invert']]) {
      const control = session.claim(controlId);
      if (control) session.bindCheckbox(control, { createCommand: value => update({ [key]: value }, '文字排版', key), refresh: { canvas: true, overlay: key === 'wrap' } });
    }
    const fillControl = session.claim('propFill');
    if (fillControl) session.bindSelect(fillControl, { structural: true, createCommand: mode => update(node => ({ fill: normalizeFill({ ...normalizeFill(node.fill), mode }) }), '填充', 'fill.mode'), refresh: { canvas: true } });
    const fillColor = session.claim('propFillColor');
    if (fillColor) session.bindSelect(fillColor, { createCommand: value => update(node => ({ fill: normalizeFill({ ...normalizeFill(node.fill), color: Number(value) === 0 ? 0 : 1 }) }), '填充颜色', 'fill.color'), refresh: { canvas: true } });
    this.bindDither(context, current, (key, value) => update(node => ({ dither: { ...(node.dither || M.defaultDither()), [key]: value } }), '修改抖动', `dither.${key}`));
    this.bindPattern(context, current, (key, value) => update(node => ({ pattern: { ...(node.pattern || M.defaultPattern()), [key]: value } }), '修改图案', `pattern.${key}`));
  }

  bindImage(context) {
    const { editor, page, nodes, session, allLocked } = context;
    if (allLocked || nodes.length !== 1) return;
    const node = nodes[0], id = node.id, M = this.PE.model, C = this.PE.commands;
    const current = () => M.nodeById(editor.activePage(), id);
    const update = (key, value, label = '图片属性') => new C.UpdateNodesCommand([id], item => ({ image: { ...(item.image || {}), [key]: value } }), page.id, label, { historyChannel: `image.${key}` });
    const preview = () => { const latest = current(); if (latest) this.renderPreviews(context.properties, [latest]); };
    context.properties.el?.querySelector?.('#replaceImageBtn')?.addEventListener('click', () => editor.chooseReplacementImage(id));
    for (const [controlId, key] of [['propImageFit', 'fit'], ['propInterpolation', 'interpolation']]) {
      const control = session.claim(controlId);
      if (control) session.bindSelect(control, { createCommand: value => update(key, value), refresh: { canvas: true, overlay: key === 'fit' }, afterPreview: preview });
    }
    for (const [controlId, key, min, max] of [['propCropX', 'cropX', 0, Math.max(0, node.sourceWidth - 1)], ['propCropY', 'cropY', 0, Math.max(0, node.sourceHeight - 1)], ['propCropW', 'cropW', 1, Math.max(1, node.sourceWidth)], ['propCropH', 'cropH', 1, Math.max(1, node.sourceHeight)], ['propThreshold', 'threshold', 0, 255]]) {
      const control = session.claim(controlId);
      if (control) session.bindNumber(control, { channel: `image.${key}`, min, max, createCommand: value => update(key, value), readModel: () => current()?.image?.[key], refresh: { canvas: true }, afterPreview: preview });
    }
    const bw = session.claim('propBwMode');
    if (bw) session.bindSelect(bw, { createCommand: value => update('bwMode', value), refresh: { canvas: true }, structural: true, afterPreview: preview });
    const algorithm = session.claim('propImageDitherAlgorithm');
    if (algorithm) session.bindSelect(algorithm, { createCommand: value => update('ditherAlgorithm', value), refresh: { canvas: true }, structural: true, afterPreview: preview });
    const matrix = session.claim('propImageBayerMatrix');
    if (matrix) session.bindSelect(matrix, { createCommand: value => update('bayerMatrix', Number(value)), refresh: { canvas: true }, afterPreview: preview });
    const invert = session.claim('propImageInvert');
    if (invert) session.bindCheckbox(invert, { createCommand: value => update('invert', value, '图片反相'), refresh: { canvas: true }, afterPreview: preview });
  }

  bindType(context) {
    const type = context.nodes[0]?.type;
    if (SHAPE_TYPES.has(type)) this.bindShape(context);
    else if (type === 'text') this.bindText(context);
    else if (type === 'image') this.bindImage(context);
  }

  renderPreviews(properties, nodes) {
    if (nodes.length !== 1) return;
    const node = nodes[0], R = this.PE.renderer;
    const draw = (id, pixel) => {
      const canvas = properties.el.querySelector(`#${id}`);
      if (!canvas) return;
      const context = canvas.getContext('2d', { alpha: false }), image = context.createImageData(canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
        const value = pixel(x, y) ? 0 : 255, offset = (y * canvas.width + x) * 4;
        image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = value;
        image.data[offset + 3] = 255;
      }
      context.putImageData(image, 0, 0);
    };
    draw('ditherPreview', (x, y) => R.graphicDitherPixel(node.dither, x, y, x, y));
    draw('patternPreview', (x, y) => R.patternPixel(node.pattern, x, y, x, y));
    const canvas = properties.el.querySelector('#imageDitherPreview');
    if (canvas && node.type === 'image') {
      const rendered = R.ImageRenderer.render(node, properties.editor.state.assets);
      if (rendered) {
        const binary = R.ditherImageData(rendered.data, node.w, node.h, { algorithm: node.image?.ditherAlgorithm || 'bayer', bayerMatrix: node.image?.bayerMatrix || 4, invert: Boolean(node.image?.invert) });
        const temp = document.createElement('canvas');
        temp.width = node.w; temp.height = node.h;
        const tempContext = temp.getContext('2d'), image = tempContext.createImageData(node.w, node.h);
        for (let index = 0; index < binary.length; index += 1) {
          const value = binary[index] ? 0 : 255, offset = index * 4;
          image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = value;
          image.data[offset + 3] = 255;
        }
        tempContext.putImageData(image, 0, 0);
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = false;
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(temp, 0, 0, canvas.width, canvas.height);
      }
    }
  }
}

function installPropertySystem(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.ui?.Properties || !PE?.commands?.UpdateNodesCommand || !PE?.model?.TreeModel || !PE?.renderer?.FramebufferRenderer) {
    throw new Error('PixelEditor property system dependencies are not initialized');
  }
  if (PE.propertiesInstalled) return PE.properties;
  const provider = new PropertyProvider(PE);
  PE.propertiesInstalled = true;
  PE.properties = { PropertyDescriptor, PropertyProvider, PropertySession, provider, normalizeNumber };
  PE.shapeStyleProperties = { SHAPE_TYPES, FILLABLE_SHAPES };
  return PE.properties;
}

export { PropertyDescriptor, PropertyProvider, PropertySession, normalizeNumber, installPropertySystem };
