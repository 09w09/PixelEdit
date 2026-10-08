import { computeImageGeometry } from './image-geometry.js';
import { assertDimensions, assertSize, MAX_SVG_BYTES, MAX_IMAGE_PIXELS, MAX_RASTER_PIXELS } from '../model/resource-limits.js';

const SVG_RUNTIME_KIND = 'svg-vector';
const MAX_CACHE_ENTRIES = 32;
const MAX_CACHE_PIXELS = 4 * 1024 * 1024;

function parseNumericLength(value) {
  const match = String(value ?? '').trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))/);
  return match ? Number(match[1]) : NaN;
}

function parseSvgDocument(text) {
  assertSize(String(text).length * 2, MAX_SVG_BYTES, 'SVG');
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(text), 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root?.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg')
    throw new Error('Invalid SVG');
  const forbidden = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed', 'image', 'video', 'audio', 'style']);
  const elements = doc.querySelectorAll('*');
  if (elements.length > 4096) throw new Error('SVG 元素数量过多');
  for (const element of elements) {
    if (forbidden.has(element.localName)) throw new Error('SVG 包含不安全的内容');
    for (const attr of element.attributes) {
      const name = attr.localName.toLowerCase(), value = attr.value.trim();
      if (name.startsWith('on') || /@import|expression\s*\(/i.test(value))
        throw new Error('SVG 包含不安全的属性');
      if ((name === 'href' && !value.startsWith('#')) ||
          /url\s*\(\s*['"]?(?!#)/i.test(value))
        throw new Error('SVG 包含外部资源引用');
    }
  }
  return { doc, root };
}

function parseSvgMeta(text) {
  const { root } = parseSvgDocument(text);
  const raw = root.getAttribute('viewBox');
  const viewBox = raw ? raw.trim().split(/[\s,]+/).map(Number) : null;
  const validViewBox = viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
  let width = validViewBox ? Math.abs(viewBox[2]) : parseNumericLength(root.getAttribute('width'));
  let height = validViewBox ? Math.abs(viewBox[3]) : parseNumericLength(root.getAttribute('height'));
  if (!Number.isFinite(width) || width <= 0) width = 300;
  if (!Number.isFinite(height) || height <= 0) height = 150;
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
  assertDimensions(width, height, MAX_IMAGE_PIXELS);
  return { width, height, viewBox: validViewBox ? viewBox : null };
}

function normalizeSvgText(text, width, height) {
  const { doc, root } = parseSvgDocument(text);
  assertDimensions(Math.round(width), Math.round(height), MAX_IMAGE_PIXELS);
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  root.setAttribute('width', String(Math.max(1, Math.round(width))));
  root.setAttribute('height', String(Math.max(1, Math.round(height))));
  return new XMLSerializer().serializeToString(root);
}

function svgTextToDataUrl(text) { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`; }
function svgTextFromDataUrl(dataUrl) {
  const value = String(dataUrl || '');
  const comma = value.indexOf(',');
  if (comma < 0 || !/^data:image\/svg\+xml/i.test(value)) throw new Error('Invalid SVG data URL');
  const header = value.slice(0, comma), payload = value.slice(comma + 1);
  if (/;base64/i.test(header)) {
    const binary = atob(payload);
    return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
  }
  return decodeURIComponent(payload);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image decode failed'));
    image.src = dataUrl;
  });
}

async function createSvgRuntime(text, width, height) {
  const normalizedText = normalizeSvgText(text, width, height);
  const dataUrl = svgTextToDataUrl(normalizedText);
  const image = await loadImage(dataUrl);
  return { runtime: { kind: SVG_RUNTIME_KIND, width, height, image, rasterCache: new Map() }, dataUrl };
}

function cacheKey(node, geometry) {
  return [node.w, node.h, node.image?.fit || 'stretch', geometry.cropX, geometry.cropY, geometry.cropWidth, geometry.cropHeight].join(':');
}

function renderSvgNode(node, runtime) {
  const width = Math.max(1, Math.round(node.w)), height = Math.max(1, Math.round(node.h));
  const geometry = computeImageGeometry(node, runtime.width, runtime.height);
  const key = cacheKey({ ...node, w: width, h: height }, geometry);
  const cached = runtime.rasterCache?.get(key);
  if (cached) return cached;
  assertDimensions(width, height, MAX_RASTER_PIXELS);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.drawImage(runtime.image, geometry.cropX, geometry.cropY, geometry.cropWidth, geometry.cropHeight, geometry.offsetX, geometry.offsetY, geometry.drawWidth, geometry.drawHeight);
  const result = { width, height, data: context.getImageData(0, 0, width, height).data };
  if (!runtime.rasterCache) runtime.rasterCache = new Map();
  runtime.rasterCache.set(key, result);
  let cachedPixels = [...runtime.rasterCache.values()].reduce((sum, item) => sum + item.width * item.height, 0);
  while (runtime.rasterCache.size > MAX_CACHE_ENTRIES || cachedPixels > MAX_CACHE_PIXELS) {
    const oldest = runtime.rasterCache.keys().next().value;
    const removed = runtime.rasterCache.get(oldest);
    cachedPixels -= removed.width * removed.height;
    runtime.rasterCache.delete(oldest);
  }
  return result;
}

function isSvgAsset(record) { return record?.meta?.mime === 'image/svg+xml' || /^data:image\/svg\+xml/i.test(String(record?.dataUrl || '')); }

async function decodeRasterImage(dataUrl) {
  const image = await loadImage(dataUrl);
  const width = Math.max(1, Math.round(image.naturalWidth || image.width)), height = Math.max(1, Math.round(image.naturalHeight || image.height));
  assertDimensions(width, height, MAX_IMAGE_PIXELS);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

function sourceSizeForAsset(editor, assetId, fallback) {
  for (const page of editor.state.project.pages || []) {
    const node = (page.nodes || []).find(item => item.assetId === assetId && item.sourceType === 'svg');
    if (node) return { width: Math.max(1, Math.round(node.sourceWidth || fallback.width)), height: Math.max(1, Math.round(node.sourceHeight || fallback.height)) };
  }
  return fallback;
}

async function importSvgText(editor, text, name = 'svg', { replaceTargetId = null } = {}) {
  const meta = parseSvgMeta(text);
  const { runtime, dataUrl } = await createSvgRuntime(text, meta.width, meta.height);
  return editor.addImageAsset(dataUrl, runtime, name, 'image/svg+xml', { sourceType: 'svg', svgViewBox: meta.viewBox, replaceTargetId });
}

async function hydrateAssets(editor, { strict = false } = {}) {
  const problems = [];
  for (const font of editor.state.project.fonts || []) {
    if (typeof editor.registerFont !== 'function') continue;
    try { await editor.registerFont(font); }
    catch (error) { problems.push(`字体 ${font.name || font.family}: ${error.message}`); }
  }
  for (const record of editor.state.assets.records()) {
    if (record.type !== 'image' || editor.state.assets.getRuntime(record.id)) continue;
    try {
      if (isSvgAsset(record)) {
        const sourceText = svgTextFromDataUrl(record.dataUrl);
        const parsed = parseSvgMeta(sourceText);
        const sourceSize = sourceSizeForAsset(editor, record.id, parsed);
        const { runtime, dataUrl } = await createSvgRuntime(sourceText, sourceSize.width, sourceSize.height);
        editor.state.assets.set({ ...record, dataUrl, meta: { ...record.meta, mime: 'image/svg+xml' } });
        editor.state.assets.setRuntime(record.id, runtime);
      } else editor.state.assets.setRuntime(record.id, await decodeRasterImage(record.dataUrl));
    } catch (error) { problems.push(`资源 ${record.meta?.name || record.id}: ${error.message}`); }
  }
  if (problems.length && strict) throw new Error(`无法恢复工程资源：${problems.join('；')}`);
  if (problems.length) editor.notice?.(`资源恢复失败：${problems.join('；')}`);
  return problems;
}

const imageRuntime = Object.freeze({
  kind: SVG_RUNTIME_KIND,
  parseSvgMeta,
  normalizeSvgText,
  renderSvgNode,
  importSvgText,
  hydrateAssets,
  decodeRasterImage,
  computeImageGeometry,
});

export { SVG_RUNTIME_KIND, parseSvgMeta, normalizeSvgText, createSvgRuntime, renderSvgNode, decodeRasterImage, importSvgText, hydrateAssets, computeImageGeometry, imageRuntime };
