function overlayIsLocal(node) {
  return !['line', 'polygon'].includes(node.type);
}

function applyNodeOverlay(layer, node) {
  const local = overlayIsLocal(node);
  for (const [key, value] of Object.entries(node.overlay || {})) {
    const [x, y] = key.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    layer.plot(local ? (Number(node.x) || 0) + x : x, local ? (Number(node.y) || 0) + y : y, value, true);
  }
}

function finishNode(context, node, layer, bounds) {
  applyNodeOverlay(layer, node);
  context.compositeNodeLayer(node, layer, bounds);
}

export { applyNodeOverlay, finishNode };
