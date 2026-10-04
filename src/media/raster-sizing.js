function installRasterSizingRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.rasterLayer?.resizeRaster) throw new Error('PixelEditor raster sizing dependencies are not initialized');
  if (PE.rasterSizingInstalled) return;
  PE.rasterSizingInstalled = true;
}

export { installRasterSizingRuntime };
