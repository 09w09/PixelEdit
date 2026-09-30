const RASTER_TRANSPARENT = 0;
const RASTER_WHITE = 1;
const RASTER_BLACK = 2;
const RASTER_ENCODING = 'tristate-packed-v1';

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function normalizeRasterState(value) {
  const state = Number(value);
  if (state === RASTER_WHITE || state === RASTER_BLACK) return state;
  return RASTER_TRANSPARENT;
}

function encodeTriStatePixels(pixels) {
  const source = pixels instanceof Uint8Array ? pixels : Uint8Array.from(pixels || []);
  const bytes = new Uint8Array(Math.ceil(source.length / 4));
  for (let index = 0; index < source.length; index += 1) {
    const state = normalizeRasterState(source[index]);
    bytes[index >> 2] |= state << ((index & 3) * 2);
  }
  return bytesToBase64(bytes);
}

function decodeTriStatePixels(data, width, height) {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  const length = w * h;
  const bytes = base64ToBytes(data);
  const pixels = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    const raw = ((bytes[index >> 2] || 0) >> ((index & 3) * 2)) & 3;
    pixels[index] = raw === 3 ? RASTER_TRANSPARENT : raw;
  }
  return pixels;
}

function createTriStateRaster(width, height, pixels = null, defaultValue = RASTER_TRANSPARENT) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const normalizedDefault = normalizeRasterState(defaultValue);
  const output = new Uint8Array(w * h);
  output.fill(normalizedDefault);
  if (pixels) {
    const source = pixels instanceof Uint8Array ? pixels : Uint8Array.from(pixels);
    const length = Math.min(source.length, output.length);
    for (let index = 0; index < length; index += 1) output[index] = normalizeRasterState(source[index]);
  }
  return { encoding: RASTER_ENCODING, data: encodeTriStatePixels(output) };
}

function pixelsFromRasterNode(node) {
  const w = Math.max(1, Math.round(Number(node?.w) || 1));
  const h = Math.max(1, Math.round(Number(node?.h) || 1));
  if (!node?.raster || node.raster.encoding !== RASTER_ENCODING) throw new Error('V16 栅格数据格式无效');
  return decodeTriStatePixels(node.raster.data, w, h);
}

function paintTriStateRaster(node, points, value) {
  const w = Math.max(1, Math.round(Number(node?.w) || 1));
  const h = Math.max(1, Math.round(Number(node?.h) || 1));
  const pixels = pixelsFromRasterNode(node);
  const state = normalizeRasterState(value);
  for (const point of points || []) {
    const x = Math.round(Number(point.x));
    const y = Math.round(Number(point.y));
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    pixels[y * w + x] = state;
  }
  return createTriStateRaster(w, h, pixels);
}

function resizeTriStateRaster(node, geometry) {
  const oldX = Math.round(Number(node?.x) || 0);
  const oldY = Math.round(Number(node?.y) || 0);
  const oldW = Math.max(1, Math.round(Number(node?.w) || 1));
  const oldH = Math.max(1, Math.round(Number(node?.h) || 1));
  const x = Math.round(Number(geometry?.x) || 0);
  const y = Math.round(Number(geometry?.y) || 0);
  const w = Math.max(1, Math.round(Number(geometry?.w) || 1));
  const h = Math.max(1, Math.round(Number(geometry?.h) || 1));
  const source = pixelsFromRasterNode(node);
  const output = new Uint8Array(w * h);
  output.fill(RASTER_TRANSPARENT);

  for (let ny = 0; ny < h; ny += 1) {
    const sourceY = y + ny - oldY;
    if (sourceY < 0 || sourceY >= oldH) continue;
    for (let nx = 0; nx < w; nx += 1) {
      const sourceX = x + nx - oldX;
      if (sourceX < 0 || sourceX >= oldW) continue;
      output[ny * w + nx] = source[sourceY * oldW + sourceX];
    }
  }
  return { x, y, w, h, raster: createTriStateRaster(w, h, output) };
}

function rasterPixelToComposite(state) {
  const normalized = normalizeRasterState(state);
  if (normalized === RASTER_TRANSPARENT) return { covered: false, color: 0 };
  return { covered: true, color: normalized === RASTER_BLACK ? 1 : 0 };
}

function triStatePixelsToRgba(pixels, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const state = normalizeRasterState(pixels[index]);
    const offset = index * 4;
    if (state === RASTER_TRANSPARENT) {
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 255;
      rgba[offset + 3] = 0;
      continue;
    }
    const value = state === RASTER_BLACK ? 0 : 255;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function installTriStateRasterRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE) throw new Error('PixelEditor is not initialized');
  PE.tristateRaster = {
    RASTER_TRANSPARENT,
    RASTER_WHITE,
    RASTER_BLACK,
    RASTER_ENCODING,
    normalizeRasterState,
    encodeTriStatePixels,
    decodeTriStatePixels,
    createTriStateRaster,
    pixelsFromRasterNode,
    paintTriStateRaster,
    resizeTriStateRaster,
    rasterPixelToComposite,
    triStatePixelsToRgba,
  };
}

export {
  RASTER_TRANSPARENT,
  RASTER_WHITE,
  RASTER_BLACK,
  RASTER_ENCODING,
  normalizeRasterState,
  encodeTriStatePixels,
  decodeTriStatePixels,
  createTriStateRaster,
  pixelsFromRasterNode,
  paintTriStateRaster,
  resizeTriStateRaster,
  rasterPixelToComposite,
  triStatePixelsToRgba,
  installTriStateRasterRuntime,
};
