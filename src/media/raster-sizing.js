const BOX_TYPES = new Set(['rectangle', 'circle', 'text', 'image', 'raster']);

function installRasterSizingRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const Workspace = PE?.ui?.Workspace;
  const resizeRaster = PE?.rasterLayer?.resizeRaster;
  if (!M || !C || !Workspace || !resizeRaster) throw new Error('PixelEditor is not initialized');
  if (PE.rasterSizingInstalled) return;
  PE.rasterSizingInstalled = true;

  const previousSetSelectionSize = Workspace.prototype.setSelectionSize;
  Workspace.prototype.setSelectionSize = function setSelectionSize(axis, targetValue) {
    const page = this.activePage();
    const ids = this.state.selection.ids.filter(id => BOX_TYPES.has(M.nodeById(page, id)?.type));
    const containsRaster = ids.some(id => M.nodeById(page, id)?.type === 'raster');
    if (!containsRaster) return previousSetSelectionSize.call(this, axis, targetValue);

    const target = Math.max(1, Math.round(Number(targetValue)));
    if (!ids.length || !Number.isFinite(target)) return false;

    return this.exec(new C.UpdateNodesCommand(ids, node => {
      const ratio = node.w / Math.max(1, node.h);
      let w = node.w;
      let h = node.h;
      if (axis === 'w') {
        w = target;
        if (node.aspectLocked) h = Math.max(1, Math.round(target / ratio));
      } else {
        h = target;
        if (node.aspectLocked) w = Math.max(1, Math.round(target * ratio));
      }

      if (node.type === 'raster') {
        return resizeRaster(node, { x: node.x, y: node.y, w, h });
      }
      const patch = {};
      if (w !== node.w) patch.w = w;
      if (h !== node.h) patch.h = h;
      return patch;
    }, page.id, '调整尺寸'));
  };
}

export { installRasterSizingRuntime };
