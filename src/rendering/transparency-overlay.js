const PREVIEW_FILL = '#72b7ff';
const PREVIEW_OPACITY = 0.32;

function transparentPixelRects(node, decodePixels) {
  if (!node || node.type !== 'raster') return [];
  const pixels = decodePixels(node.raster.data, node.w, node.h);
  const rects = [];
  for (let y = 0; y < node.h; y += 1) {
    for (let x = 0; x < node.w; x += 1) {
      if (pixels[y * node.w + x] === 0) rects.push({ x: node.x + x, y: node.y + y, w: 1, h: 1 });
    }
  }
  return rects;
}

function transparencyPreviewMarkup(node, decodePixels) {
  return transparentPixelRects(node, decodePixels).map(rect =>
    `<rect data-transparency-preview="true" x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${PREVIEW_FILL}" fill-opacity="${PREVIEW_OPACITY}" stroke="none"/>`,
  ).join('');
}

export {
  PREVIEW_FILL,
  PREVIEW_OPACITY,
  transparentPixelRects,
  transparencyPreviewMarkup,
};
