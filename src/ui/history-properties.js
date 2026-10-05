function installHistoryPropertiesRuntime(target = globalThis) {
  const HistoryDock = target.PixelEditor?.ui?.HistoryDock;
  if (!HistoryDock) throw new Error('PixelEditor history dock is not initialized');
  return HistoryDock;
}

export { installHistoryPropertiesRuntime };
