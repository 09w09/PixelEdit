const TRANSPARENT_STROKE = 'transparent';
const STROKE_COLOR_OPTIONS = Object.freeze([
  Object.freeze([1, '黑']),
  Object.freeze([0, '白']),
  Object.freeze([TRANSPARENT_STROKE, '透明']),
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function normalizeStrokeWidth(value, fallback = 1) {
  const number = Number(value);
  const resolved = Number.isFinite(number) ? number : fallback;
  return clamp(Math.round(resolved), 0, 100);
}

function normalizeStrokeColor(value) {
  if (value === TRANSPARENT_STROKE) return TRANSPARENT_STROKE;
  return Number(value) === 0 ? 0 : 1;
}

function isStrokeVisible(stroke = {}) {
  return normalizeStrokeWidth(stroke.width) > 0 && normalizeStrokeColor(stroke.color) !== TRANSPARENT_STROKE;
}

export {
  TRANSPARENT_STROKE,
  STROKE_COLOR_OPTIONS,
  normalizeStrokeWidth,
  normalizeStrokeColor,
  isStrokeVisible,
};
