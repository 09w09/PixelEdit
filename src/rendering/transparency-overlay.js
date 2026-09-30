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

function installTransparencyOverlayRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const Workspace = PE?.ui?.Workspace;
  const decode = PE?.tristateRaster?.decodeTriStatePixels;
  if (!M || !Workspace || !decode) throw new Error('PixelEditor transparency dependencies are not initialized');
  if (PE.transparencyOverlayInstalled) return;
  PE.transparencyOverlayInstalled = true;

  const originalRenderOverlay = Workspace.prototype.renderOverlay;
  Workspace.prototype.renderOverlay = function renderOverlayWithTransparency() {
    originalRenderOverlay.call(this);
    if (!this.editorPreferences?.transparencyPreview || !this.overlay) return;
    const id = this.state.selection.primaryId;
    if (!id) return;
    const node = M.nodeById(this.activePage(), id);
    if (!node || node.type !== 'raster') return;
    const markup = transparencyPreviewMarkup(node, decode);
    if (markup) this.overlay.insertAdjacentHTML('afterbegin', markup);
  };

  PE.transparencyOverlay = {
    PREVIEW_FILL,
    PREVIEW_OPACITY,
    transparentPixelRects: node => transparentPixelRects(node, decode),
    transparencyPreviewMarkup: node => transparencyPreviewMarkup(node, decode),
  };
}

export {
  PREVIEW_FILL,
  PREVIEW_OPACITY,
  transparentPixelRects,
  transparencyPreviewMarkup,
  installTransparencyOverlayRuntime,
};
