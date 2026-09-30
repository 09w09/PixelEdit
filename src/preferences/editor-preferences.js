const PREFERENCE_KEY = 'pixeledit:v17:preferences';
const AUTOSAVE_KEY = 'pixel-editor-v17-autosave';
const DEFAULT_FILENAME = 'pixel-project-v17.pix';
const STROKE_STYLES = new Set(['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot']);
const TOOL_FILL_MODES = new Set(['transparent', 'solid']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const integer = (value, fallback, min = -Infinity, max = Infinity) => {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(Math.round(number), min, max) : fallback;
};
const number = (value, fallback, min = -Infinity, max = Infinity) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
};

function defaultEditorPreferences() {
  return {
    workspace: { leftWidth: 260, rightWidth: 320, leftSplit: 0.5, rightSplit: 0.5 },
    tools: {
      pencil: { width: 1, color: 1 },
      eraser: { width: 1 },
      line: { width: 1, color: 1, style: 'solid' },
      rectangle: { width: 1, color: 1, style: 'solid', fill: { mode: 'transparent', color: 1 } },
      circle: { width: 1, color: 1, style: 'solid', fill: { mode: 'transparent', color: 1 } },
      polygon: { width: 1, color: 1, style: 'solid', fill: { mode: 'transparent', color: 1 } },
      text: { fontFamily: 'sans-serif', fontSize: 16, lastScalableFontSize: 16 },
    },
    transparencyPreview: false,
  };
}

function normalizeTool(tool, input, fallback) {
  const source = input && typeof input === 'object' ? input : {};
  const out = structuredClone(fallback);
  if ('width' in fallback) out.width = integer(source.width, fallback.width, 1, 100);
  if ('color' in fallback) out.color = Number(source.color) === 0 ? 0 : 1;
  if ('style' in fallback) out.style = STROKE_STYLES.has(source.style) ? source.style : fallback.style;
  if ('fill' in fallback) {
    const fill = source.fill && typeof source.fill === 'object' ? source.fill : {};
    out.fill = {
      mode: TOOL_FILL_MODES.has(fill.mode) ? fill.mode : fallback.fill.mode,
      color: Number(fill.color) === 0 ? 0 : 1,
    };
  }
  if (tool === 'text') {
    out.fontFamily = typeof source.fontFamily === 'string' && source.fontFamily.trim() ? source.fontFamily : fallback.fontFamily;
    out.fontSize = integer(source.fontSize, fallback.fontSize, 1, 200);
    out.lastScalableFontSize = integer(source.lastScalableFontSize, fallback.lastScalableFontSize, 1, 200);
  }
  return out;
}

function normalizePreferences(input) {
  const defaults = defaultEditorPreferences();
  const source = input && typeof input === 'object' ? input : {};
  const workspace = source.workspace && typeof source.workspace === 'object' ? source.workspace : {};
  const tools = source.tools && typeof source.tools === 'object' ? source.tools : {};
  const out = defaultEditorPreferences();
  out.workspace = {
    leftWidth: integer(workspace.leftWidth, defaults.workspace.leftWidth, 170, 520),
    rightWidth: integer(workspace.rightWidth, defaults.workspace.rightWidth, 170, 520),
    leftSplit: number(workspace.leftSplit, defaults.workspace.leftSplit, 0.1, 0.9),
    rightSplit: number(workspace.rightSplit, defaults.workspace.rightSplit, 0.1, 0.9),
  };
  for (const [tool, fallback] of Object.entries(defaults.tools)) out.tools[tool] = normalizeTool(tool, tools[tool], fallback);
  out.transparencyPreview = source.transparencyPreview === true;
  return out;
}

function storageOrNull(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function loadEditorPreferences(storage) {
  const target = storageOrNull(storage);
  try {
    const raw = target?.getItem?.(PREFERENCE_KEY);
    if (!raw) return defaultEditorPreferences();
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return defaultEditorPreferences();
  }
}

function saveEditorPreferences(preferences, storage) {
  const target = storageOrNull(storage);
  try {
    target?.setItem?.(PREFERENCE_KEY, JSON.stringify(normalizePreferences(preferences)));
    return Boolean(target);
  } catch {
    return false;
  }
}

function mergeObjects(base, patch) {
  const output = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object') {
      output[key] = mergeObjects(base[key], value);
    } else output[key] = value;
  }
  return output;
}

function updateEditorPreferences(current, patch) {
  return normalizePreferences(mergeObjects(normalizePreferences(current), patch));
}

function installEditorPreferencesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.model || !PE?.persistence || !PE?.ui?.Workspace || !PE?.schemaV17) {
    throw new Error('PixelEditor V17 schema is not initialized');
  }
  if (PE.editorPreferencesInstalled) return;
  PE.editorPreferencesInstalled = true;
  PE.preferences = {
    PREFERENCE_KEY,
    AUTOSAVE_KEY,
    DEFAULT_FILENAME,
    defaultEditorPreferences,
    loadEditorPreferences,
    saveEditorPreferences,
    updateEditorPreferences,
    normalizePreferences,
  };

  const P = PE.persistence;
  const Workspace = PE.ui.Workspace;

  const BaseProjectFiles = P.ProjectFiles;
  P.ProjectFiles = class ProjectFilesV17 extends BaseProjectFiles {
    async saveAs() {
      const picker = this.io?.showSaveFilePicker || target.showSaveFilePicker;
      if (!picker) throw new Error('save picker unavailable');
      const handle = await picker({
        suggestedName: this.state.projectFileName?.endsWith('.pix') ? this.state.projectFileName : DEFAULT_FILENAME,
        types: [P.PIX_FILE_TYPE],
      });
      if (!handle) return null;
      const raw = this.serialize();
      await this.write(handle, raw);
      this.state.projectFileHandle = handle;
      this.state.projectFileName = handle.name || DEFAULT_FILENAME;
      this.state.dirty = false;
      return raw;
    }
  };

  P.Autosave = class AutosaveV17 {
    constructor(state, storage = null, key = AUTOSAVE_KEY) {
      this.state = state;
      this.key = key;
      if (storage) this.storage = storage;
      else { try { this.storage = target.localStorage; } catch { this.storage = null; } }
    }
    run() {
      const raw = P.ProjectSerializer.serialize(this.state.project, this.state.assets);
      try { this.storage?.setItem(this.key, raw); } catch {}
      return raw;
    }
    read() {
      try {
        const raw = this.storage?.getItem(this.key);
        return raw ? P.ProjectSerializer.deserialize(raw) : null;
      } catch { return null; }
    }
    clear() { try { this.storage?.removeItem(this.key); } catch {} return true; }
    has() { try { return Boolean(this.storage?.getItem(this.key)); } catch { return false; } }
  };

  const oldMount = Workspace.prototype.mount;
  Workspace.prototype.mount = function mountV17Preferences() {
    this.editorPreferences = loadEditorPreferences();
    return oldMount.call(this);
  };

  Workspace.prototype.updateWorkspaceLayout = function updateWorkspaceLayout(patch = {}) {
    this.editorPreferences = updateEditorPreferences(this.editorPreferences, { workspace: patch });
    saveEditorPreferences(this.editorPreferences);
    this.applyLayout();
    this.renderRulers?.();
    return structuredClone(this.editorPreferences.workspace);
  };

  Workspace.prototype.applyLayout = function applyLayoutV17() {
    if (!this.editorPreferences) this.editorPreferences = loadEditorPreferences();
    const layout = this.editorPreferences.workspace;
    document.documentElement.style.setProperty('--left-w', `${layout.leftWidth}px`);
    document.documentElement.style.setProperty('--right-w', `${layout.rightWidth}px`);
    const leftTop = document.querySelector('#leftTopPane');
    const leftBottom = document.querySelector('#leftBottomPane');
    const rightTop = document.querySelector('#rightTopPane');
    const rightBottom = document.querySelector('#rightBottomPane');
    if (leftTop) leftTop.style.flex = `${layout.leftSplit} 1 0`;
    if (leftBottom) leftBottom.style.flex = `${1 - layout.leftSplit} 1 0`;
    if (rightTop) rightTop.style.flex = `${layout.rightSplit} 1 0`;
    if (rightBottom) rightBottom.style.flex = `${1 - layout.rightSplit} 1 0`;
  };

  Workspace.prototype.setupDockSplitters = function setupDockSplittersV17() {
    const width = (selector, key, direction) => {
      const element = document.querySelector(selector);
      if (!element) return;
      let active = false;
      let startX = 0;
      let start = 0;
      element.onpointerdown = event => {
        active = true;
        startX = event.clientX;
        start = this.editorPreferences.workspace[key];
        element.setPointerCapture?.(event.pointerId);
      };
      element.onpointermove = event => {
        if (!active) return;
        this.updateWorkspaceLayout({ [key]: start + (event.clientX - startX) * direction });
      };
      element.onpointerup = () => { active = false; };
      element.onpointercancel = () => { active = false; };
    };
    width('#leftWidthSplitter', 'leftWidth', 1);
    width('#rightWidthSplitter', 'rightWidth', -1);

    const split = (selector, key, containerSelector) => {
      const element = document.querySelector(selector);
      const container = document.querySelector(containerSelector);
      if (!element || !container) return;
      let active = false;
      element.onpointerdown = event => {
        active = true;
        element.setPointerCapture?.(event.pointerId);
      };
      element.onpointermove = event => {
        if (!active) return;
        const rect = container.getBoundingClientRect();
        const min = Math.min(0.45, 120 / Math.max(1, rect.height));
        const value = clamp((event.clientY - rect.top) / Math.max(1, rect.height), min, 1 - min);
        this.updateWorkspaceLayout({ [key]: value });
      };
      element.onpointerup = () => { active = false; };
      element.onpointercancel = () => { active = false; };
    };
    split('#leftPaneSplitter', 'leftSplit', '#leftSidebar');
    split('#rightPaneSplitter', 'rightSplit', '#rightSidebar');
  };

  const oldRenderAll = Workspace.prototype.renderAll;
  Workspace.prototype.renderAll = function renderAllV17(options = {}) {
    const result = oldRenderAll.call(this, options);
    const status = document.querySelector('#statusText');
    if (status) status.textContent = '400×300 · 1-bit · V17';
    document.title = `400×300 黑白像素编辑器 V17${this.state?.dirty ? ' *' : ''}`;
    document.documentElement.dataset.pixelEditor = 'v17';
    if (target.PixelEditorTest) target.PixelEditorTest.version = 17;
    return result;
  };

  const oldTestApi = Workspace.prototype.testApi;
  Workspace.prototype.testApi = function testApiV17() {
    const api = oldTestApi.call(this);
    api.version = 17;
    return api;
  };

  const oldSaveProject = Workspace.prototype.saveProject;
  Workspace.prototype.saveProject = async function saveProjectV17() {
    if (!this.state.projectFileName && typeof target.showSaveFilePicker !== 'function') this.state.projectFileName = DEFAULT_FILENAME;
    return oldSaveProject.call(this);
  };
}

export {
  PREFERENCE_KEY,
  AUTOSAVE_KEY,
  DEFAULT_FILENAME,
  defaultEditorPreferences,
  loadEditorPreferences,
  saveEditorPreferences,
  updateEditorPreferences,
  normalizePreferences,
  installEditorPreferencesRuntime,
};
