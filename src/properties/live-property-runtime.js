const DEFAULT_REFRESH = Object.freeze({ canvas: true, overlay: true });
const SHAPE_TYPES = new Set(['line', 'rectangle', 'circle', 'polygon']);
const FILLABLE_SHAPES = new Set(['rectangle', 'circle', 'polygon']);
const STROKE_STYLES = new Set(['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot']);

function normalizeNumber(value, { min = -Infinity, max = Infinity, integer = true } = {}) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = integer ? Math.round(number) : number;
  return Math.max(min, Math.min(max, normalized));
}

function mergeRefresh(target, source = {}) {
  for (const key of ['canvas', 'overlay', 'previews', 'layers', 'properties', 'history']) {
    target[key] ||= Boolean(source[key]);
  }
  return target;
}

function scheduleRefresh(editor, refresh = DEFAULT_REFRESH, afterFrame = null) {
  if (!editor) return;
  const state = editor.__livePropertyRenderState || (editor.__livePropertyRenderState = {
    frame: 0,
    refresh: {},
    callbacks: new Set(),
  });
  mergeRefresh(state.refresh, refresh);
  if (typeof afterFrame === 'function') state.callbacks.add(afterFrame);
  if (state.frame) return;
  const requestFrame = typeof globalThis.requestAnimationFrame === 'function'
    ? callback => globalThis.requestAnimationFrame(callback)
    : callback => globalThis.setTimeout(callback, 0);
  state.frame = requestFrame(() => {
    state.frame = 0;
    const flags = state.refresh;
    state.refresh = {};
    if (flags.canvas) editor.renderCanvas?.();
    if (flags.overlay) editor.renderOverlay?.();
    if (flags.layers) editor.pageLayers?.render?.();
    if (flags.properties) editor.properties?.render?.();
    if (flags.history) editor.history?.render?.();
    const callbacks = [...state.callbacks];
    state.callbacks.clear();
    for (const callback of callbacks) callback();
  });
}

function execute(editor, command, refresh = DEFAULT_REFRESH, afterFrame = null) {
  if (!editor || !command) return false;
  globalThis.PixelEditor?.commandCoalescing?.attachSelectionBoundary?.(editor);
  const changed = editor.bus.execute(command);
  if (changed) scheduleRefresh(editor, refresh, afterFrame);
  return changed;
}

function sessionState(editor) {
  return editor.__livePropertySession || (editor.__livePropertySession = {
    control: null,
    channel: '',
  });
}

function beginEditorSession(editor, control, channel = '') {
  const session = sessionState(editor);
  if (session.control === control) return session;
  if (session.control) editor.bus?.breakMergeChain?.(`property-switch:${session.channel}`);
  session.control = control;
  session.channel = String(channel || control?.id || 'property');
  editor.bus?.breakMergeChain?.(`property-start:${session.channel}`);
  return session;
}

function endEditorSession(editor, reason = 'property-end') {
  if (!editor) return;
  const session = sessionState(editor);
  if (!session.control) return;
  const channel = session.channel;
  session.control = null;
  session.channel = '';
  editor.bus?.breakMergeChain?.(`${reason}:${channel}`);
  editor.history?.render?.();
}

function cloneControl(control) {
  if (!control?.parentNode) return control;
  const clone = control.cloneNode(true);
  if ('value' in control) clone.value = control.value;
  if ('checked' in control) clone.checked = control.checked;
  if ('indeterminate' in control) clone.indeterminate = control.indeterminate;
  control.parentNode.replaceChild(clone, control);
  return clone;
}

function markBound(control, kind) {
  if (control?.dataset) control.dataset.liveProperty = kind;
  return control;
}

function bindNumber(control, {
  editor,
  channel = control?.id || 'number',
  min = -Infinity,
  max = Infinity,
  integer = true,
  wheel = true,
  createCommand,
  readModel,
  refresh = DEFAULT_REFRESH,
  afterPreview,
  afterEnd,
} = {}) {
  if (!control || !editor || typeof createCommand !== 'function') return control;
  markBound(control, 'number');
  let composing = false;

  const begin = () => beginEditorSession(editor, control, channel);
  const preview = () => {
    if (composing) return false;
    const value = normalizeNumber(control.value, { min, max, integer });
    if (value == null) return false;
    begin();
    const canonical = String(value);
    if (control.value !== canonical) control.value = canonical;
    return execute(editor, createCommand(value), refresh, afterPreview);
  };
  const restore = () => {
    if (normalizeNumber(control.value, { min, max, integer }) != null) return;
    const value = typeof readModel === 'function' ? readModel() : null;
    if (value != null && Number.isFinite(Number(value))) control.value = String(value);
  };
  const end = reason => {
    restore();
    if (typeof afterEnd === 'function') afterEnd(control);
    endEditorSession(editor, reason);
  };

  control.addEventListener('focus', begin);
  control.addEventListener('compositionstart', () => { composing = true; });
  control.addEventListener('compositionend', () => { composing = false; preview(); });
  control.addEventListener('input', preview);
  control.addEventListener('change', preview);
  control.addEventListener('wheel', event => {
    if (!wheel || globalThis.document?.activeElement !== control || event.deltaY === 0) return;
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
  control.addEventListener('blur', () => end('property-blur'));
  return control;
}

function bindText(control, {
  editor,
  channel = control?.id || 'text',
  createCommand,
  refresh = DEFAULT_REFRESH,
  afterPreview,
} = {}) {
  if (!control || !editor || typeof createCommand !== 'function') return control;
  markBound(control, 'text');
  const begin = () => beginEditorSession(editor, control, channel);
  const preview = () => {
    begin();
    return execute(editor, createCommand(control.value), refresh, afterPreview);
  };
  control.addEventListener('focus', begin);
  control.addEventListener('input', preview);
  control.addEventListener('change', preview);
  control.addEventListener('blur', () => endEditorSession(editor, 'property-blur'));
  return control;
}

function bindTextarea(control, options = {}) {
  if (!control || !options.editor || typeof options.createCommand !== 'function') return control;
  markBound(control, 'textarea');
  const editor = options.editor;
  const channel = options.channel || control.id || 'textarea';
  let composing = false;
  const begin = () => beginEditorSession(editor, control, channel);
  const preview = () => {
    if (composing) return false;
    begin();
    return execute(editor, options.createCommand(control.value), options.refresh || DEFAULT_REFRESH, options.afterPreview);
  };
  control.addEventListener('focus', begin);
  control.addEventListener('compositionstart', () => { composing = true; });
  control.addEventListener('input', event => { if (!composing && !event.isComposing) preview(); });
  control.addEventListener('compositionend', () => { composing = false; preview(); });
  control.addEventListener('change', () => { if (!composing) preview(); });
  control.addEventListener('blur', () => { if (!composing) preview(); endEditorSession(editor, 'property-blur'); });
  return control;
}

function bindSelect(control, { editor, createCommand, refresh = DEFAULT_REFRESH, structural = false, afterPreview } = {}) {
  if (!control || !editor || typeof createCommand !== 'function') return control;
  markBound(control, 'select');
  control.addEventListener('change', () => {
    endEditorSession(editor, 'property-discrete');
    editor.bus?.breakMergeChain?.(`property-select:${control.id}`);
    const changed = execute(editor, createCommand(control.value), structural ? { ...refresh, properties: true, history: true } : refresh, afterPreview);
    editor.bus?.breakMergeChain?.(`property-select-end:${control.id}`);
    if (!structural) editor.history?.render?.();
    return changed;
  });
  return control;
}

function bindCheckbox(control, { editor, createCommand, refresh = DEFAULT_REFRESH, structural = false, afterPreview } = {}) {
  if (!control || !editor || typeof createCommand !== 'function') return control;
  markBound(control, 'checkbox');
  control.addEventListener('change', () => {
    endEditorSession(editor, 'property-discrete');
    editor.bus?.breakMergeChain?.(`property-checkbox:${control.id}`);
    const changed = execute(editor, createCommand(Boolean(control.checked)), structural ? { ...refresh, properties: true, history: true } : refresh, afterPreview);
    editor.bus?.breakMergeChain?.(`property-checkbox-end:${control.id}`);
    if (!structural) editor.history?.render?.();
    return changed;
  });
  return control;
}

function selectionBounds(editor, ids = editor.state.selection.ids) {
  const PE = globalThis.PixelEditor;
  const page = editor.activePage();
  const boxes = ids.map(id => PE.renderer.FramebufferRenderer.visualBounds(id, {
    project: editor.state.project,
    pageId: page.id,
    assets: editor.state.assets,
  })).filter(box => box && box.w > 0 && box.h > 0);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(box => box.x));
  const y = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.w));
  const bottom = Math.max(...boxes.map(box => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

function axisCommand(editor, axis, targetValue) {
  const PE = globalThis.PixelEditor;
  const M = PE.model;
  const C = PE.commands;
  const R = PE.renderer;
  const page = editor.activePage();
  const tree = new M.TreeModel(page);
  const roots = editor.state.selection.transformRoots(tree);
  return {
    label: '设置位置',
    mergeDescriptor: { operation: 'property', targets: roots, channel: axis },
    execute: state => {
      const currentPage = M.pageById(state.project, page.id);
      if (!currentPage) return false;
      const currentTree = new M.TreeModel(currentPage);
      let changed = false;
      for (const id of roots) {
        if (currentTree.isEffectivelyLocked(id)) continue;
        const bounds = R.FramebufferRenderer.visualBounds(id, {
          project: state.project,
          pageId: currentPage.id,
          assets: state.assets,
        });
        const delta = Math.round(targetValue - bounds[axis]);
        if (!delta) continue;
        C.moveNodeTree(currentPage, id, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0, currentTree);
        changed = true;
      }
      return changed;
    },
  };
}

function sizeCommand(editor, axis, value, ids) {
  const PE = globalThis.PixelEditor;
  const C = PE.commands;
  const page = editor.activePage();
  return new C.UpdateNodesCommand(ids, node => {
    if (node.type === 'raster' && PE.rasterLayer?.resizeRaster) {
      const geometry = { x: node.x, y: node.y, w: node.w, h: node.h };
      geometry[axis] = value;
      if (node.aspectLocked) {
        const ratio = node.w / Math.max(1, node.h);
        if (axis === 'w') geometry.h = Math.max(1, Math.round(value / ratio));
        else geometry.w = Math.max(1, Math.round(value * ratio));
      }
      return PE.rasterLayer.resizeRaster(node, geometry);
    }
    const ratio = node.w / Math.max(1, node.h);
    if (axis === 'w') return node.aspectLocked
      ? { w: value, h: Math.max(1, Math.round(value / ratio)) }
      : { w: value };
    return node.aspectLocked
      ? { h: value, w: Math.max(1, Math.round(value * ratio)) }
      : { h: value };
  }, page.id, '调整尺寸', { historyChannel: axis });
}

function createClaim(root) {
  const claimed = new Map();
  return id => {
    if (claimed.has(id)) return claimed.get(id);
    const existing = root?.querySelector?.(`#${id}`);
    if (!existing) return null;
    const control = cloneControl(existing);
    claimed.set(id, control);
    return control;
  };
}

function previewCallback(properties, values) {
  return () => properties.renderPreviews?.(typeof values === 'function' ? values() : values);
}

function bindDitherControls(properties, targets, createCommand, claim) {
  const editor = properties.editor;
  const current = () => typeof targets === 'function' ? targets() : targets;
  const afterPreview = previewCallback(properties, current);
  const numberFields = [
    ['propDitherDensity', 'density', 0, 100],
    ['propDitherOffsetX', 'offsetX', -Infinity, Infinity],
    ['propDitherOffsetY', 'offsetY', -Infinity, Infinity],
  ];
  for (const [id, key, min, max] of numberFields) {
    const control = claim(id);
    if (!control) continue;
    bindNumber(control, {
      editor,
      channel: `dither.${key}`,
      min,
      max,
      createCommand: value => createCommand(key, value),
      readModel: () => current()?.[0]?.dither?.[key],
      refresh: { canvas: true },
      afterPreview,
    });
  }
  for (const [id, key, parse] of [
    ['propDitherType', 'type', value => value],
    ['propDitherMatrix', 'matrix', value => Number(value)],
    ['propDitherAlign', 'align', value => value],
  ]) {
    const control = claim(id);
    if (!control) continue;
    bindSelect(control, {
      editor,
      createCommand: raw => createCommand(key, parse(raw)),
      refresh: { canvas: true },
      afterPreview,
    });
  }
}

function bindPatternControls(properties, targets, createCommand, claim) {
  const editor = properties.editor;
  const current = () => typeof targets === 'function' ? targets() : targets;
  const afterPreview = previewCallback(properties, current);
  for (const [id, key, min, max] of [
    ['propPatternLineWidth', 'lineWidth', 1, 16],
    ['propPatternGap', 'gap', 0, 32],
    ['propPatternOffsetX', 'offsetX', -Infinity, Infinity],
    ['propPatternOffsetY', 'offsetY', -Infinity, Infinity],
  ]) {
    const control = claim(id);
    if (!control) continue;
    bindNumber(control, {
      editor,
      channel: `pattern.${key}`,
      min,
      max,
      createCommand: value => createCommand(key, value),
      readModel: () => current()?.[0]?.pattern?.[key],
      refresh: { canvas: true },
      afterPreview,
    });
  }
  for (const [id, key] of [['propPatternType', 'type'], ['propPatternAlign', 'align']]) {
    const control = claim(id);
    if (!control) continue;
    bindSelect(control, {
      editor,
      createCommand: value => createCommand(key, value),
      refresh: { canvas: true },
      afterPreview,
    });
  }
}

function bindPageControls(properties, page, claim) {
  const editor = properties.editor;
  const PE = globalThis.PixelEditor;
  const C = PE.commands;
  const M = PE.model;
  const normalizeFill = PE.schemaV17?.normalizeFill;
  const currentPage = () => M.pageById(editor.state.project, page.id);
  const pageCommand = (patch, label, channel) => new C.UpdatePageCommand(page.id, patch, label, { historyChannel: channel });

  const name = claim('propPageName');
  if (name) bindText(name, {
    editor,
    channel: 'page.name',
    createCommand: value => pageCommand({ name: value }, '重命名页面', 'name'),
    refresh: { layers: true },
  });

  const locked = claim('propPageLocked');
  if (locked) bindCheckbox(locked, {
    editor,
    createCommand: value => pageCommand({ locked: value }, value ? '锁定页面' : '解锁页面', 'locked'),
    refresh: { canvas: true, overlay: true, layers: true },
    structural: true,
  });
  if (currentPage()?.locked) return;

  const fill = claim('propFill');
  if (fill) bindSelect(fill, {
    editor,
    createCommand: mode => pageCommand(current => ({
      fill: { ...normalizeFill(current.fill, { background: true }), mode },
    }), '背景填充', 'fill.mode'),
    refresh: { canvas: true },
    structural: true,
  });

  const solid = claim('propBgSolid');
  if (solid) bindSelect(solid, {
    editor,
    createCommand: value => pageCommand(current => ({
      fill: { ...normalizeFill(current.fill, { background: true }), mode: 'solid', color: Number(value) === 1 ? 1 : 0 },
    }), '背景颜色', 'fill.color'),
    refresh: { canvas: true },
  });

  const ditherCommand = (key, value) => pageCommand(current => ({
    dither: { ...(current.dither || M.defaultDither()), [key]: value },
  }), '修改背景抖动', `dither.${key}`);
  bindDitherControls(properties, () => [currentPage()], ditherCommand, claim);

  const patternCommand = (key, value) => pageCommand(current => ({
    pattern: { ...(current.pattern || M.defaultPattern()), [key]: value },
  }), '修改背景图案', `pattern.${key}`);
  bindPatternControls(properties, () => [currentPage()], patternCommand, claim);
}

function bindGenericElementControls(properties, nodes, claim) {
  const editor = properties.editor;
  const PE = globalThis.PixelEditor;
  const C = PE.commands;
  const M = PE.model;
  const page = editor.activePage();
  const ids = nodes.map(node => node.id);
  const currentNodes = () => ids.map(id => M.nodeById(editor.activePage(), id)).filter(Boolean);
  const tree = new M.TreeModel(page);
  const allLocked = nodes.every(node => tree.isEffectivelyLocked(node.id));

  const name = claim('propName');
  if (name && !name.disabled && nodes.length === 1) bindText(name, {
    editor,
    channel: 'name',
    createCommand: value => new C.UpdateNodesCommand(ids, { name: value }, page.id, '重命名图层', { historyChannel: 'name' }),
    refresh: { layers: true },
  });

  const visible = claim('propVisible');
  if (visible) bindCheckbox(visible, {
    editor,
    createCommand: value => new C.SetVisibilityCommand(ids, value, page.id),
    refresh: { canvas: true, overlay: true, layers: true },
  });

  const locked = claim('propLocked');
  if (locked) bindCheckbox(locked, {
    editor,
    createCommand: value => new C.ToggleLockCommand(ids, value, page.id),
    refresh: { canvas: false, overlay: true, layers: true },
    structural: true,
  });
  if (allLocked) return;

  for (const axis of ['x', 'y']) {
    const control = claim(`prop${axis.toUpperCase()}`);
    if (!control || control.disabled) continue;
    bindNumber(control, {
      editor,
      channel: axis,
      createCommand: value => axisCommand(editor, axis, value),
      readModel: () => selectionBounds(editor)?.[axis],
      refresh: { canvas: true, overlay: true },
    });
  }

  const sizableIds = ids.filter(id => ['rectangle', 'circle', 'text', 'image', 'raster'].includes(M.nodeById(page, id)?.type));
  if (sizableIds.length === ids.length) {
    for (const axis of ['w', 'h']) {
      const control = claim(`prop${axis.toUpperCase()}`);
      if (!control || control.disabled) continue;
      bindNumber(control, {
        editor,
        channel: axis,
        min: 1,
        max: axis === 'w' ? 400 : 300,
        createCommand: value => sizeCommand(editor, axis, value, sizableIds),
        readModel: () => selectionBounds(editor)?.[axis],
        refresh: { canvas: true, overlay: true },
      });
    }
    const aspect = claim('propAspect');
    if (aspect && !aspect.disabled) bindCheckbox(aspect, {
      editor,
      createCommand: value => new C.UpdateNodesCommand(ids, { aspectLocked: value }, page.id, '锁定比例', { historyChannel: 'aspectLocked' }),
      refresh: {},
    });
  }

  return currentNodes;
}

function bindShapeControls(properties, nodes, claim) {
  if (!nodes.length || !nodes.every(node => node.type === nodes[0].type && SHAPE_TYPES.has(node.type))) return;
  const editor = properties.editor;
  const PE = globalThis.PixelEditor;
  const C = PE.commands;
  const M = PE.model;
  const page = editor.activePage();
  const ids = nodes.map(node => node.id);
  const type = nodes[0].type;
  const normalizeStroke = PE.strokeStyle?.normalizeStroke || PE.schemaV17?.normalizeStroke;
  const normalizeFill = PE.schemaV17?.normalizeFill;
  const normalizeStrokeColor = value => value === 'transparent' ? 'transparent' : Number(value) === 0 ? 0 : 1;
  const currentNodes = () => ids.map(id => M.nodeById(editor.activePage(), id)).filter(Boolean);

  const update = (patch, label, channel) => new C.UpdateNodesCommand(ids, patch, page.id, label, { historyChannel: channel });

  if (type === 'line') {
    for (const [id, key] of [['propX1', 'x1'], ['propY1', 'y1'], ['propX2', 'x2'], ['propY2', 'y2']]) {
      const control = claim(id);
      if (!control) continue;
      bindNumber(control, {
        editor,
        channel: key,
        min: -9999,
        max: 9999,
        createCommand: value => update({ [key]: value }, '修改直线', key),
        readModel: () => currentNodes()?.[0]?.[key],
        refresh: { canvas: true, overlay: true },
      });
    }
  }

  if (type === 'rectangle') {
    for (const [id, key] of [['propRTL', 'rTL'], ['propRTR', 'rTR'], ['propRBL', 'rBL'], ['propRBR', 'rBR']]) {
      const control = claim(id);
      if (!control) continue;
      bindNumber(control, {
        editor,
        channel: key,
        min: 0,
        max: 200,
        createCommand: value => update({ [key]: value }, '修改圆角', key),
        readModel: () => currentNodes()?.[0]?.[key],
        refresh: { canvas: true, overlay: true },
      });
    }
  }

  const strokeWidth = claim('propStrokeWidth');
  if (strokeWidth) bindNumber(strokeWidth, {
    editor,
    channel: 'stroke.width',
    min: 0,
    max: 100,
    createCommand: value => update(node => ({
      stroke: normalizeStroke({ ...normalizeStroke(node.stroke), width: value }),
    }), '修改线宽', 'stroke.width'),
    readModel: () => normalizeStroke(currentNodes()?.[0]?.stroke).width,
    refresh: { canvas: true, overlay: true },
  });

  const strokeColor = claim('propStrokeColor');
  if (strokeColor) bindSelect(strokeColor, {
    editor,
    createCommand: value => update(node => ({
      stroke: normalizeStroke({ ...normalizeStroke(node.stroke), color: normalizeStrokeColor(value) }),
    }), '修改描边颜色', 'stroke.color'),
    refresh: { canvas: true },
  });

  const strokeStyle = claim('propStrokeStyle');
  if (strokeStyle) bindSelect(strokeStyle, {
    editor,
    createCommand: value => update(node => ({
      stroke: normalizeStroke({ ...normalizeStroke(node.stroke), style: STROKE_STYLES.has(value) ? value : 'solid' }),
    }), '修改描边样式', 'stroke.style'),
    refresh: { canvas: true },
  });

  if (!FILLABLE_SHAPES.has(type)) return;

  const fill = claim('propFill');
  if (fill) bindSelect(fill, {
    editor,
    createCommand: mode => update(node => ({
      fill: normalizeFill({ ...normalizeFill(node.fill), mode }),
    }), '填充', 'fill.mode'),
    refresh: { canvas: true },
    structural: true,
  });

  const fillColor = claim('propFillColor');
  if (fillColor) bindSelect(fillColor, {
    editor,
    createCommand: value => update(node => ({
      fill: normalizeFill({ ...normalizeFill(node.fill), color: Number(value) === 0 ? 0 : 1 }),
    }), '填充颜色', 'fill.color'),
    refresh: { canvas: true },
  });

  const ditherCommand = (key, value) => update(node => ({
    dither: { ...(node.dither || M.defaultDither()), [key]: value },
  }), '修改抖动', `dither.${key}`);
  bindDitherControls(properties, currentNodes, ditherCommand, claim);

  const patternCommand = (key, value) => update(node => ({
    pattern: { ...(node.pattern || M.defaultPattern()), [key]: value },
  }), '修改图案', `pattern.${key}`);
  bindPatternControls(properties, currentNodes, patternCommand, claim);
}

function bindAllPropertyControls(properties) {
  const editor = properties.editor;
  const PE = globalThis.PixelEditor;
  const M = PE.model;
  const page = editor.activePage();
  const ids = editor.state.selection.ids;
  const claim = createClaim(properties.el);

  if (editor.pageSelectedId === page.id && !ids.length) {
    bindPageControls(properties, page, claim);
    return;
  }
  const nodes = ids.map(id => M.nodeById(page, id)).filter(Boolean);
  if (!nodes.length) return;
  bindGenericElementControls(properties, nodes, claim);
  bindShapeControls(properties, nodes, claim);
}

function installLivePropertyRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Properties = PE?.ui?.Properties;
  if (!Properties || !PE?.commands?.UpdateNodesCommand) throw new Error('PixelEditor live property dependencies are not initialized');
  if (PE.livePropertiesInstalled) return;
  PE.livePropertiesInstalled = true;

  const originalRender = Properties.prototype.render;
  Properties.prototype.render = function renderWithLiveProperties(...args) {
    endEditorSession(this.editor, 'properties-render');
    const result = originalRender.apply(this, args);
    bindAllPropertyControls(this);
    return result;
  };

  const originalRenderPage = Properties.prototype.renderPage;
  Properties.prototype.renderPage = function renderPageWithLiveProperties(...args) {
    const result = originalRenderPage.apply(this, args);
    if (this.editor?.properties !== this) bindAllPropertyControls(this);
    return result;
  };

  PE.liveProperties = {
    normalizeNumber,
    scheduleRefresh,
    execute,
    beginEditorSession,
    endEditorSession,
    cloneControl,
    bindNumber,
    bindText,
    bindTextarea,
    bindSelect,
    bindCheckbox,
    selectionBounds,
    axisCommand,
    sizeCommand,
    createClaim,
    bindAllPropertyControls,
  };
}

export {
  normalizeNumber,
  scheduleRefresh,
  execute,
  beginEditorSession,
  endEditorSession,
  cloneControl,
  bindNumber,
  bindText,
  bindTextarea,
  bindSelect,
  bindCheckbox,
  installLivePropertyRuntime,
};
