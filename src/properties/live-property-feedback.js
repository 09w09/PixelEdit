const LIVE_INPUT_TYPES = new Set(['number', 'text', 'search']);
const NAME_FIELDS = new Set(['propName', 'propPageName']);
const CANVAS_FREE_FIELDS = new Set(['propName', 'propPageName']);

function finiteInputValue(control) {
  if (control?.type !== 'number') return true;
  if (control.value === '') return false;
  const value = Number(control.value);
  if (!Number.isFinite(value)) return false;
  const min = control.min === '' ? null : Number(control.min);
  const max = control.max === '' ? null : Number(control.max);
  if (Number.isFinite(min) && value < min) return false;
  if (Number.isFinite(max) && value > max) return false;
  return true;
}

function isLiveInput(control) {
  if (!(control instanceof HTMLInputElement)) return false;
  if (!control.id || control.disabled || control.readOnly) return false;
  return LIVE_INPUT_TYPES.has(control.type);
}

function mergeRenderFlags(current = {}, next = {}) {
  return {
    canvas: Boolean(current.canvas || next.canvas),
    overlay: Boolean(current.overlay || next.overlay),
    previews: Boolean(current.previews || next.previews),
    layers: Boolean(current.layers || next.layers),
  };
}

function previewTargets(editor) {
  const page = editor.activePage?.();
  if (!page) return [];
  const model = globalThis.PixelEditor?.model;
  const nodes = (editor.state?.selection?.ids || [])
    .map(id => model?.nodeById?.(page, id))
    .filter(Boolean);
  if (nodes.length) return nodes;
  return editor.pageSelectedId === page.id ? [page] : [];
}

function installLivePropertyFeedbackRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Workspace = PE?.ui?.Workspace;
  if (!Workspace) throw new Error('PixelEditor live property dependencies are not initialized');
  if (PE.livePropertyFeedbackInstalled) return;
  PE.livePropertyFeedbackInstalled = true;

  Workspace.prototype.scheduleLiveFeedbackRender = function scheduleLiveFeedbackRender(options = {}) {
    this._liveFeedbackRenderFlags = mergeRenderFlags(this._liveFeedbackRenderFlags, {
      canvas: options.canvas !== false,
      overlay: options.overlay !== false,
      previews: options.previews !== false,
      layers: options.layers === true,
    });
    if (this._liveFeedbackFrame) return;
    const raf = target.requestAnimationFrame || (callback => target.setTimeout(callback, 0));
    this._liveFeedbackFrame = raf(() => {
      this._liveFeedbackFrame = null;
      const flags = this._liveFeedbackRenderFlags || {};
      this._liveFeedbackRenderFlags = null;
      if (flags.canvas) this.renderCanvas?.();
      if (flags.overlay) this.renderOverlay?.();
      if (flags.previews) this.properties?.renderPreviews?.(previewTargets(this));
      if (flags.layers) this.pageLayers?.render?.();
      const title = document.title || '400×300 黑白像素编辑器 V15';
      if (this.state?.dirty && !title.endsWith(' *')) document.title = `${title} *`;
    });
  };

  Workspace.prototype.withLiveFeedback = function withLiveFeedback(options, callback) {
    const previous = this._liveFeedbackContext;
    this._liveFeedbackContext = mergeRenderFlags(previous, options);
    try {
      return callback();
    } finally {
      this._liveFeedbackContext = previous;
    }
  };

  const previousExec = Workspace.prototype.exec;
  Workspace.prototype.exec = function execWithLiveFeedback(command) {
    const context = this._liveFeedbackContext;
    if (!context) return previousExec.call(this, command);
    PE.commandCoalescing?.attachSelectionBoundary?.(this);
    const beforePageId = this.state.project.activePageId;
    const changed = this.bus.execute(command);
    if (!changed) return false;
    if (this.state.project.activePageId !== beforePageId) this.pageSelectedId = this.state.project.activePageId;
    this.scheduleLiveFeedbackRender(context);
    return true;
  };

  function liveOptionsFor(control) {
    const nameOnly = CANVAS_FREE_FIELDS.has(control.id);
    return {
      canvas: !nameOnly,
      overlay: !nameOnly,
      previews: !nameOnly,
      layers: NAME_FIELDS.has(control.id),
    };
  }

  function bindProperties(editor) {
    const root = editor.properties?.el;
    if (!root || root.dataset.livePropertyFeedback === '1') return;
    root.dataset.livePropertyFeedback = '1';

    root.addEventListener('focusin', event => {
      const control = event.target;
      if (!isLiveInput(control) && control?.id !== 'propText') return;
      editor.bus.breakMergeChain?.(`live-property-start:${control.id}`);
    });

    root.addEventListener('input', event => {
      const control = event.target;
      if (!isLiveInput(control) || control.id === 'propText' || event.isComposing || !finiteInputValue(control)) return;
      editor.withLiveFeedback(liveOptionsFor(control), () => {
        control.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    root.addEventListener('focusout', event => {
      const control = event.target;
      if (!isLiveInput(control) && control?.id !== 'propText') return;
      editor.bus.breakMergeChain?.(`live-property-end:${control.id}`);
      editor.history?.render?.();
    });
  }

  function bindToolOptions(editor) {
    const root = editor.toolOptionsBar?.element;
    if (!root || root.dataset.liveToolFeedback === '1') return;
    root.dataset.liveToolFeedback = '1';
    root.addEventListener('input', event => {
      const control = event.target;
      if (!isLiveInput(control) || event.isComposing || !finiteInputValue(control)) return;
      const render = editor.toolOptionsBar?.render;
      if (typeof render !== 'function') return;
      editor.toolOptionsBar.render = () => {};
      try {
        control.dispatchEvent(new Event('change', { bubbles: true }));
      } finally {
        editor.toolOptionsBar.render = render;
      }
    });
  }

  const previousMount = Workspace.prototype.mount;
  Workspace.prototype.mount = function mountWithLivePropertyFeedback(...args) {
    const result = previousMount.apply(this, args);
    bindProperties(this);
    bindToolOptions(this);
    return result;
  };

  PE.livePropertyFeedback = {
    finiteInputValue,
    isLiveInput,
    previewTargets,
  };
}

export { finiteInputValue, isLiveInput, installLivePropertyFeedbackRuntime };
