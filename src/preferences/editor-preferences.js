import { normalizeStrokeWidth, normalizeStrokeColor } from '../model/stroke-values.js';
import {
  normalizeToolFill,
  normalizeDither,
  normalizePattern,
  defaultToolDither,
  defaultToolPattern,
} from '../model/fill-values.js';

const PREFERENCE_KEY = 'pixeledit:v17:preferences';
const AUTOSAVE_KEY = 'pixel-editor-v17-autosave';
const DEFAULT_FILENAME = 'pixel-project-v17.pix';
const STROKE_STYLES = new Set(['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot']);
const SHAPE_TOOLS = new Set(['line', 'rectangle', 'circle', 'polygon']);
const TEXT_ALIGN_H = new Set(['left', 'center', 'right']);
const TEXT_ALIGN_V = new Set(['top', 'middle', 'bottom']);

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
      bucket: {
        fill: { mode: 'solid', color: 1 },
        dither: defaultToolDither(),
        pattern: defaultToolPattern(),
      },
      line: { width: 1, color: 1, style: 'solid' },
      rectangle: { width: 1, color: 1, style: 'solid', fill: { mode: 'transparent', color: 1 } },
      circle: { width: 1, color: 1, style: 'solid', fill: { mode: 'transparent', color: 1 } },
      polygon: { width: 1, color: 1, style: 'solid', fill: { mode: 'transparent', color: 1 } },
      text: {
        fontFamily: 'sans-serif',
        fontSize: 16,
        lastScalableFontSize: 16,
        alignH: 'left',
        alignV: 'top',
      },
    },
    hidePageBackground: false,
  };
}

function normalizeTool(tool, input, fallback) {
  const source = input && typeof input === 'object' ? input : {};
  const out = structuredClone(fallback);
  if ('width' in fallback) {
    out.width = SHAPE_TOOLS.has(tool)
      ? normalizeStrokeWidth(source.width, fallback.width)
      : integer(source.width, fallback.width, 1, 100);
  }
  if ('color' in fallback) {
    out.color = SHAPE_TOOLS.has(tool)
      ? normalizeStrokeColor(source.color)
      : (Number(source.color) === 0 ? 0 : 1);
  }
  if ('style' in fallback) out.style = STROKE_STYLES.has(source.style) ? source.style : fallback.style;
  if ('fill' in fallback) out.fill = normalizeToolFill(source.fill, fallback.fill);
  if ('dither' in fallback) out.dither = normalizeDither(source.dither, fallback.dither);
  if ('pattern' in fallback) out.pattern = normalizePattern(source.pattern, fallback.pattern);
  if (tool === 'text') {
    out.fontFamily = typeof source.fontFamily === 'string' && source.fontFamily.trim() ? source.fontFamily : fallback.fontFamily;
    out.fontSize = integer(source.fontSize, fallback.fontSize, 1, 200);
    out.lastScalableFontSize = integer(source.lastScalableFontSize, fallback.lastScalableFontSize, 1, 200);
    out.alignH = TEXT_ALIGN_H.has(source.alignH) ? source.alignH : fallback.alignH;
    out.alignV = TEXT_ALIGN_V.has(source.alignV) ? source.alignV : fallback.alignV;
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
  out.hidePageBackground = source.hidePageBackground === true;
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

export {
  PREFERENCE_KEY,
  AUTOSAVE_KEY,
  DEFAULT_FILENAME,
  defaultEditorPreferences,
  loadEditorPreferences,
  saveEditorPreferences,
  updateEditorPreferences,
  normalizePreferences,
};
