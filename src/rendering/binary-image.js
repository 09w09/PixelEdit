const DIFFUSION_ALGORITHMS = new Set(['floydSteinberg', 'atkinson']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pixelCount = (width, height) => Math.max(0, Math.round(Number(width) || 0)) * Math.max(0, Math.round(Number(height) || 0));
const luma = (rgba, offset) => rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114;

function coverageFromRgba(rgba, width, height) {
  const alpha = new Uint8Array(pixelCount(width, height));
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3] > 0 ? 1 : 0;
  return alpha;
}

function thresholdToBinary(rgba, width, height, threshold = 128) {
  const count = pixelCount(width, height), bits = new Uint8Array(count), alpha = coverageFromRgba(rgba, width, height);
  const cutoff = clamp(Math.round(Number(threshold) || 0), 0, 255);
  for (let index = 0; index < count; index += 1) if (alpha[index]) bits[index] = luma(rgba, index * 4) < cutoff ? 1 : 0;
  return { width: Math.round(width), height: Math.round(height), bits, alpha };
}

function diffuseToBinary(rgba, width, height, algorithm, alpha) {
  const count = pixelCount(width, height), bits = new Uint8Array(count), buffer = new Float64Array(count);
  for (let index = 0; index < count; index += 1) buffer[index] = luma(rgba, index * 4);
  const add = (x, y, error, factor) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (alpha[index]) buffer[index] += error * factor;
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    if (!alpha[index]) continue;
    const oldValue = buffer[index], white = oldValue >= 128 ? 255 : 0, error = oldValue - white;
    bits[index] = white === 0 ? 1 : 0;
    if (algorithm === 'floydSteinberg') {
      add(x + 1, y, error, 7 / 16); add(x - 1, y + 1, error, 3 / 16); add(x, y + 1, error, 5 / 16); add(x + 1, y + 1, error, 1 / 16);
    } else for (const [dx, dy] of [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]]) add(x + dx, y + dy, error, 1 / 8);
  }
  return bits;
}

function orderedDitherToBinary(rgba, width, height, options, alpha, renderer) {
  const bits = new Uint8Array(pixelCount(width, height));
  const algorithm = options.algorithm === 'blueNoise' ? 'blueNoise' : 'bayer';
  const matrix = [2, 4, 8].includes(Math.round(Number(options.bayerMatrix))) ? Math.round(Number(options.bayerMatrix)) : 4;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    if (!alpha[index]) continue;
    const value = luma(rgba, index * 4);
    bits[index] = renderer.graphicDitherPixel({ type: algorithm, density: 100 - value / 255 * 100, matrix, align: 'global', offsetX: 0, offsetY: 0 }, x, y, x, y) ? 1 : 0;
  }
  return bits;
}

function createBinaryImagePipeline(renderer) {
  if (!renderer?.ImageRenderer?.render || typeof renderer.graphicDitherPixel !== 'function') throw new Error('PixelEditor image rendering dependencies are not initialized');
  function ditherToBinary(rgba, width, height, options = {}) {
    width = Math.max(1, Math.round(Number(width) || 1)); height = Math.max(1, Math.round(Number(height) || 1));
    const alpha = coverageFromRgba(rgba, width, height), algorithm = options.algorithm || 'bayer';
    const bits = DIFFUSION_ALGORITHMS.has(algorithm) ? diffuseToBinary(rgba, width, height, algorithm, alpha) : orderedDitherToBinary(rgba, width, height, options, alpha, renderer);
    return { width, height, bits, alpha };
  }
  function applyFinalBinaryInvert(result, invert) {
    if (!result) return null;
    const bits = new Uint8Array(result.bits || []), alpha = new Uint8Array(result.alpha || bits.length);
    if (invert) for (let index = 0; index < bits.length; index += 1) if (alpha[index]) bits[index] = bits[index] ? 0 : 1;
    return { ...result, bits, alpha };
  }
  function binaryImageForNode(node, assets) {
    const rgba = renderer.ImageRenderer.render(node, assets);
    if (!rgba) return null;
    const options = node.image || {};
    const base = options.bwMode === 'dither'
      ? ditherToBinary(rgba.data, rgba.width, rgba.height, { algorithm: options.ditherAlgorithm || 'bayer', bayerMatrix: options.bayerMatrix || 4 })
      : thresholdToBinary(rgba.data, rgba.width, rgba.height, options.threshold ?? 128);
    return applyFinalBinaryInvert(base, options.invert === true);
  }
  return { thresholdToBinary, ditherToBinary, applyFinalBinaryInvert, binaryImageForNode };
}

function binaryResultToRgba(result) {
  const data = new Uint8ClampedArray(result.width * result.height * 4);
  for (let index = 0; index < result.bits.length; index += 1) {
    const offset = index * 4, value = result.bits[index] ? 0 : 255;
    data[offset] = data[offset + 1] = data[offset + 2] = value;
    data[offset + 3] = result.alpha[index] ? 255 : 0;
  }
  return data;
}

function installBinaryImageRuntime(target = globalThis) {
  const PE = target.PixelEditor, R = PE?.renderer;
  if (!R?.ImageRenderer) throw new Error('PixelEditor image runtime is not initialized');
  if (PE.binaryImageInstalled) return;
  PE.binaryImageInstalled = true;
  const pipeline = createBinaryImagePipeline(R);
  PE.binaryImage = pipeline;
  R.thresholdRgba = function thresholdRgba(r, g, b, a = 255, threshold = 128, invert = false) {
    return pipeline.applyFinalBinaryInvert(thresholdToBinary(new Uint8ClampedArray([r, g, b, a]), 1, 1, threshold), invert).bits[0];
  };
  R.ditherImageData = function ditherImageData(rgba, width, height, options = {}) {
    return pipeline.applyFinalBinaryInvert(pipeline.ditherToBinary(rgba, width, height, options), options.invert === true).bits;
  };
}

export { thresholdToBinary, createBinaryImagePipeline, binaryResultToRgba, installBinaryImageRuntime };
