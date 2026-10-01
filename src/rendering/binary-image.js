const DIFFUSION_ALGORITHMS = new Set(['floydSteinberg', 'atkinson']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function pixelCount(width, height) {
  return Math.max(0, Math.round(Number(width) || 0)) * Math.max(0, Math.round(Number(height) || 0));
}

function luma(rgba, offset) {
  return rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114;
}

function coverageFromRgba(rgba, width, height) {
  const count = pixelCount(width, height);
  const alpha = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) alpha[index] = rgba[index * 4 + 3] > 0 ? 1 : 0;
  return alpha;
}

function thresholdToBinary(rgba, width, height, threshold = 128) {
  const count = pixelCount(width, height);
  const bits = new Uint8Array(count);
  const alpha = coverageFromRgba(rgba, width, height);
  const cutoff = clamp(Math.round(Number(threshold) || 0), 0, 255);
  for (let index = 0; index < count; index += 1) {
    if (!alpha[index]) continue;
    bits[index] = luma(rgba, index * 4) < cutoff ? 1 : 0;
  }
  return { width: Math.round(width), height: Math.round(height), bits, alpha };
}

function diffuseToBinary(rgba, width, height, algorithm, alpha) {
  const count = pixelCount(width, height);
  const bits = new Uint8Array(count);
  const buffer = new Float64Array(count);
  for (let index = 0; index < count; index += 1) buffer[index] = luma(rgba, index * 4);

  const add = (x, y, error, factor) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (!alpha[index]) return;
    buffer[index] += error * factor;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!alpha[index]) continue;
      const oldValue = buffer[index];
      const whiteValue = oldValue >= 128 ? 255 : 0;
      bits[index] = whiteValue === 0 ? 1 : 0;
      const error = oldValue - whiteValue;
      if (algorithm === 'floydSteinberg') {
        add(x + 1, y, error, 7 / 16);
        add(x - 1, y + 1, error, 3 / 16);
        add(x, y + 1, error, 5 / 16);
        add(x + 1, y + 1, error, 1 / 16);
      } else {
        for (const [dx, dy] of [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]]) {
          add(x + dx, y + dy, error, 1 / 8);
        }
      }
    }
  }
  return bits;
}

function orderedDitherToBinary(rgba, width, height, options, alpha, renderer) {
  const bits = new Uint8Array(pixelCount(width, height));
  const algorithm = options.algorithm === 'blueNoise' ? 'blueNoise' : 'bayer';
  const matrix = [2, 4, 8].includes(Math.round(Number(options.bayerMatrix))) ? Math.round(Number(options.bayerMatrix)) : 4;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!alpha[index]) continue;
      const value = luma(rgba, index * 4);
      bits[index] = renderer.graphicDitherPixel({
        type: algorithm,
        density: 100 - value / 255 * 100,
        matrix,
        align: 'global',
        offsetX: 0,
        offsetY: 0,
      }, x, y, x, y) ? 1 : 0;
    }
  }
  return bits;
}

function createBinaryImagePipeline(renderer) {
  if (!renderer?.ImageRenderer?.render || typeof renderer.graphicDitherPixel !== 'function') {
    throw new Error('PixelEditor image rendering dependencies are not initialized');
  }

  function ditherToBinary(rgba, width, height, options = {}) {
    width = Math.max(1, Math.round(Number(width) || 1));
    height = Math.max(1, Math.round(Number(height) || 1));
    const alpha = coverageFromRgba(rgba, width, height);
    const algorithm = options.algorithm || 'bayer';
    const bits = DIFFUSION_ALGORITHMS.has(algorithm)
      ? diffuseToBinary(rgba, width, height, algorithm, alpha)
      : orderedDitherToBinary(rgba, width, height, options, alpha, renderer);
    return { width, height, bits, alpha };
  }

  function applyFinalBinaryInvert(result, invert) {
    if (!result) return null;
    const bits = new Uint8Array(result.bits || []);
    const alpha = new Uint8Array(result.alpha || bits.length);
    if (invert) {
      for (let index = 0; index < bits.length; index += 1) {
        if (alpha[index]) bits[index] = bits[index] ? 0 : 1;
      }
    }
    return { ...result, bits, alpha };
  }

  function binaryImageForNode(node, assets) {
    const rgba = renderer.ImageRenderer.render(node, assets);
    if (!rgba) return null;
    const options = node.image || {};
    const base = options.bwMode === 'dither'
      ? ditherToBinary(rgba.data, rgba.width, rgba.height, {
        algorithm: options.ditherAlgorithm || 'bayer',
        bayerMatrix: options.bayerMatrix || 4,
      })
      : thresholdToBinary(rgba.data, rgba.width, rgba.height, options.threshold ?? 128);
    return applyFinalBinaryInvert(base, options.invert === true);
  }

  return { thresholdToBinary, ditherToBinary, applyFinalBinaryInvert, binaryImageForNode };
}

function binaryResultToRgba(result) {
  const data = new Uint8ClampedArray(result.width * result.height * 4);
  for (let index = 0; index < result.bits.length; index += 1) {
    const offset = index * 4;
    const value = result.bits[index] ? 0 : 255;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = result.alpha[index] ? 255 : 0;
  }
  return data;
}

function installBinaryImageRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const R = PE?.renderer;
  if (!R?.ImageRenderer || !R?.FramebufferRenderer) throw new Error('PixelEditor image runtime is not initialized');
  if (PE.binaryImageInstalled) return;
  PE.binaryImageInstalled = true;

  const pipeline = createBinaryImagePipeline(R);
  PE.binaryImage = pipeline;

  const framebuffer = R.FramebufferRenderer;
  const baseRenderPage = framebuffer.renderPage.bind(framebuffer);
  const baseRenderSubtree = framebuffer.renderSubtree.bind(framebuffer);
  const baseSubtreeRgba = framebuffer.subtreeRgba.bind(framebuffer);

  function adaptProjectImages(project, pageId, assets) {
    const clone = structuredClone(project);
    const sourcePage = (project.pages || []).find(page => page.id === pageId);
    const clonedPage = (clone.pages || []).find(page => page.id === pageId);
    if (!sourcePage || !clonedPage) return { project: clone, assets };

    const runtimeMap = new Map();
    for (const clonedNode of clonedPage.nodes || []) {
      if (clonedNode.type !== 'image') continue;
      const sourceNode = (sourcePage.nodes || []).find(node => node.id === clonedNode.id);
      if (!sourceNode) continue;
      const result = pipeline.binaryImageForNode(sourceNode, assets);
      if (!result) continue;
      const assetId = `__pixeledit_binary__${clonedNode.id}`;
      runtimeMap.set(assetId, { width: result.width, height: result.height, data: binaryResultToRgba(result) });
      clonedNode.assetId = assetId;
      clonedNode.sourceWidth = result.width;
      clonedNode.sourceHeight = result.height;
      clonedNode.image = {
        ...(clonedNode.image || {}),
        fit: 'stretch',
        interpolation: 'nearest',
        cropX: 0,
        cropY: 0,
        cropW: result.width,
        cropH: result.height,
        bwMode: 'threshold',
        threshold: 128,
        invert: false,
      };
    }

    if (!runtimeMap.size) return { project: clone, assets };
    const proxy = Object.create(assets || null);
    proxy.getRuntime = id => runtimeMap.get(id) || assets?.getRuntime?.(id) || null;
    proxy.get = id => assets?.get?.(id) || null;
    return { project: clone, assets: proxy };
  }

  framebuffer.renderPage = function renderBinaryImagePage(project, pageId, assets) {
    const adapted = adaptProjectImages(project, pageId, assets);
    return baseRenderPage(adapted.project, pageId, adapted.assets);
  };
  framebuffer.renderSubtree = function renderBinaryImageSubtree(project, pageId, nodeId, assets, base = 0) {
    const adapted = adaptProjectImages(project, pageId, assets);
    return baseRenderSubtree(adapted.project, pageId, nodeId, adapted.assets, base);
  };
  framebuffer.subtreeRgba = function binaryImageSubtreeRgba(project, pageId, nodeId, assets) {
    const adapted = adaptProjectImages(project, pageId, assets);
    return baseSubtreeRgba(adapted.project, pageId, nodeId, adapted.assets);
  };

  // Keep existing call sites deterministic while ownership moves to the canonical pipeline.
  R.thresholdRgba = function thresholdRgba(r, g, b, a = 255, threshold = 128, invert = false) {
    const result = pipeline.applyFinalBinaryInvert(
      thresholdToBinary(new Uint8ClampedArray([r, g, b, a]), 1, 1, threshold),
      invert,
    );
    return result.bits[0];
  };
  R.ditherImageData = function ditherImageData(rgba, width, height, options = {}) {
    return pipeline.applyFinalBinaryInvert(
      pipeline.ditherToBinary(rgba, width, height, options),
      options.invert === true,
    ).bits;
  };

  const Properties = PE.ui?.Properties;
  const originalRenderPreviews = Properties?.prototype?.renderPreviews;
  if (typeof originalRenderPreviews === 'function') {
    Properties.prototype.renderPreviews = function renderBinaryImagePreviews(nodes) {
      originalRenderPreviews.call(this, nodes);
      if (nodes?.length !== 1 || nodes[0].type !== 'image') return;
      const canvas = this.el?.querySelector?.('#imageDitherPreview');
      if (!canvas) return;
      const result = pipeline.binaryImageForNode(nodes[0], this.editor.state.assets);
      if (!result) return;
      const source = document.createElement('canvas');
      source.width = result.width;
      source.height = result.height;
      const sourceContext = source.getContext('2d');
      const imageData = sourceContext.createImageData(result.width, result.height);
      for (let index = 0; index < result.bits.length; index += 1) {
        const value = result.alpha[index] && result.bits[index] ? 0 : 255;
        const offset = index * 4;
        imageData.data[offset] = value;
        imageData.data[offset + 1] = value;
        imageData.data[offset + 2] = value;
        imageData.data[offset + 3] = 255;
      }
      sourceContext.putImageData(imageData, 0, 0);
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = false;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
    };
  }
}

export {
  thresholdToBinary,
  createBinaryImagePipeline,
  binaryResultToRgba,
  installBinaryImageRuntime,
};