const DEFAULT_REFRESH = Object.freeze({ canvas: true, overlay: true });

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
  let composing = false;

  const begin = () => beginEditorSession(editor, control, channel);
  const preview = () => {
    if (composing) return false;
    const value = normalizeNumber(control.value, { min, max, integer });
    if (value == null) return false;
    begin();
    const canonical = String(value);
    if (control.value !== canonical) control.value = canonical;
    const changed = execute(editor, createCommand(value), refresh, afterPreview);
    if (changed && typeof afterPreview === 'function') afterPreview(value, control);
    return changed;
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
  readModel,
  refresh = DEFAULT_REFRESH,
  afterPreview,
} = {}) {
  if (!control || !editor || typeof createCommand !== 'function') return control;
  const begin = () => beginEditorSession(editor, control, channel);
  const preview = () => {
    begin();
    const changed = execute(editor, createCommand(control.value), refresh, afterPreview);
    if (changed && typeof afterPreview === 'function') afterPreview(control.value, control);
    return changed;
  };
  control.addEventListener('focus', begin);
  control.addEventListener('input', preview);
  control.addEventListener('blur', () => {
    if (control.value == null && typeof readModel === 'function') control.value = String(readModel() ?? '');
    endEditorSession(editor, 'property-blur');
  });
  return control;
}

function bindTextarea(control, options = {}) {
  if (!control || !options.editor || typeof options.createCommand !== 'function') return control;
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
  control.addEventListener('blur', () => { if (!composing) preview(); endEditorSession(editor, 'property-blur'); });
  return control;
}

function bindSelect(control, { editor, createCommand, refresh = DEFAULT_REFRESH, structural = false, afterPreview } = {}) {
  if (!control || !editor || typeof createCommand !== 'function') return control;
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
  const M = PE.model;
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

function takeoverControl(root, id) {
  const control = root?.querySelector?.(`#${id}`);
  return control ? cloneControl(control) : null;
}

function bindCoreElementControls(properties) {
  const editor = properties.editor;
  const PE = globalThis.PixelEditor;
  const M = PE.model;
  const page = editor.activePage();
  const ids = editor.state.selection.ids;
  const nodes = ids.map(id => M.nodeById(page, id)).filter(Boolean);
  if (!nodes.length) return;
  const tree = new M.TreeModel(page);
  if (nodes.every(node => tree.isEffectivelyLocked(node.id))) return;

  for (const axis of ['x', 'y']) {
    const id = `prop${axis.toUpperCase()}`;
    const control = takeoverControl(properties.el, id);
    if (!control) continue;
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
      const id = `prop${axis.toUpperCase()}`;
      const control = takeoverControl(properties.el, id);
      if (!control) continue;
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
  }
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
    bindCoreElementControls(this);
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
    takeoverControl,
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
