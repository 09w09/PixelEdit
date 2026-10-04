import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
const html = await readFile(indexPath, 'utf8');
const scriptMatch = html.match(/<script>\s*\/\* bootstrap\.js \*\/[\s\S]*?<\/script>\s*(?=<\/body>)/);
if (!scriptMatch) throw new Error('inline PixelEdit core script not found');

const scriptTag = scriptMatch[0];
const scriptBody = scriptTag.replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '');
const blockPattern = /\/\*\s*([^*]+?\.js)\s*\*\/\s*([\s\S]*?)(?=\n\s*\/\*\s*[^*]+?\.js\s*\*\/|$)/g;
const blocks = new Map();
for (const match of scriptBody.matchAll(blockPattern)) blocks.set(match[1].trim(), match[2].trim() + '\n');

const expected = [
  'bootstrap.js', 'model/ids.js', 'model/Hash.js', 'model/AssetStore.js', 'model/Node.js', 'model/Page.js',
  'model/Project.js', 'model/TreeModel.js', 'model/SelectionSet.js', 'renderer/bitmapPrimitives.js',
  'renderer/PatternRenderer.js', 'renderer/TextRenderer.js', 'renderer/ImageRenderer.js', 'renderer/FramebufferRenderer.js',
  'renderer/OverlayRenderer.js', 'commands/CommandBus.js', 'commands/nodeCommands.js', 'commands/treeCommands.js',
  'persistence/ProjectSerializer.js', 'persistence/ProjectFiles.js', 'persistence/Autosave.js', 'commands/transformCommands.js',
  'commands/arrangeCommands.js', 'interaction/HitTest.js', 'interaction/SnapEngine.js', 'interaction/Clipboard.js',
  'commands/clipboardCommands.js', 'commands/pageCommands.js', 'interaction/InteractionController.js', 'ui/Toolbar.js',
  'ui/PageDock.js', 'ui/Properties.js', 'ui/HistoryDock.js', 'ui/Workspace.js',
];
for (const name of expected) if (!blocks.has(name)) throw new Error(`missing inline module: ${name}`);

async function put(relativePath, content) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content.endsWith('\n') ? content : content + '\n');
}

const extracted = new Map([
  ['model/ids.js', 'src/model/ids.js'],
  ['model/Hash.js', 'src/model/hash.js'],
  ['model/AssetStore.js', 'src/model/asset-store.js'],
  ['model/TreeModel.js', 'src/model/tree-model.js'],
  ['model/SelectionSet.js', 'src/model/selection-set.js'],
  ['renderer/bitmapPrimitives.js', 'src/rendering/bitmap-primitives.js'],
  ['renderer/PatternRenderer.js', 'src/rendering/pattern-renderer.js'],
  ['renderer/TextRenderer.js', 'src/rendering/base-text-renderer.js'],
  ['renderer/ImageRenderer.js', 'src/rendering/base-image-renderer.js'],
  ['renderer/FramebufferRenderer.js', 'src/rendering/base-framebuffer-renderer.js'],
  ['renderer/OverlayRenderer.js', 'src/rendering/base-overlay-renderer.js'],
  ['commands/CommandBus.js', 'src/commands/command-bus.js'],
  ['commands/nodeCommands.js', 'src/commands/node-commands.js'],
  ['commands/treeCommands.js', 'src/commands/tree-commands.js'],
  ['commands/transformCommands.js', 'src/commands/transform-commands.js'],
  ['commands/arrangeCommands.js', 'src/commands/arrange-commands.js'],
  ['interaction/HitTest.js', 'src/interaction/hit-test.js'],
  ['interaction/SnapEngine.js', 'src/interaction/snap-engine.js'],
  ['interaction/Clipboard.js', 'src/interaction/clipboard.js'],
  ['commands/clipboardCommands.js', 'src/commands/clipboard-commands.js'],
  ['commands/pageCommands.js', 'src/commands/page-commands.js'],
  ['interaction/InteractionController.js', 'src/interaction/interaction-controller.js'],
  ['ui/Toolbar.js', 'src/ui/toolbar.js'],
  ['ui/PageDock.js', 'src/ui/page-dock.js'],
  ['ui/Properties.js', 'src/ui/properties.js'],
  ['ui/HistoryDock.js', 'src/ui/history-dock.js'],
  ['ui/Workspace.js', 'src/app/workspace.js'],
]);

for (const [name, target] of extracted) {
  let content = blocks.get(name);
  if (name === 'model/TreeModel.js' || name === 'commands/nodeCommands.js' || name === 'ui/Workspace.js') {
    content = content.replaceAll('V15', 'V17').replaceAll('version:15', 'version:17').replaceAll('pixel-project-v15.pix', 'pixel-project-v17.pix');
  }
  await put(target, content);
}

await put('src/core/namespace.js', `const PixelEditor = {
  version: 17,
  model: {},
  commands: {},
  renderer: {},
  interaction: {},
  persistence: {},
  ui: {},
};

globalThis.PixelEditor = PixelEditor;

export { PixelEditor };
`);

await put('src/model/schema.js', `import { normalizeStrokeWidth, normalizeStrokeColor } from './stroke-values.js';

const PROJECT_VERSION = 17;
const WIDTH = 400;
const HEIGHT = 300;
const SHAPE_TYPES = new Set(['line', 'rectangle', 'circle', 'polygon']);
const FILLABLE_TYPES = new Set(['rectangle', 'circle', 'polygon', 'text']);
const STROKE_STYLES = new Set(['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot']);
const FILL_MODES = new Set(['transparent', 'solid', 'dither', 'pattern']);
const BACKGROUND_FILL_MODES = new Set(['solid', 'dither', 'pattern']);

function normalizeStroke(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    width: normalizeStrokeWidth(source.width, 1),
    color: normalizeStrokeColor(source.color),
    style: STROKE_STYLES.has(source.style) ? source.style : 'solid',
  };
}

function normalizeFill(input = {}, { background = false } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const allowed = background ? BACKGROUND_FILL_MODES : FILL_MODES;
  const mode = allowed.has(source.mode) ? source.mode : (background ? 'solid' : 'transparent');
  return { mode, color: Number(source.color) === 0 ? 0 : 1 };
}

function sameRecord(actual, expected) {
  if (!actual || typeof actual !== 'object') return false;
  const keys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  return keys.length === expectedKeys.length
    && expectedKeys.every(key => Object.hasOwn(actual, key) && actual[key] === expected[key]);
}

function referencedAssetIds(project) {
  const ids = new Set();
  for (const font of project?.fonts || []) if (font.assetId) ids.add(font.assetId);
  for (const page of project?.pages || []) for (const node of page.nodes || []) if (node.assetId) ids.add(node.assetId);
  return ids;
}

function validateProject(project) {
  const M = globalThis.PixelEditor?.model;
  if (!project || typeof project !== 'object') throw new Error('V17 工程数据无效');
  if (project.version !== PROJECT_VERSION) throw new Error('只支持 V17 工程');
  if (project.width !== WIDTH || project.height !== HEIGHT) throw new Error('V17 工程尺寸必须为 400×300');
  if (Object.hasOwn(project, 'workspaceLayout')) throw new Error('V17 工程不得包含 workspaceLayout');
  if (!Array.isArray(project.pages) || project.pages.length < 1) throw new Error('V17 工程必须至少包含 1 个页面');
  if (!Array.isArray(project.fonts)) throw new Error('V17 工程字体数据无效');
  const pageIds = new Set();
  for (const page of project.pages) {
    if (!page?.id || pageIds.has(page.id)) throw new Error('V17 页面数据无效');
    pageIds.add(page.id);
    if (page.width !== WIDTH || page.height !== HEIGHT || !Array.isArray(page.nodes)) throw new Error('V17 页面数据无效');
    if (page.nodes.some(node => node.type === 'background')) throw new Error('V17 页面不得包含 background 图层');
    if (page.fill?.mode === 'transparent' || Object.hasOwn(page.fill || {}, 'value')) throw new Error('V17 页面填充数据无效');
    if (!sameRecord(page.fill, normalizeFill(page.fill, { background: true }))) throw new Error('V17 页面填充数据无效');
    for (const node of page.nodes) {
      if (!node?.id || !node.type) throw new Error('V17 图层数据无效');
      if (Object.hasOwn(node, 'lineWidth') || Object.hasOwn(node, 'strokeColor') || Object.hasOwn(node, 'strokeStyle')) throw new Error('V17 图形包含旧描边字段');
      if (Object.hasOwn(node.fill || {}, 'value')) throw new Error('V17 填充不得包含 fill.value');
      if (SHAPE_TYPES.has(node.type) && !sameRecord(node.stroke, normalizeStroke(node.stroke))) throw new Error('V17 描边数据无效');
      if ((FILLABLE_TYPES.has(node.type) || node.fill) && !sameRecord(node.fill, normalizeFill(node.fill))) throw new Error('V17 填充数据无效');
    }
    new M.TreeModel(page).validateHierarchy();
  }
  if (!pageIds.has(project.activePageId)) throw new Error('V17 activePageId 必须指向现有页面');
  return project;
}

const schemaV17 = { PROJECT_VERSION, WIDTH, HEIGHT, normalizeStroke, normalizeFill, validateV17Project: validateProject, referencedAssetIds };
globalThis.PixelEditor.schemaV17 = schemaV17;

export { PROJECT_VERSION, WIDTH, HEIGHT, normalizeStroke, normalizeFill, validateProject, referencedAssetIds, schemaV17 };
`);

await put('src/model/node.js', `import { normalizeFill, normalizeStroke } from './schema.js';
import { createTriStateRaster, decodeTriStatePixels, RASTER_ENCODING } from '../raster/tristate-raster.js';
import { normalizeTransform } from '../transforms/transform-model.js';

const M = globalThis.PixelEditor.model;
const LABELS = Object.freeze({ rectangle: '矩形', circle: '圆', polygon: '多边形', line: '直线', text: '文字', image: '图片', raster: '栅格' });
const integer = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
const defaultDither = () => ({ type: 'bayer', density: 50, matrix: 4, align: 'object', offsetX: 0, offsetY: 0 });
const defaultPattern = () => ({ type: 'horizontal', lineWidth: 1, gap: 2, align: 'object', offsetX: 0, offsetY: 0 });
const transformOf = props => normalizeTransform(props.transform || {});

function base(type, props) {
  if (type === 'background') throw new Error('V17 中页面本身就是背景');
  return {
    id: props.id || M.nextId(type), type, name: props.name || LABELS[type] || type,
    parentId: props.parentId ?? null, visible: props.visible !== false, locked: Boolean(props.locked),
  };
}

function createNode(type, props = {}) {
  const commonBase = base(type, props);
  if (type === 'line') return { ...commonBase, x1: integer(props.x1), y1: integer(props.y1), x2: integer(props.x2, 20), y2: integer(props.y2, 20), stroke: normalizeStroke(props.stroke), overlay: structuredClone(props.overlay || {}), transform: transformOf(props) };
  if (type === 'polygon') return { ...commonBase, points: (props.points || [{ x: 0, y: 20 }, { x: 20, y: 0 }, { x: 40, y: 20 }]).map(point => ({ x: integer(point.x), y: integer(point.y) })).slice(0, 24), stroke: normalizeStroke(props.stroke), fill: normalizeFill(props.fill), dither: structuredClone(props.dither || defaultDither()), pattern: structuredClone(props.pattern || defaultPattern()), overlay: structuredClone(props.overlay || {}), transform: transformOf(props) };

  const common = { ...commonBase, x: integer(props.x), y: integer(props.y), w: Math.max(1, integer(props.w, 40)), h: Math.max(1, integer(props.h, 30)), aspectLocked: Boolean(props.aspectLocked), overlay: structuredClone(props.overlay || {}), transform: transformOf(props) };
  if (type === 'rectangle') return { ...common, rTL: Math.max(0, integer(props.rTL)), rTR: Math.max(0, integer(props.rTR)), rBL: Math.max(0, integer(props.rBL)), rBR: Math.max(0, integer(props.rBR)), stroke: normalizeStroke(props.stroke), fill: normalizeFill(props.fill), dither: structuredClone(props.dither || defaultDither()), pattern: structuredClone(props.pattern || defaultPattern()) };
  if (type === 'circle') return { ...common, stroke: normalizeStroke(props.stroke), fill: normalizeFill(props.fill), dither: structuredClone(props.dither || defaultDither()), pattern: structuredClone(props.pattern || defaultPattern()) };
  if (type === 'text') return { ...common, text: props.text ?? '文字', fontFamily: props.fontFamily || 'sans-serif', fontSize: Math.max(1, integer(props.fontSize, 16)), fixedFontSize: props.fixedFontSize ?? null, letterSpacing: integer(props.letterSpacing), lineSpacing: integer(props.lineSpacing), alignH: props.alignH || 'left', alignV: props.alignV || 'top', wrap: props.wrap !== false, bold: Boolean(props.bold), invert: Boolean(props.invert), fill: normalizeFill(props.fill || { mode: 'solid', color: 1 }), dither: structuredClone(props.dither || defaultDither()), pattern: structuredClone(props.pattern || defaultPattern()) };
  if (type === 'image') {
    const sourceWidth = Math.max(1, integer(props.sourceWidth, common.w));
    const sourceHeight = Math.max(1, integer(props.sourceHeight, common.h));
    return { ...common, assetId: props.assetId || null, sourceWidth, sourceHeight, sourceType: props.sourceType || 'bitmap', sourceName: props.sourceName || '', svgViewBox: props.svgViewBox || null, image: { fit: 'stretch', interpolation: 'nearest', cropX: 0, cropY: 0, cropW: sourceWidth, cropH: sourceHeight, bwMode: 'threshold', threshold: 128, invert: false, ditherAlgorithm: 'bayer', bayerMatrix: 4, ...(props.image || {}) } };
  }
  if (type === 'raster') {
    let raster = props.raster ? structuredClone(props.raster) : createTriStateRaster(common.w, common.h, props.pixels || null);
    if (raster.encoding !== RASTER_ENCODING) throw new Error('V17 栅格数据格式无效');
    decodeTriStatePixels(raster.data, common.w, common.h);
    return { ...common, raster };
  }
  throw new Error(\`unknown node type: \${type}\`);
}

Object.assign(M, { createNode, defaultDither, defaultPattern, asInt: integer });
export { createNode, defaultDither, defaultPattern };
`);

await put('src/model/page.js', `const M = globalThis.PixelEditor.model;
function createPage(name = '页面') {
  return { id: M.nextId('page'), name, width: 400, height: 300, locked: false, fill: { mode: 'solid', color: 0 }, dither: M.defaultDither(), pattern: M.defaultPattern(), overlay: {}, nodes: [] };
}
M.createPage = createPage;
export { createPage };
`);

await put('src/model/project.js', `const M = globalThis.PixelEditor.model;
function createProject(name = '未命名工程') {
  const page = M.createPage('页面 1');
  return { version: 17, width: 400, height: 300, name, pages: [page], activePageId: page.id, fonts: [] };
}
function pageById(project, id) { return project?.pages?.find(page => page.id === id) || null; }
function nodeById(page, id) { return page?.nodes?.find(node => node.id === id) || null; }
Object.assign(M, { createProject, pageById, nodeById });
export { createProject, pageById, nodeById };
`);

await put('src/persistence/project-serializer.js', `import { referencedAssetIds, validateProject } from '../model/schema.js';
const P = globalThis.PixelEditor.persistence;
const M = globalThis.PixelEditor.model;
const ProjectSerializer = {
  validate: validateProject,
  referencedAssetIds,
  serialize(project, assets) {
    validateProject(project);
    const output = structuredClone(project);
    output.assets = assets.referenced(referencedAssetIds(project));
    return JSON.stringify(output);
  },
  deserialize(raw) {
    const output = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
    validateProject(output);
    const records = output.assets || [];
    delete output.assets;
    return { project: output, assets: new M.AssetStore(records) };
  },
};
P.ProjectSerializer = ProjectSerializer;
export { ProjectSerializer };
`);

await put('src/persistence/project-files.js', `const P = globalThis.PixelEditor.persistence;
const PIX_FILE_TYPE = { description: 'Pixel Editor Project (*.pix)', accept: { 'application/json': ['.pix'] } };
class ProjectFiles {
  constructor(state, io = {}) { this.state = state; this.io = io; }
  serialize() { return P.ProjectSerializer.serialize(this.state.project, this.state.assets); }
  async write(handle, raw) { const writer = await handle.createWritable(); await writer.write(raw); await writer.close(); }
  async saveAs() {
    const picker = this.io.showSaveFilePicker || globalThis.showSaveFilePicker;
    if (!picker) throw new Error('save picker unavailable');
    const handle = await picker({ suggestedName: this.state.projectFileName?.endsWith('.pix') ? this.state.projectFileName : 'pixel-project-v17.pix', types: [PIX_FILE_TYPE] });
    if (!handle) return null;
    const raw = this.serialize(); await this.write(handle, raw);
    this.state.projectFileHandle = handle; this.state.projectFileName = handle.name || 'pixel-project-v17.pix'; this.state.dirty = false;
    return raw;
  }
  async save() { if (!this.state.projectFileHandle) return this.saveAs(); const raw = this.serialize(); await this.write(this.state.projectFileHandle, raw); this.state.dirty = false; return raw; }
  async open() {
    const picker = this.io.showOpenFilePicker || globalThis.showOpenFilePicker;
    if (!picker) throw new Error('open picker unavailable');
    const handles = await picker({ multiple: false, types: [PIX_FILE_TYPE] }); const handle = handles?.[0]; if (!handle) return null;
    const file = await handle.getFile(); const output = P.ProjectSerializer.deserialize(await file.text());
    this.state.project = output.project; this.state.assets = output.assets; this.state.projectFileHandle = handle; this.state.projectFileName = handle.name || file.name || ''; this.state.dirty = false;
    return output;
  }
}
Object.assign(P, { ProjectFiles, PIX_FILE_TYPE });
export { ProjectFiles, PIX_FILE_TYPE };
`);

await put('src/persistence/autosave.js', `const P = globalThis.PixelEditor.persistence;
const AUTOSAVE_KEY = 'pixel-editor-v17-autosave';
class Autosave {
  constructor(state, storage = null, key = AUTOSAVE_KEY) { this.state = state; this.key = key; if (storage) this.storage = storage; else { try { this.storage = globalThis.localStorage; } catch { this.storage = null; } } }
  run() { const raw = P.ProjectSerializer.serialize(this.state.project, this.state.assets); try { this.storage?.setItem(this.key, raw); } catch {} return raw; }
  read() { try { const raw = this.storage?.getItem(this.key); return raw ? P.ProjectSerializer.deserialize(raw) : null; } catch { return null; } }
  clear() { try { this.storage?.removeItem(this.key); } catch {} return true; }
  has() { try { return Boolean(this.storage?.getItem(this.key)); } catch { return false; } }
}
P.Autosave = Autosave;
export { AUTOSAVE_KEY, Autosave };
`);

await put('src/app/bootstrap.js', `function bootstrapPixelEdit(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.ui?.Workspace) throw new Error('PixelEditor V17 core is not initialized');
  PE.version = 17;
  const boot = () => {
    if (PE.app) return PE.app;
    if (typeof document === 'undefined') return null;
    document.documentElement.dataset.pixelEditor = 'v17';
    PE.app = new PE.ui.Workspace().mount();
    return PE.app;
  };
  PE.boot = boot;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else queueMicrotask(boot);
  }
  return boot;
}
export { bootstrapPixelEdit };
`);

await put('src/core/index.js', `import './namespace.js';
import '../model/ids.js';
import '../model/hash.js';
import '../model/asset-store.js';
import '../model/schema.js';
import '../model/node.js';
import '../model/page.js';
import '../model/project.js';
import '../model/tree-model.js';
import '../model/selection-set.js';
import '../rendering/bitmap-primitives.js';
import '../rendering/pattern-renderer.js';
import '../rendering/base-text-renderer.js';
import '../rendering/base-image-renderer.js';
import '../rendering/base-framebuffer-renderer.js';
import '../rendering/base-overlay-renderer.js';
import '../commands/command-bus.js';
import '../commands/node-commands.js';
import '../commands/tree-commands.js';
import '../persistence/project-serializer.js';
import '../persistence/project-files.js';
import '../persistence/autosave.js';
import '../commands/transform-commands.js';
import '../commands/arrange-commands.js';
import '../interaction/hit-test.js';
import '../interaction/snap-engine.js';
import '../interaction/clipboard.js';
import '../commands/clipboard-commands.js';
import '../commands/page-commands.js';
import '../interaction/interaction-controller.js';
import '../ui/toolbar.js';
import '../ui/page-dock.js';
import '../ui/properties.js';
import '../ui/history-dock.js';
import '../app/workspace.js';
`);

let main = await readFile(path.join(root, 'src/main.js'), 'utf8');
main = `import './core/index.js';\nimport { bootstrapPixelEdit } from './app/bootstrap.js';\n` + main;
main = main.replace("import { installV17SchemaRuntime } from './model/v17-schema.js';\n", '');
main = main.replace(/\s*installV17SchemaRuntime\(globalThis\);\n/, '\n');
main = main.replace('installRuntimeModules();\n\nexport { installRuntimeModules };', 'installRuntimeModules();\nbootstrapPixelEdit(globalThis);\n\nexport { installRuntimeModules };');
await writeFile(path.join(root, 'src/main.js'), main);

let shell = html.replace(scriptTag, '<script type="module" src="./src/main.js"></script>');
shell = shell.replaceAll('黑白像素编辑器 V15', '黑白像素编辑器 V17');
await writeFile(indexPath, shell);

await writeFile(path.join(root, 'vite.config.js'), `import { defineConfig } from 'vite';

const buildSha = process.env.GITHUB_SHA || 'local';
const buildInfo = JSON.stringify({ sha: buildSha });

export default defineConfig({
  base: './',
  plugins: [{
    name: 'pixeledit-build-info',
    configureServer(server) {
      server.middlewares.use('/build-info.json', (_request, response) => {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(buildInfo);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: buildInfo });
    },
  }],
});
`);

console.log(`Task 1 migrated ${blocks.size} inline modules; ${extracted.size} were preserved as direct source modules.`);
