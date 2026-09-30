function installEditBoundariesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const Workspace = PE?.ui?.Workspace;
  if (!M || !Workspace) throw new Error('PixelEditor is not initialized');
  if (PE.editBoundariesInstalled) return;
  PE.editBoundariesInstalled = true;

  const previousBeginPaint = Workspace.prototype.beginPaint;
  Workspace.prototype.beginPaint = function beginPaint(point) {
    const page = this.activePage();
    const selected = M.nodeById(page, this.state.selection.primaryId);
    if (selected && selected.type !== 'raster') {
      this.notice('图片、文字和矢量图层不能直接涂鸦，请先栅格化后再使用铅笔或橡皮。');
      return false;
    }
    return previousBeginPaint.call(this, point);
  };
}

export { installEditBoundariesRuntime };
