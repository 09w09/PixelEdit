// Whole-page content coverage overlay. Page background is intentionally excluded:
// the exported 1-bit frame remains fully opaque, but empty artwork pixels can be inspected.
const PREVIEW_RGB = [114, 183, 255];
const PREVIEW_OPACITY = 0.32;
const PREVIEW_ALPHA = Math.round(PREVIEW_OPACITY * 255);

function drawTransparencyPreview(canvas, coverage) {
  if (!canvas) return;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;
  if (!coverage) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (coverage.length !== canvas.width * canvas.height)
    throw new Error('透明区域尺寸与画布不一致');

  const image = context.createImageData(canvas.width, canvas.height);
  const data = image.data;
  for (let index = 0; index < coverage.length; index += 1) {
    if (coverage[index]) continue;
    const offset = index * 4;
    data[offset] = PREVIEW_RGB[0];
    data[offset + 1] = PREVIEW_RGB[1];
    data[offset + 2] = PREVIEW_RGB[2];
    data[offset + 3] = PREVIEW_ALPHA;
  }
  context.putImageData(image, 0, 0);
}

export { PREVIEW_RGB, PREVIEW_OPACITY, drawTransparencyPreview };
