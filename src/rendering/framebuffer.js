class Framebuffer {
  constructor(width = 400, height = 300, { originX = 0, originY = 0, base = 0, opaque = false } = {}) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.originX = Math.round(originX);
    this.originY = Math.round(originY);
    this.bits = new Uint8Array(this.width * this.height);
    this.alpha = new Uint8Array(this.width * this.height);
    if (base) this.bits.fill(1);
    if (opaque) this.alpha.fill(1);
  }

  localIndex(worldX, worldY) {
    const x = Math.round(worldX) - this.originX;
    const y = Math.round(worldY) - this.originY;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return y * this.width + x;
  }

  plot(worldX, worldY, value, covered = true) {
    const index = this.localIndex(worldX, worldY);
    if (index < 0) return false;
    this.bits[index] = value ? 1 : 0;
    this.alpha[index] = covered ? 1 : 0;
    return true;
  }

  composite(layer, clip = null) {
    for (let y = 0; y < layer.height; y += 1) {
      for (let x = 0; x < layer.width; x += 1) {
        const source = y * layer.width + x;
        if (!layer.alpha[source]) continue;
        const worldX = layer.originX + x;
        const worldY = layer.originY + y;
        if (clip && (worldX < clip.x || worldY < clip.y || worldX >= clip.x + clip.w || worldY >= clip.y + clip.h)) continue;
        this.plot(worldX, worldY, layer.bits[source], true);
      }
    }
  }

  toUint8Array() { return this.bits.slice(); }
}

function integerLayerBounds(bounds) {
  const sourceX = Number(bounds?.x) || 0, sourceY = Number(bounds?.y) || 0;
  const sourceW = Math.max(0, Number(bounds?.w) || 0), sourceH = Math.max(0, Number(bounds?.h) || 0);
  const x = Math.floor(sourceX + 1e-9), y = Math.floor(sourceY + 1e-9);
  const right = Math.ceil(sourceX + sourceW - 1e-9), bottom = Math.ceil(sourceY + sourceH - 1e-9);
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}

export { Framebuffer, integerLayerBounds };
