const SVG_RUNTIME_KIND = 'svg-vector';
const MAX_CACHE_ENTRIES = 32;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseNumericLength(value) {
  const match = String(value ?? '').trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))/);
  if (!match) return NaN;
  return Number(match[1]);
}

function parseSvgMeta(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(text), 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  const root = doc.documentElement;
  if (parseError || !root || root.localName !== 'svg') {
    throw new Error('Invalid SVG');
  }

  const viewBoxRaw = root.getAttribute('viewBox');
  const viewBox = viewBoxRaw
    ? viewBoxRaw.trim().split(/[\s,]+/).map(Number)
    : null;
  const validViewBox =
    viewBox &&
    viewBox.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0;

  let width = validViewBox ? Math.abs(viewBox[2]) : parseNumericLength(root.getAttribute('width'));
  let height = validViewBox ? Math.abs(viewBox[3]) : parseNumericLength(root.getAttribute('height'));

  if (!Number.isFinite(width) || width <= 0) width = 300;
  if (!Number.isFinite(height) || height <= 0) height = 150;

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    viewBox: validViewBox ? viewBox : null,
  };
}

function normalizeSvgText(text, width, height) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(text), 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  const root = doc.documentElement;
  if (parseError || !root || root.localName !== 'svg') {
    throw new Error('Invalid SVG');
  }

  if (!root.getAttribute('xmlns')) {
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  root.setAttribute('width', String(Math.max(1, Math.round(width))));
  root.setAttribute('height', String(Math.max(1, Math.round(height))));

  return new XMLSerializer().serializeToString(root);
}

function svgTextToDataUrl(text) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}

function svgTextFromDataUrl(dataUrl) {
  const value = String(dataUrl || '');
  const comma = value.indexOf(',');
  if (comma < 0 || !/^data:image\/svg\+xml/i.test(value)) {
    throw new Error('Invalid SVG data URL');
  }

  const header = value.slice(0, comma);
  const payload = value.slice(comma + 1);
  if (/;base64/i.test(header)) {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(payload);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('SVG image decode failed'));
    image.src = dataUrl;
  });
}

async function createSvgRuntime(text, width, height) {
  const normalizedText = normalizeSvgText(text, width, height);
  const dataUrl = svgTextToDataUrl(normalizedText);
  const image = await loadImage(dataUrl);
  return {
    runtime: {
      kind: SVG_RUNTIME_KIND,
      width,
      height,
      image,
      rasterCache: new Map(),
    },
    dataUrl,
  };
}

function imageGeometry(node, sourceWidth, sourceHeight) {
  const options = node.image || {};
  const cropX = clamp(Math.round(options.cropX || 0), 0, Math.max(0, sourceWidth - 1));
  const cropY = clamp(Math.round(options.cropY || 0), 0, Math.max(0, sourceHeight - 1));
  const cropWidth = clamp(
    Math.round(options.cropW || sourceWidth),
    1,
    Math.max(1, sourceWidth - cropX),
  );
  const cropHeight = clamp(
    Math.round(options.cropH || sourceHeight),
    1,
    Math.max(1, sourceHeight - cropY),
  );

  let drawWidth = node.w;
  let drawHeight = node.h;
  let offsetX = 0;
  let offsetY = 0;

  if (options.fit === 'original') {
    drawWidth = cropWidth;
    drawHeight = cropHeight;
  } else if (options.fit === 'contain') {
    const scale = Math.min(node.w / cropWidth, node.h / cropHeight);
    drawWidth = cropWidth * scale;
    drawHeight = cropHeight * scale;
    offsetX = (node.w - drawWidth) / 2;
    offsetY = (node.h - drawHeight) / 2;
  } else if (options.fit === 'cover') {
    const scale = Math.max(node.w / cropWidth, node.h / cropHeight);
    drawWidth = cropWidth * scale;
    drawHeight = cropHeight * scale;
    offsetX = (node.w - drawWidth) / 2;
    offsetY = (node.h - drawHeight) / 2;
  }

  return {
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    drawWidth,
    drawHeight,
    offsetX,
    offsetY,
  };
}

function cacheKey(node, geometry) {
  const image = node.image || {};
  return [
    node.w,
    node.h,
    image.fit || 'stretch',
    geometry.cropX,
    geometry.cropY,
    geometry.cropWidth,
    geometry.cropHeight,
  ].join(':');
}

function renderSvgNode(node, runtime) {
  const width = Math.max(1, Math.round(node.w));
  const height = Math.max(1, Math.round(node.h));
  const geometry = imageGeometry(node, runtime.width, runtime.height);
  const key = cacheKey({ ...node, w: width, h: height }, geometry);
  const cached = runtime.rasterCache?.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.drawImage(
    runtime.image,
    geometry.cropX,
    geometry.cropY,
    geometry.cropWidth,
    geometry.cropHeight,
    geometry.offsetX,
    geometry.offsetY,
    geometry.drawWidth,
    geometry.drawHeight,
  );

  const result = {
    width,
    height,
    data: context.getImageData(0, 0, width, height).data,
  };

  if (!runtime.rasterCache) runtime.rasterCache = new Map();
  runtime.rasterCache.set(key, result);
  while (runtime.rasterCache.size > MAX_CACHE_ENTRIES) {
    runtime.rasterCache.delete(runtime.rasterCache.keys().next().value);
  }
  return result;
}

function isSvgAsset(record) {
  return (
    record?.meta?.mime === 'image/svg+xml' ||
    /^data:image\/svg\+xml/i.test(String(record?.dataUrl || ''))
  );
}

async function decodeRasterImage(dataUrl) {
  const image = await loadImage(dataUrl);
  const width = Math.max(1, Math.round(image.naturalWidth || image.width));
  const height = Math.max(1, Math.round(image.naturalHeight || image.height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return {
    width,
    height,
    data: context.getImageData(0, 0, width, height).data,
  };
}

function sourceSizeForAsset(editor, assetId, fallback) {
  for (const page of editor.state.project.pages || []) {
    const node = (page.nodes || []).find(item => item.assetId === assetId && item.sourceType === 'svg');
    if (node) {
      return {
        width: Math.max(1, Math.round(node.sourceWidth || fallback.width)),
        height: Math.max(1, Math.round(node.sourceHeight || fallback.height)),
      };
    }
  }
  return fallback;
}

export function installSvgVectorRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.renderer?.ImageRenderer || !PE?.ui?.Workspace) {
    throw new Error('PixelEditor is not initialized');
  }
  if (PE.svgVectorRuntimeInstalled) return;
  PE.svgVectorRuntimeInstalled = true;

  const originalRender = PE.renderer.ImageRenderer.render;
  PE.renderer.ImageRenderer.render = function renderImage(node, assets) {
    const runtime = assets.getRuntime(node.assetId);
    if (runtime?.kind === SVG_RUNTIME_KIND) {
      return renderSvgNode(node, runtime);
    }
    return originalRender.call(this, node, assets);
  };

  PE.ui.Workspace.prototype.importSvgText = async function importSvgText(
    text,
    name = 'svg',
    { replaceTargetId = null } = {},
  ) {
    const meta = parseSvgMeta(text);
    const { runtime, dataUrl } = await createSvgRuntime(text, meta.width, meta.height);
    return this.addImageAsset(dataUrl, runtime, name, 'image/svg+xml', {
      sourceType: 'svg',
      svgViewBox: meta.viewBox,
      replaceTargetId,
    });
  };

  PE.ui.Workspace.prototype.hydrateAssets = async function hydrateAssets() {
    for (const font of this.state.project.fonts || []) {
      await this.registerFont(font).catch(() => {});
    }

    for (const record of this.state.assets.records()) {
      if (record.type !== 'image' || this.state.assets.getRuntime(record.id)) continue;

      try {
        if (isSvgAsset(record)) {
          const sourceText = svgTextFromDataUrl(record.dataUrl);
          const parsed = parseSvgMeta(sourceText);
          const sourceSize = sourceSizeForAsset(this, record.id, parsed);
          const { runtime, dataUrl } = await createSvgRuntime(
            sourceText,
            sourceSize.width,
            sourceSize.height,
          );
          this.state.assets.set({
            ...record,
            dataUrl,
            meta: { ...record.meta, mime: 'image/svg+xml' },
          });
          this.state.assets.setRuntime(record.id, runtime);
        } else {
          this.state.assets.setRuntime(record.id, await decodeRasterImage(record.dataUrl));
        }
      } catch {
        // Keep the asset record intact. The editor already tolerates a missing runtime.
      }
    }
  };

  PE.svgVectorRuntime = {
    kind: SVG_RUNTIME_KIND,
    parseSvgMeta,
    normalizeSvgText,
    renderSvgNode,
  };
}

if (globalThis.PixelEditor) {
  installSvgVectorRuntime(globalThis);
}
