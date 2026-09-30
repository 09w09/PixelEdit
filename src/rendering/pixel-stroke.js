function rasterThinLine(x1, y1, x2, y2, emit) {
  let x = Math.round(x1);
  let y = Math.round(y1);
  const endX = Math.round(x2);
  const endY = Math.round(y2);
  const dx = Math.abs(endX - x);
  const sx = x < endX ? 1 : -1;
  const dy = -Math.abs(endY - y);
  const sy = y < endY ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    emit(x, y);
    if (x === endX && y === endY) break;
    const error2 = error * 2;
    if (error2 >= dy) {
      error += dy;
      x += sx;
    }
    if (error2 <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function normalizedLineWidth(value) {
  return Math.max(1, Math.round(Number(value) || 1));
}

function strokeOffsetStart(lineWidth) {
  return -Math.floor((lineWidth - 1) / 2);
}

function forEachStrokePixel(x1, y1, x2, y2, lineWidth, emit) {
  const width = normalizedLineWidth(lineWidth);
  const startX = Math.round(x1);
  const startY = Math.round(y1);
  const endX = Math.round(x2);
  const endY = Math.round(y2);
  const dx = endX - startX;
  const dy = endY - startY;
  const offsetStart = strokeOffsetStart(width);

  if (dx === 0 && dy === 0) {
    for (let oy = 0; oy < width; oy += 1) {
      for (let ox = 0; ox < width; ox += 1) {
        emit(startX + offsetStart + ox, startY + offsetStart + oy);
      }
    }
    return;
  }

  const horizontalDominant = Math.abs(dx) >= Math.abs(dy);
  for (let index = 0; index < width; index += 1) {
    const offset = offsetStart + index;
    const offsetX = horizontalDominant ? 0 : offset;
    const offsetY = horizontalDominant ? offset : 0;
    rasterThinLine(
      startX + offsetX,
      startY + offsetY,
      endX + offsetX,
      endY + offsetY,
      emit,
    );
  }
}

function lineStrokeBounds(node) {
  const lineWidth = Math.round(Number(node?.stroke?.width) || 0);
  if (!node || lineWidth <= 0) {
    const x1 = Math.round(Number(node?.x1) || 0);
    const y1 = Math.round(Number(node?.y1) || 0);
    const x2 = Math.round(Number(node?.x2) || 0);
    const y2 = Math.round(Number(node?.y2) || 0);
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1) + 1,
      h: Math.abs(y2 - y1) + 1,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  forEachStrokePixel(node.x1, node.y1, node.x2, node.y2, lineWidth, (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

function installPixelStrokeRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const R = PE?.renderer;
  const M = PE?.model;
  if (!R?.plotPixel || !R?.FramebufferRenderer || !M) {
    throw new Error('PixelEditor is not initialized');
  }
  if (PE.pixelStrokeRuntimeInstalled) return;
  PE.pixelStrokeRuntimeInstalled = true;

  R.plotThickLine = function plotThickLine(
    framebuffer,
    x1,
    y1,
    x2,
    y2,
    lineWidth = 1,
    value = 1,
  ) {
    forEachStrokePixel(x1, y1, x2, y2, lineWidth, (x, y) => {
      R.plotPixel(framebuffer, x, y, value);
    });
  };

  const originalBounds = R.FramebufferRenderer._bounds;
  const originalVisualBounds = R.FramebufferRenderer.visualBounds;

  R.FramebufferRenderer._bounds = function pixelAccurateBounds(node) {
    if (node?.type === 'line') return lineStrokeBounds(node);
    return originalBounds(node);
  };

  R.FramebufferRenderer.visualBounds = function visualBounds(nodeId, context) {
    const page = M.pageById(context.project, context.pageId);
    const node = M.nodeById(page, nodeId);
    if (node?.type === 'line') return lineStrokeBounds(node);
    return originalVisualBounds.call(this, nodeId, context);
  };

  PE.pixelStrokeRuntime = {
    rasterThinLine,
    forEachStrokePixel,
    lineStrokeBounds,
  };
}

export { rasterThinLine, forEachStrokePixel, lineStrokeBounds, installPixelStrokeRuntime };
