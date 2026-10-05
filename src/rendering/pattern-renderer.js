import { clamp, mod } from './bitmap-primitives.js';

const BLUE = [0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21];

function bayer(size) {
  if (size === 2) return [[0, 2], [3, 1]];
  let matrix = [[0, 2], [3, 1]];
  while (matrix.length < size) {
    const current = matrix.length;
    const next = Array.from({ length: current * 2 }, () => Array(current * 2));
    for (let y = 0; y < current; y += 1) for (let x = 0; x < current; x += 1) {
      const value = matrix[y][x] * 4;
      next[y][x] = value;
      next[y][x + current] = value + 2;
      next[y + current][x] = value + 3;
      next[y + current][x + current] = value + 1;
    }
    matrix = next;
  }
  return matrix;
}

function hash2(x, y) {
  let hash = ((x | 0) * 374761393 + (y | 0) * 668265263) | 0;
  hash = (hash ^ (hash >>> 13)) * 1274126177;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function rank(type, size, x, y) {
  x = mod(x, size);
  y = mod(y, size);
  if (type === 'bayer') return bayer(size)[y][x];
  if (type === 'random') return hash2(x, y) % (size * size);
  const sx = Math.floor(x * 8 / size), sy = Math.floor(y * 8 / size);
  return Math.floor(BLUE[sy * 8 + sx] * size * size / 64);
}

function graphicDitherPixel(settings = {}, absoluteX, absoluteY, localX, localY) {
  const size = [2, 4, 8].includes(Math.round(settings.matrix)) ? Math.round(settings.matrix) : 4;
  const density = clamp(Number(settings.density ?? 50), 0, 100);
  if (density <= 0) return 0;
  if (density >= 100) return 1;
  const x = (settings.align === 'global' ? absoluteX : localX) + Math.round(settings.offsetX || 0);
  const y = (settings.align === 'global' ? absoluteY : localY) + Math.round(settings.offsetY || 0);
  return rank(settings.type || 'bayer', size, x, y) < density / 100 * size * size ? 1 : 0;
}

function patternPixel(pattern = {}, absoluteX, absoluteY, localX, localY) {
  const lineWidth = clamp(Math.round(pattern.lineWidth || 1), 1, 16);
  const gap = clamp(Math.round(pattern.gap || 0), 0, 32);
  const period = Math.max(1, lineWidth + gap);
  const x = (pattern.align === 'global' ? absoluteX : localX) + Math.round(pattern.offsetX || 0);
  const y = (pattern.align === 'global' ? absoluteY : localY) + Math.round(pattern.offsetY || 0);
  const mx = mod(x, period), my = mod(y, period);
  switch (pattern.type || 'horizontal') {
    case 'horizontal': return my < lineWidth ? 1 : 0;
    case 'vertical': return mx < lineWidth ? 1 : 0;
    case 'diagSlash': return mod(x + y, period) < lineWidth ? 1 : 0;
    case 'diagBackslash': return mod(x - y, period) < lineWidth ? 1 : 0;
    case 'crosshatch': return mx < lineWidth || my < lineWidth ? 1 : 0;
    case 'dots': return mx < lineWidth && my < lineWidth ? 1 : 0;
    case 'checkerboard': return mx < lineWidth && my < lineWidth && mod(Math.floor(x / period) + Math.floor(y / period), 2) === 0 ? 1 : 0;
    default: return 0;
  }
}

export { bayer, graphicDitherPixel, patternPixel };
