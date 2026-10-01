function drawBinaryPreview(canvas, result) {
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
}

function installBinaryImagePreviewRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Properties = PE?.ui?.Properties;
  const binaryImage = PE?.binaryImage;
  if (!Properties || !binaryImage?.binaryImageForNode) throw new Error('PixelEditor binary image preview dependencies are not initialized');
  if (PE.binaryImagePreviewInstalled) return;
  PE.binaryImagePreviewInstalled = true;

  const previousRenderPreviews = Properties.prototype.renderPreviews;
  Properties.prototype.renderPreviews = function renderCanonicalImagePreview(nodes) {
    const node = nodes?.length === 1 ? nodes[0] : null;
    if (!node || node.type !== 'image') return previousRenderPreviews.call(this, nodes);
    const canvas = this.el?.querySelector?.('#imageDitherPreview');
    if (!canvas) return;
    const result = binaryImage.binaryImageForNode(node, this.editor.state.assets);
    if (result) drawBinaryPreview(canvas, result);
  };
}

export { drawBinaryPreview, installBinaryImagePreviewRuntime };
