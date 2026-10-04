function resizedPoints(points, count) {
  const result = (points || []).map(point => ({ ...point }));
  while (result.length < count) {
    const last = result.at(-1) || { x: 0, y: 0 }, previous = result.at(-2) || last;
    result.push({ x: last.x + (last.x - previous.x || 10), y: last.y + (last.y - previous.y) });
  }
  while (result.length > count) result.pop();
  return result;
}
function installLiveImageStructuralPropertiesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (PE) PE.liveImageStructuralProperties = { resizedPoints };
  return PE?.liveImageStructuralProperties || null;
}
export { resizedPoints, installLiveImageStructuralPropertiesRuntime };
