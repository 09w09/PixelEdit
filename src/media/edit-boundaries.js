function canPaintSelection(editor, { notify = true } = {}) {
  const M = globalThis.PixelEditor?.model;
  const page = editor?.activePage?.();
  const selected = M?.nodeById?.(page, editor?.state?.selection?.primaryId);
  if (selected && selected.type !== 'raster') {
    if (notify) editor?.notice?.('图片、文字和矢量图层不能直接涂鸦，请先栅格化后再使用铅笔或橡皮。');
    return false;
  }
  return true;
}

function installEditBoundariesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.model || !PE?.ui?.Workspace) throw new Error('PixelEditor is not initialized');
  if (PE.editBoundariesInstalled) return;
  PE.editBoundariesInstalled = true;
  PE.editBoundaries = { canPaintSelection };
}

export { canPaintSelection, installEditBoundariesRuntime };
