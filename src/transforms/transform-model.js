const VISUAL_TYPES = new Set(['rectangle', 'circle', 'line', 'polygon', 'text', 'image', 'raster']);
const IDENTITY_TRANSFORM = Object.freeze({ rotation: 0, flipX: false, flipY: false });

function normalizeRotation(value) {
  let angle = Number(value);
  if (!Number.isFinite(angle)) angle = 0;
  angle %= 360;
  if (angle >= 180) angle -= 360;
  if (angle < -180) angle += 360;
  return Object.is(angle, -0) ? 0 : angle;
}

function normalizeTranslation(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) < 1e-9) return 0;
  const rounded = Math.round(number);
  return Math.abs(number - rounded) < 1e-9 ? rounded : number;
}

function normalizeTransform(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {
    rotation: normalizeRotation(source.rotation),
    flipX: source.flipX === true,
    flipY: source.flipY === true,
  };
  const translateX = normalizeTranslation(source.translateX);
  const translateY = normalizeTranslation(source.translateY);
  if (translateX !== 0) result.translateX = translateX;
  if (translateY !== 0) result.translateY = translateY;
  return result;
}

function isIdentityTransform(value) {
  const transform = normalizeTransform(value);
  return transform.rotation === 0
    && !transform.flipX
    && !transform.flipY
    && !transform.translateX
    && !transform.translateY;
}

function boundsFromPoints(points) {
  if (!points?.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map(point => Number(point.x) || 0);
  const ys = points.map(point => Number(point.y) || 0);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x, y, w: right - x, h: bottom - y };
}

function nodeLocalBounds(node, context = {}) {
  if (!node) return { x: 0, y: 0, w: 0, h: 0 };
  if (typeof context.baseBounds === 'function') return context.baseBounds(node);
  if (node.type === 'line') {
    const half = Math.max(0, (Number(node.stroke?.width) || 1) / 2);
    const x = Math.min(node.x1, node.x2) - half;
    const y = Math.min(node.y1, node.y2) - half;
    const right = Math.max(node.x1, node.x2) + half;
    const bottom = Math.max(node.y1, node.y2) + half;
    return { x, y, w: right - x, h: bottom - y };
  }
  if (node.type === 'polygon') {
    const base = boundsFromPoints(node.points || []);
    const half = Math.max(0, (Number(node.stroke?.width) || 1) / 2);
    return { x: base.x - half, y: base.y - half, w: base.w + half * 2, h: base.h + half * 2 };
  }
  return {
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    w: Math.max(0, Number(node.w) || 0),
    h: Math.max(0, Number(node.h) || 0),
  };
}

function nodeTransformMatrix(node, bounds = null) {
  const box = bounds || nodeLocalBounds(node);
  const transform = normalizeTransform(node?.transform);
  const radians = transform.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sx = transform.flipX ? -1 : 1;
  const sy = transform.flipY ? -1 : 1;
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const tx = transform.translateX || 0;
  const ty = transform.translateY || 0;
  const e = cx + tx - a * cx - c * cy;
  const f = cy + ty - b * cx - d * cy;
  return { a, b, c, d, e, f };
}

function transformPoint(matrix, point) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function inverseMatrix(matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-12) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const a = matrix.d / determinant;
  const b = -matrix.b / determinant;
  const c = -matrix.c / determinant;
  const d = matrix.a / determinant;
  const e = -(a * matrix.e + c * matrix.f);
  const f = -(b * matrix.e + d * matrix.f);
  return { a, b, c, d, e, f };
}

function inverseTransformPoint(matrix, point) {
  return transformPoint(inverseMatrix(matrix), point);
}

function transformedCorners(node, bounds = null) {
  const box = bounds || nodeLocalBounds(node);
  const matrix = nodeTransformMatrix(node, box);
  return [
    transformPoint(matrix, { x: box.x, y: box.y }),
    transformPoint(matrix, { x: box.x + box.w, y: box.y }),
    transformPoint(matrix, { x: box.x + box.w, y: box.y + box.h }),
    transformPoint(matrix, { x: box.x, y: box.y + box.h }),
  ];
}

function transformedBounds(node, context = {}) {
  const box = nodeLocalBounds(node, context);
  if (isIdentityTransform(node?.transform)) return { ...box };
  return boundsFromPoints(transformedCorners(node, box));
}

function unionBounds(items) {
  const bounds = (items || []).filter(item => item && item.w >= 0 && item.h >= 0);
  if (!bounds.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...bounds.map(item => item.x));
  const y = Math.min(...bounds.map(item => item.y));
  const right = Math.max(...bounds.map(item => item.x + item.w));
  const bottom = Math.max(...bounds.map(item => item.y + item.h));
  return { x, y, w: right - x, h: bottom - y };
}

function moveNodeGeometry(node, dx, dy) {
  if (node.type === 'line') {
    node.x1 += dx; node.x2 += dx; node.y1 += dy; node.y2 += dy;
  } else if (node.type === 'polygon') {
    for (const point of node.points || []) { point.x += dx; point.y += dy; }
  } else {
    node.x = (Number(node.x) || 0) + dx;
    node.y = (Number(node.y) || 0) + dy;
  }
}

function isolateNodeProject(project, pageId, node, pageIdFallback) {
  const clone = structuredClone(project);
  const page = clone.pages.find(item => item.id === pageId);
  if (!page) throw new Error('page not found');
  const isolated = structuredClone(node);
  isolated.parentId = page.id || pageIdFallback;
  isolated.transform = { ...IDENTITY_TRANSFORM };
  page.nodes = [isolated];
  page.activePageId = page.id;
  clone.activePageId = page.id;
  return clone;
}

function transformRgbaCut(cut, node, sourceBounds) {
  const matrix = nodeTransformMatrix(node, sourceBounds);
  const inverse = inverseMatrix(matrix);
  const worldBounds = transformedBounds(node, { baseBounds: () => sourceBounds });
  const x = Math.floor(worldBounds.x + 1e-9);
  const y = Math.floor(worldBounds.y + 1e-9);
  const right = Math.ceil(worldBounds.x + worldBounds.w - 1e-9);
  const bottom = Math.ceil(worldBounds.y + worldBounds.h - 1e-9);
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
  const data = new Uint8ClampedArray(width * height * 4);

  for (let oy = 0; oy < height; oy += 1) {
    for (let ox = 0; ox < width; ox += 1) {
      const world = { x: x + ox + 0.5, y: y + oy + 0.5 };
      const sourceWorld = transformPoint(inverse, world);
      const sx = Math.floor(sourceWorld.x - cut.x);
      const sy = Math.floor(sourceWorld.y - cut.y);
      if (sx < 0 || sy < 0 || sx >= cut.w || sy >= cut.h) continue;
      const sourceIndex = (sy * cut.w + sx) * 4;
      const targetIndex = (oy * width + ox) * 4;
      data[targetIndex] = cut.data[sourceIndex];
      data[targetIndex + 1] = cut.data[sourceIndex + 1];
      data[targetIndex + 2] = cut.data[sourceIndex + 2];
      data[targetIndex + 3] = cut.data[sourceIndex + 3];
    }
  }
  return { x, y, width, height, data, worldBounds };
}

function installTransformModelRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const R = PE?.renderer;
  const P = PE?.persistence;
  if (!M?.createNode || !R?.FramebufferRenderer || !P?.ProjectSerializer) throw new Error('PixelEditor transform dependencies are not initialized');
  if (PE.transformModelInstalled) return;
  PE.transformModelInstalled = true;

  const framebuffer = R.FramebufferRenderer;
  const baseVisualBounds = framebuffer.visualBounds.bind(framebuffer);
  const baseRenderPage = framebuffer.renderPage.bind(framebuffer);
  const baseRenderSubtree = framebuffer.renderSubtree.bind(framebuffer);
  const baseSubtreeRgba = framebuffer.subtreeRgba.bind(framebuffer);

  function baseBoundsForNode(node, project, pageId, assets) {
    if (!project || !pageId || !node?.id) return nodeLocalBounds(node);
    return baseVisualBounds(node.id, { project, pageId, assets });
  }

  const originalCreateNode = M.createNode;
  M.createNode = function createTransformNode(type, props = {}) {
    const node = originalCreateNode(type, props);
    if (VISUAL_TYPES.has(type)) node.transform = normalizeTransform(props.transform || node.transform);
    return node;
  };

  function validateTransformProject(project) {
    for (const page of project.pages || []) for (const node of page.nodes || []) {
      if (!VISUAL_TYPES.has(node.type)) continue;
      if (!node.transform) throw new Error('V17 可视元素缺少 transform');
      const normalized = normalizeTransform(node.transform);
      if (normalized.rotation !== node.transform.rotation
        || normalized.flipX !== node.transform.flipX
        || normalized.flipY !== node.transform.flipY
        || normalized.translateX !== node.transform.translateX
        || normalized.translateY !== node.transform.translateY) {
        throw new Error('V17 transform 数据无效');
      }
    }
    return project;
  }

  const oldSerialize = P.ProjectSerializer.serialize.bind(P.ProjectSerializer);
  const oldDeserialize = P.ProjectSerializer.deserialize.bind(P.ProjectSerializer);
  P.ProjectSerializer.serialize = function serializeTransforms(project, assets) {
    validateTransformProject(project);
    return oldSerialize(project, assets);
  };
  P.ProjectSerializer.deserialize = function deserializeTransforms(raw) {
    const result = oldDeserialize(raw);
    validateTransformProject(result.project);
    return result;
  };

  function sourceCut(project, pageId, node, assets) {
    const isolated = isolateNodeProject(project, pageId, node, pageId);
    return baseSubtreeRgba(isolated, pageId, node.id, assets);
  }

  function adaptProject(project, pageId, assets) {
    const clone = structuredClone(project);
    const page = clone.pages.find(item => item.id === pageId);
    if (!page) return { project: clone, assets };
    const runtimes = new Map();
    for (const node of page.nodes) {
      const source = M.nodeById(M.pageById(project, pageId), node.id);
      if (!source || !VISUAL_TYPES.has(source.type) || isIdentityTransform(source.transform)) continue;
      const sourceBounds = baseBoundsForNode(source, project, pageId, assets);
      const cut = sourceCut(project, pageId, source, assets);
      const transformed = transformRgbaCut(cut, source, sourceBounds);
      const assetId = `__pixeledit_transform__${node.id}`;
      runtimes.set(assetId, { width: transformed.width, height: transformed.height, data: transformed.data });
      node.type = 'image';
      node.x = transformed.x;
      node.y = transformed.y;
      node.w = transformed.width;
      node.h = transformed.height;
      node.assetId = assetId;
      node.sourceWidth = transformed.width;
      node.sourceHeight = transformed.height;
      node.sourceType = 'transform-runtime';
      node.sourceName = '';
      node.image = {
        fit: 'stretch', interpolation: 'nearest', cropX: 0, cropY: 0,
        cropW: transformed.width, cropH: transformed.height,
        bwMode: 'threshold', threshold: 128, invert: false,
        ditherAlgorithm: 'bayer', bayerMatrix: 4,
      };
      node.transform = { ...IDENTITY_TRANSFORM };
      node.overlay = {};
      delete node.stroke;
      delete node.raster;
      delete node.points;
      delete node.x1; delete node.y1; delete node.x2; delete node.y2;
    }
    const proxy = Object.create(assets || null);
    proxy.getRuntime = id => runtimes.get(id) || assets?.getRuntime?.(id) || null;
    proxy.get = id => assets?.get?.(id) || null;
    return { project: clone, assets: proxy };
  }

  function rawVisualBounds(nodeId, context) {
    const page = M.pageById(context.project, context.pageId);
    const node = M.nodeById(page, nodeId);
    if (!node) return { x: 0, y: 0, w: 0, h: 0 };
    if (!VISUAL_TYPES.has(node.type) || isIdentityTransform(node.transform)) return baseVisualBounds(nodeId, context);
    const sourceBounds = baseVisualBounds(nodeId, context);
    return transformedBounds(node, { baseBounds: () => sourceBounds });
  }

  framebuffer.visualBounds = function visualTransformBounds(nodeId, context) {
    return rawVisualBounds(nodeId, context);
  };

  framebuffer.visualSubtreeBounds = function visualTransformSubtreeBounds(nodeId, context) {
    const page = M.pageById(context.project, context.pageId);
    const tree = new M.TreeModel(page);
    const bounds = [];
    const visit = id => {
      const node = tree.node(id);
      if (!node || node.visible === false) return;
      const visible = framebuffer.visualBounds(id, context);
      if (visible.w > 0 && visible.h > 0) bounds.push(visible);
      for (const child of tree.childrenOf(id)) visit(child.id);
    };
    visit(nodeId);
    return unionBounds(bounds);
  };

  framebuffer.renderPage = function renderTransformedPage(project, pageId, assets) {
    const adapted = adaptProject(project, pageId, assets);
    return baseRenderPage(adapted.project, pageId, adapted.assets);
  };
  framebuffer.renderSubtree = function renderTransformedSubtree(project, pageId, nodeId, assets, base = 0) {
    const adapted = adaptProject(project, pageId, assets);
    return baseRenderSubtree(adapted.project, pageId, nodeId, adapted.assets, base);
  };
  framebuffer.subtreeRgba = function transformedSubtreeRgba(project, pageId, nodeId, assets) {
    const adapted = adaptProject(project, pageId, assets);
    return baseSubtreeRgba(adapted.project, pageId, nodeId, adapted.assets);
  };

  PE.transformModel = {
    VISUAL_TYPES,
    IDENTITY_TRANSFORM: { ...IDENTITY_TRANSFORM },
    normalizeRotation,
    normalizeTranslation,
    normalizeTransform,
    isIdentityTransform,
    nodeLocalBounds,
    nodeTransformMatrix,
    transformPoint,
    inverseTransformPoint,
    transformedCorners,
    transformedBounds,
    unionBounds,
    moveNodeGeometry,
    rawVisualBounds,
    validateTransformProject,
  };
}

export {
  VISUAL_TYPES,
  IDENTITY_TRANSFORM,
  normalizeRotation,
  normalizeTranslation,
  normalizeTransform,
  isIdentityTransform,
  nodeLocalBounds,
  nodeTransformMatrix,
  transformPoint,
  inverseTransformPoint,
  transformedCorners,
  transformedBounds,
  unionBounds,
  moveNodeGeometry,
  installTransformModelRuntime,
};
