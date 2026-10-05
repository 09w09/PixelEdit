const R = globalThis.PixelEditor.renderer;

function sample(source, x, y, mode = 'nearest') {
  const { width, height, data } = source;
  if (mode === 'bilinear') {
    const fx0 = R.clamp(x, 0, width - 1);
    const fy0 = R.clamp(y, 0, height - 1);
    const x0 = Math.floor(fx0);
    const y0 = Math.floor(fy0);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const fx = fx0 - x0;
    const fy = fy0 - y0;
    const out = new Uint8ClampedArray(4);
    for (let channel = 0; channel < 4; channel += 1) {
      const a = data[(y0 * width + x0) * 4 + channel];
      const b = data[(y0 * width + x1) * 4 + channel];
      const c = data[(y1 * width + x0) * 4 + channel];
      const d = data[(y1 * width + x1) * 4 + channel];
      out[channel] = Math.round((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy);
    }
    return out;
  }
  const xi = R.clamp(Math.floor(x), 0, width - 1);
  const yi = R.clamp(Math.floor(y), 0, height - 1);
  const offset = (yi * width + xi) * 4;
  return data.slice(offset, offset + 4);
}

function render(node, assets) {
  const source = assets.getRuntime(node.assetId);
  if (!source) return null;
  if (source.kind === 'svg-vector' && globalThis.PixelEditor?.svgVectorRuntime?.renderSvgNode) {
    return globalThis.PixelEditor.svgVectorRuntime.renderSvgNode(node, source);
  }

  const output = new Uint8ClampedArray(node.w * node.h * 4);
  const settings = node.image || {};
  const cropX = R.clamp(Math.round(settings.cropX || 0), 0, source.width - 1);
  const cropY = R.clamp(Math.round(settings.cropY || 0), 0, source.height - 1);
  const cropWidth = R.clamp(Math.round(settings.cropW || source.width), 1, source.width - cropX);
  const cropHeight = R.clamp(Math.round(settings.cropH || source.height), 1, source.height - cropY);
  let drawWidth = node.w;
  let drawHeight = node.h;
  let offsetX = 0;
  let offsetY = 0;

  if (settings.fit === 'original') {
    drawWidth = cropWidth;
    drawHeight = cropHeight;
  } else if (settings.fit === 'contain') {
    const scale = Math.min(node.w / cropWidth, node.h / cropHeight);
    drawWidth = cropWidth * scale;
    drawHeight = cropHeight * scale;
    offsetX = (node.w - drawWidth) / 2;
    offsetY = (node.h - drawHeight) / 2;
  } else if (settings.fit === 'cover') {
    const scale = Math.max(node.w / cropWidth, node.h / cropHeight);
    drawWidth = cropWidth * scale;
    drawHeight = cropHeight * scale;
    offsetX = (node.w - drawWidth) / 2;
    offsetY = (node.h - drawHeight) / 2;
  }

  const nearest = settings.interpolation !== 'bilinear';
  const identity = nearest && offsetX === 0 && offsetY === 0
    && drawWidth === cropWidth && drawHeight === cropHeight
    && node.w === cropWidth && node.h === cropHeight;

  for (let y = 0; y < node.h; y += 1) {
    for (let x = 0; x < node.w; x += 1) {
      const target = (y * node.w + x) * 4;
      if (x < offsetX || y < offsetY || x >= offsetX + drawWidth || y >= offsetY + drawHeight) {
        output[target + 3] = 0;
        continue;
      }

      let pixel;
      if (identity) {
        const sourceOffset = ((cropY + y) * source.width + (cropX + x)) * 4;
        pixel = source.data.slice(sourceOffset, sourceOffset + 4);
      } else if (nearest) {
        const sourceX = cropX + Math.floor(((x - offsetX) + 0.5) * cropWidth / Math.max(1, drawWidth));
        const sourceY = cropY + Math.floor(((y - offsetY) + 0.5) * cropHeight / Math.max(1, drawHeight));
        pixel = sample(source, sourceX, sourceY, 'nearest');
      } else {
        const sourceX = cropX + ((x - offsetX) + 0.5) * cropWidth / Math.max(1, drawWidth) - 0.5;
        const sourceY = cropY + ((y - offsetY) + 0.5) * cropHeight / Math.max(1, drawHeight) - 0.5;
        pixel = sample(source, sourceX, sourceY, 'bilinear');
      }
      output.set(pixel, target);
    }
  }

  return { width: node.w, height: node.h, data: output };
}

R.ImageRenderer = { render };

export { sample, render };
