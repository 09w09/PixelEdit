const PROJECT_VERSION = 17;
const WIDTH = 400;
const HEIGHT = 300;
const SHAPE_TYPES = new Set(['line', 'rectangle', 'circle', 'polygon']);
const FILLABLE_TYPES = new Set(['rectangle', 'circle', 'polygon', 'text']);
const STROKE_STYLES = new Set(['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot']);
const FILL_MODES = new Set(['transparent', 'solid', 'dither', 'pattern']);
const BACKGROUND_FILL_MODES = new Set(['solid', 'dither', 'pattern']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeStroke(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const width = clamp(Math.round(Number(source.width) || 1), 1, 100);
  const color = Number(source.color) === 0 ? 0 : 1;
  const style = STROKE_STYLES.has(source.style) ? source.style : 'solid';
  return { width, color, style };
}

function normalizeFill(input = {}, { background = false } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const allowed = background ? BACKGROUND_FILL_MODES : FILL_MODES;
  const fallbackMode = background ? 'solid' : 'transparent';
  const mode = allowed.has(source.mode) ? source.mode : fallbackMode;
  const color = Number(source.color) === 0 ? 0 : 1;
  return { mode, color };
}

function sameRecord(actual, expected) {
  const a = actual && typeof actual === 'object' ? actual : null;
  if (!a) return false;
  const keys = Object.keys(a);
  const expectedKeys = Object.keys(expected);
  if (keys.length !== expectedKeys.length) return false;
  return expectedKeys.every(key => Object.hasOwn(a, key) && a[key] === expected[key]);
}

function referencedAssetIds(project) {
  const ids = new Set();
  for (const font of project.fonts || []) if (font.assetId) ids.add(font.assetId);
  for (const page of project.pages || []) {
    for (const node of page.nodes || []) if (node.assetId) ids.add(node.assetId);
  }
  return ids;
}

function installV17SchemaRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const P = PE?.persistence;
  if (!M?.createPage || !M?.createNode || !M?.TreeModel || !M?.AssetStore || !P) {
    throw new Error('PixelEditor model/persistence is not initialized');
  }
  if (PE.schemaV17Installed) return;
  PE.schemaV17Installed = true;
  PE.version = PROJECT_VERSION;

  const originalCreatePage = M.createPage;
  const originalCreateNode = M.createNode;

  M.createPage = function createV17Page(name = '页面') {
    const page = originalCreatePage(name);
    page.width = WIDTH;
    page.height = HEIGHT;
    page.fill = { mode: 'solid', color: 0 };
    return page;
  };

  M.createNode = function createV17Node(type, props = {}) {
    const node = originalCreateNode(type, props);
    if (SHAPE_TYPES.has(type)) {
      node.stroke = normalizeStroke(props.stroke ?? node.stroke);
      delete node.lineWidth;
      delete node.strokeColor;
      delete node.strokeStyle;
    }
    if (FILLABLE_TYPES.has(type) || node.fill) {
      node.fill = normalizeFill(props.fill ?? node.fill);
    }
    return node;
  };

  M.createProject = function createV17Project(name = '未命名工程') {
    const page = M.createPage('页面 1');
    return {
      version: PROJECT_VERSION,
      width: WIDTH,
      height: HEIGHT,
      name,
      pages: [page],
      activePageId: page.id,
      fonts: [],
    };
  };
  delete M.defaultWorkspaceLayout;

  function validateV17Project(project) {
    if (!project || typeof project !== 'object') throw new Error('V17 工程数据无效');
    if (project.version !== PROJECT_VERSION) throw new Error('只支持 V17 工程');
    if (project.width !== WIDTH || project.height !== HEIGHT) throw new Error('V17 工程尺寸必须为 400×300');
    if (Object.hasOwn(project, 'workspaceLayout')) throw new Error('V17 工程不得包含 workspaceLayout');
    if (!Array.isArray(project.pages) || project.pages.length < 1) throw new Error('V17 工程必须至少包含 1 个页面');
    if (!Array.isArray(project.fonts)) throw new Error('V17 工程字体数据无效');

    const pageIds = new Set();
    for (const page of project.pages) {
      if (!page || typeof page !== 'object' || !page.id) throw new Error('V17 页面数据无效');
      if (pageIds.has(page.id)) throw new Error('V17 页面 ID 重复');
      pageIds.add(page.id);
      if (page.width !== WIDTH || page.height !== HEIGHT) throw new Error('V17 页面尺寸必须为 400×300');
      if (!Array.isArray(page.nodes)) throw new Error('V17 页面图层数据无效');
      if (page.nodes.some(node => node.type === 'background')) throw new Error('V17 页面不得包含 background 图层');
      if (page.fill?.mode === 'transparent') throw new Error('V17 页面背景不允许透明');
      if (Object.hasOwn(page.fill || {}, 'value')) throw new Error('V17 填充不得包含 fill.value');
      const expectedPageFill = normalizeFill(page.fill, { background: true });
      if (!sameRecord(page.fill, expectedPageFill)) throw new Error('V17 页面填充数据无效');

      for (const node of page.nodes) {
        if (!node || typeof node !== 'object' || !node.id || !node.type) throw new Error('V17 图层数据无效');
        if (Object.hasOwn(node, 'lineWidth')) throw new Error('V17 图形不得包含 lineWidth');
        if (Object.hasOwn(node, 'strokeColor') || Object.hasOwn(node, 'strokeStyle')) throw new Error('V17 图形不得包含旧描边字段');
        if (Object.hasOwn(node.fill || {}, 'value')) throw new Error('V17 填充不得包含 fill.value');
        if (SHAPE_TYPES.has(node.type)) {
          const expectedStroke = normalizeStroke(node.stroke);
          if (!sameRecord(node.stroke, expectedStroke)) throw new Error('V17 描边数据无效');
        }
        if (FILLABLE_TYPES.has(node.type) || node.fill) {
          const expectedFill = normalizeFill(node.fill);
          if (!sameRecord(node.fill, expectedFill)) throw new Error('V17 填充数据无效');
        }
      }
      new M.TreeModel(page).validateHierarchy();
    }
    if (!pageIds.has(project.activePageId)) throw new Error('V17 activePageId 必须指向现有页面');
    return project;
  }

  P.ProjectSerializer = {
    validate: validateV17Project,
    referencedAssetIds,
    serialize(project, assets) {
      validateV17Project(project);
      const output = structuredClone(project);
      output.assets = assets.referenced(referencedAssetIds(project));
      return JSON.stringify(output);
    },
    deserialize(raw) {
      const output = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
      validateV17Project(output);
      const records = output.assets || [];
      delete output.assets;
      return { project: output, assets: new M.AssetStore(records) };
    },
  };

  PE.schemaV17 = {
    PROJECT_VERSION,
    normalizeStroke,
    normalizeFill,
    validateV17Project,
    referencedAssetIds,
  };
}

export {
  PROJECT_VERSION,
  normalizeStroke,
  normalizeFill,
  installV17SchemaRuntime,
};
