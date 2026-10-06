const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function computeImageGeometry(node, sourceWidth, sourceHeight) {
  const options = node?.image || {};
  const width = Math.max(1, Math.round(Number(sourceWidth) || 1));
  const height = Math.max(1, Math.round(Number(sourceHeight) || 1));
  const targetWidth = Math.max(1, Number(node?.w) || 1);
  const targetHeight = Math.max(1, Number(node?.h) || 1);
  const cropX = clamp(Math.round(options.cropX || 0), 0, Math.max(0, width - 1));
  const cropY = clamp(Math.round(options.cropY || 0), 0, Math.max(0, height - 1));
  const cropWidth = clamp(Math.round(options.cropW || width), 1, Math.max(1, width - cropX));
  const cropHeight = clamp(Math.round(options.cropH || height), 1, Math.max(1, height - cropY));
  let drawWidth = targetWidth;
  let drawHeight = targetHeight;
  let offsetX = 0;
  let offsetY = 0;
  if (options.fit === 'original') {
    drawWidth = cropWidth;
    drawHeight = cropHeight;
  } else if (options.fit === 'contain') {
    const scale = Math.min(targetWidth / cropWidth, targetHeight / cropHeight);
    drawWidth = cropWidth * scale;
    drawHeight = cropHeight * scale;
    offsetX = (targetWidth - drawWidth) / 2;
    offsetY = (targetHeight - drawHeight) / 2;
  } else if (options.fit === 'cover') {
    const scale = Math.max(targetWidth / cropWidth, targetHeight / cropHeight);
    drawWidth = cropWidth * scale;
    drawHeight = cropHeight * scale;
    offsetX = (targetWidth - drawWidth) / 2;
    offsetY = (targetHeight - drawHeight) / 2;
  }
  return { cropX, cropY, cropWidth, cropHeight, drawWidth, drawHeight, offsetX, offsetY };
}

export { computeImageGeometry };
