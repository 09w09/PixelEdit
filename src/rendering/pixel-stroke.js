function rasterThinLine(x1, y1, x2, y2, emit) {
  let x = Math.round(x1), y = Math.round(y1);
  const endX = Math.round(x2), endY = Math.round(y2), dx = Math.abs(endX - x), sx = x < endX ? 1 : -1, dy = -Math.abs(endY - y), sy = y < endY ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    emit(x, y);
    if (x === endX && y === endY) break;
    const error2 = error * 2;
    if (error2 >= dy) { error += dy; x += sx; }
    if (error2 <= dx) { error += dx; y += sy; }
  }
}

const normalizedLineWidth = value => Math.max(1, Math.round(Number(value) || 1));
const strokeOffsetStart = width => -Math.floor((width - 1) / 2);

function forEachStrokePixel(x1, y1, x2, y2, lineWidth, emit) {
  const width = normalizedLineWidth(lineWidth), startX = Math.round(x1), startY = Math.round(y1), endX = Math.round(x2), endY = Math.round(y2);
  const dx = endX - startX, dy = endY - startY, offsetStart = strokeOffsetStart(width);
  if (dx === 0 && dy === 0) {
    for (let oy = 0; oy < width; oy += 1) for (let ox = 0; ox < width; ox += 1) emit(startX + offsetStart + ox, startY + offsetStart + oy);
    return;
  }
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  for (let index = 0; index < width; index += 1) {
    const offset = offsetStart + index;
    rasterThinLine(startX + (horizontal ? 0 : offset), startY + (horizontal ? offset : 0), endX + (horizontal ? 0 : offset), endY + (horizontal ? offset : 0), emit);
  }
}

function lineStrokeBounds(node) {
  const width = Math.round(Number(node?.stroke?.width) || 0);
  if (!node || width <= 0) {
    const x1 = Math.round(Number(node?.x1) || 0), y1 = Math.round(Number(node?.y1) || 0), x2 = Math.round(Number(node?.x2) || 0), y2 = Math.round(Number(node?.y2) || 0);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) + 1, h: Math.abs(y2 - y1) + 1 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  forEachStrokePixel(node.x1, node.y1, node.x2, node.y2, width, (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function installPixelStrokeRuntime(target = globalThis) {
  const PE = target.PixelEditor, R = PE?.renderer;
  if (!R) throw new Error('PixelEditor is not initialized');
  if (PE.pixelStrokeRuntimeInstalled) return;
  PE.pixelStrokeRuntimeInstalled = true;
  PE.pixelStrokeRuntime = { rasterThinLine, forEachStrokePixel, lineStrokeBounds };
  if (typeof R.plotPixel === 'function') R.plotThickLine = (framebuffer, x1, y1, x2, y2, width = 1, value = 1) => forEachStrokePixel(x1, y1, x2, y2, width, (x, y) => R.plotPixel(framebuffer, x, y, value));
}

export { rasterThinLine, forEachStrokePixel, lineStrokeBounds, installPixelStrokeRuntime };
