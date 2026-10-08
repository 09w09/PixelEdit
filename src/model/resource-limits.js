// Imported resources are untrusted. Limit allocations before decoding or rasterization.
const MAX_PROJECT_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_FONT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SVG_BYTES = 1024 * 1024;
const MAX_IMAGE_PIXELS = 8 * 1024 * 1024;
const MAX_RASTER_PIXELS = 2 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_NODES_PER_PAGE = 2000;
const MAX_ASSETS = 2048;
const MAX_OVERLAY_POINTS = 400 * 300;

function assertSize(value, limit, name = '文件') {
  if (!Number.isFinite(value) || value < 0 || value > limit)
    throw new Error(`${name}过大（限制 ${Math.floor(limit / 1024 / 1024)} MiB）`);
}
function assertDimensions(width, height, limit = MAX_IMAGE_PIXELS) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > limit / height)
    throw new Error('图片或图层尺寸超出允许范围');
  return width * height;
}
function assertProjectText(raw) {
  if (typeof raw !== 'string') return;
  // JSON uses UTF-16 JS strings; avoid constructing an additional UTF-8 copy here.
  assertSize(raw.length * 2, MAX_PROJECT_BYTES, '工程文件');
}
export { MAX_PROJECT_BYTES, MAX_IMAGE_FILE_BYTES, MAX_FONT_FILE_BYTES, MAX_SVG_BYTES,
  MAX_IMAGE_PIXELS, MAX_RASTER_PIXELS, MAX_PAGES, MAX_NODES_PER_PAGE,
  MAX_ASSETS, MAX_OVERLAY_POINTS, assertSize, assertDimensions, assertProjectText };
