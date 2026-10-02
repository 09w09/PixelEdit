const FILL_MODES = Object.freeze(['transparent', 'solid', 'dither', 'pattern']);
const DITHER_TYPES = Object.freeze(['bayer', 'blueNoise', 'random']);
const DITHER_MATRICES = Object.freeze([2, 4, 8]);
const PATTERN_TYPES = Object.freeze([
  'horizontal', 'vertical', 'diagSlash', 'diagBackslash', 'crosshatch', 'dots', 'checkerboard',
]);
const ALIGN_MODES = Object.freeze(['global', 'object']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const integer = (value, fallback = 0, min = -Infinity, max = Infinity) => {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(Math.round(number), min, max) : fallback;
};

function defaultToolDither() {
  return { type: 'bayer', density: 50, matrix: 4, align: 'object', offsetX: 0, offsetY: 0 };
}

function defaultToolPattern() {
  return { type: 'horizontal', lineWidth: 1, gap: 2, align: 'object', offsetX: 0, offsetY: 0 };
}

function normalizeToolFill(input, fallback = { mode: 'solid', color: 1 }) {
  const source = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : { mode: 'solid', color: 1 };
  return {
    mode: FILL_MODES.includes(source.mode) ? source.mode : (FILL_MODES.includes(base.mode) ? base.mode : 'solid'),
    color: Number(source.color) === 0 ? 0 : Number(source.color) === 1 ? 1 : (Number(base.color) === 0 ? 0 : 1),
  };
}

function normalizeDither(input, fallback = defaultToolDither()) {
  const source = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : defaultToolDither();
  const requestedMatrix = integer(source.matrix, base.matrix);
  return {
    type: DITHER_TYPES.includes(source.type) ? source.type : (DITHER_TYPES.includes(base.type) ? base.type : 'bayer'),
    density: integer(source.density, integer(base.density, 50, 0, 100), 0, 100),
    matrix: DITHER_MATRICES.includes(requestedMatrix) ? requestedMatrix : (DITHER_MATRICES.includes(base.matrix) ? base.matrix : 4),
    align: ALIGN_MODES.includes(source.align) ? source.align : (ALIGN_MODES.includes(base.align) ? base.align : 'object'),
    offsetX: integer(source.offsetX, integer(base.offsetX, 0)),
    offsetY: integer(source.offsetY, integer(base.offsetY, 0)),
  };
}

function normalizePattern(input, fallback = defaultToolPattern()) {
  const source = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : defaultToolPattern();
  return {
    type: PATTERN_TYPES.includes(source.type) ? source.type : (PATTERN_TYPES.includes(base.type) ? base.type : 'horizontal'),
    lineWidth: integer(source.lineWidth, integer(base.lineWidth, 1, 1, 16), 1, 16),
    gap: integer(source.gap, integer(base.gap, 2, 0, 32), 0, 32),
    align: ALIGN_MODES.includes(source.align) ? source.align : (ALIGN_MODES.includes(base.align) ? base.align : 'object'),
    offsetX: integer(source.offsetX, integer(base.offsetX, 0)),
    offsetY: integer(source.offsetY, integer(base.offsetY, 0)),
  };
}

export {
  FILL_MODES,
  DITHER_TYPES,
  DITHER_MATRICES,
  PATTERN_TYPES,
  ALIGN_MODES,
  defaultToolDither,
  defaultToolPattern,
  normalizeToolFill,
  normalizeDither,
  normalizePattern,
};
