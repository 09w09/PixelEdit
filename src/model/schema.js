import { normalizeStrokeWidth, normalizeStrokeColor } from './stroke-values.js';
import { VISUAL_TYPES, normalizeTransform } from '../transforms/transform-model.js';
import { RASTER_ENCODING, decodeTriStatePixels } from '../raster/tristate-raster.js';
import { TreeModel } from './tree-model.js';

const PROJECT_VERSION = 17, WIDTH = 400, HEIGHT = 300;
const SHAPE_TYPES = new Set(['line', 'rectangle', 'circle', 'polygon']);
const FILLABLE_TYPES = new Set(['rectangle', 'circle', 'polygon', 'text']);
const STROKE_STYLES = new Set(['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot']);
const FILL_MODES = new Set(['transparent', 'solid', 'dither', 'pattern']);
const BACKGROUND_FILL_MODES = new Set(['solid', 'dither', 'pattern']);

function normalizeStroke(input = {}) { const source = input && typeof input === 'object' ? input : {}; return { width: normalizeStrokeWidth(source.width, 1), color: normalizeStrokeColor(source.color), style: STROKE_STYLES.has(source.style) ? source.style : 'solid' }; }
function normalizeFill(input = {}, { background = false } = {}) { const source = input && typeof input === 'object' ? input : {}, allowed = background ? BACKGROUND_FILL_MODES : FILL_MODES; return { mode: allowed.has(source.mode) ? source.mode : (background ? 'solid' : 'transparent'), color: Number(source.color) === 0 ? 0 : 1 }; }
function sameRecord(actual, expected) { if (!actual || typeof actual !== 'object') return false; const keys = Object.keys(actual), expectedKeys = Object.keys(expected); return keys.length === expectedKeys.length && expectedKeys.every(key => Object.hasOwn(actual, key) && actual[key] === expected[key]); }
function transformIsCanonical(value) { if (!value || typeof value !== 'object') return false; const expected = normalizeTransform(value); return expected.rotation === value.rotation && expected.flipX === value.flipX && expected.flipY === value.flipY && expected.translateX === value.translateX && expected.translateY === value.translateY; }
function referencedAssetIds(project) { const ids = new Set(); for (const font of project?.fonts || []) if (font.assetId) ids.add(font.assetId); for (const page of project?.pages || []) for (const node of page.nodes || []) if (node.assetId) ids.add(node.assetId); return ids; }
function validateProject(project) {
  if (!project || typeof project !== 'object') throw new Error('V17 工程数据无效');
  if (project.version !== PROJECT_VERSION) throw new Error('只支持 V17 工程');
  if (project.width !== WIDTH || project.height !== HEIGHT) throw new Error('V17 工程尺寸必须为 400×300');
  if (Object.hasOwn(project, 'workspaceLayout')) throw new Error('V17 工程不得包含 workspaceLayout');
  if (!Array.isArray(project.pages) || project.pages.length < 1 || !Array.isArray(project.fonts)) throw new Error('V17 工程数据无效');
  const pageIds = new Set();
  for (const page of project.pages) {
    if (!page?.id || pageIds.has(page.id)) throw new Error('V17 页面数据无效');
    pageIds.add(page.id);
    if (page.width !== WIDTH || page.height !== HEIGHT || !Array.isArray(page.nodes)) throw new Error('V17 页面数据无效');
    if (page.nodes.some(node => node.type === 'background')) throw new Error('V17 页面不得包含 background 图层');
    if (page.fill?.mode === 'transparent' || Object.hasOwn(page.fill || {}, 'value') || !sameRecord(page.fill, normalizeFill(page.fill, { background: true }))) throw new Error('V17 页面填充数据无效');
    for (const node of page.nodes) {
      if (!node?.id || !node.type) throw new Error('V17 图层数据无效');
      const legacyStrokeFields = ['lineWidth', 'strokeColor', 'strokeStyle'].filter(key => Object.hasOwn(node, key));
      if (legacyStrokeFields.length) throw new Error(`V17 图形包含旧描边字段: ${legacyStrokeFields.join(', ')}`);
      if (Object.hasOwn(node.fill || {}, 'value')) throw new Error('V17 填充不得包含 fill.value');
      if (SHAPE_TYPES.has(node.type) && !sameRecord(node.stroke, normalizeStroke(node.stroke))) throw new Error('V17 描边数据无效');
      if ((FILLABLE_TYPES.has(node.type) || node.fill) && !sameRecord(node.fill, normalizeFill(node.fill))) throw new Error('V17 填充数据无效');
      if (VISUAL_TYPES.has(node.type) && !transformIsCanonical(node.transform)) throw new Error('V17 transform 数据无效');
      if (node.type === 'raster') { if (!node.raster || node.raster.encoding !== RASTER_ENCODING) throw new Error('V17 栅格数据格式无效'); decodeTriStatePixels(node.raster.data, node.w, node.h); }
    }
    new TreeModel(page).validateHierarchy();
  }
  if (!pageIds.has(project.activePageId)) throw new Error('V17 activePageId 必须指向现有页面');
  return project;
}

export { PROJECT_VERSION, WIDTH, HEIGHT, normalizeStroke, normalizeFill, validateProject, referencedAssetIds };
