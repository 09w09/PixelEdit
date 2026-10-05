import { nodeById } from '../model/index.js';

function canPaintSelection(editor, { notify = true } = {}) {
  const page = editor?.activePage?.();
  const selected = nodeById(page, editor?.state?.selection?.primaryId);
  if (selected && selected.type !== 'raster') {
    if (notify) editor?.notice?.('图片、文字和矢量图层不能直接涂鸦，请先栅格化后再使用铅笔或橡皮。');
    return false;
  }
  return true;
}

const editBoundaries = Object.freeze({ canPaintSelection });

export { canPaintSelection, editBoundaries };
