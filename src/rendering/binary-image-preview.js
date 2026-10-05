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

export { drawBinaryPreview };
