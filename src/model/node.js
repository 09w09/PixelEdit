import { normalizeFill, normalizeStroke } from './schema.js';
import { createTriStateRaster, decodeTriStatePixels, RASTER_ENCODING } from '../raster/tristate-raster.js';
import { normalizeTransform } from '../transforms/transform-model.js';

const M = globalThis.PixelEditor.model;
const LABELS = Object.freeze({ rectangle: '矩形', circle: '圆', polygon: '多边形', line: '直线', text: '文字', image: '图片', raster: '栅格' });
const integer = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
const defaultDither = () => ({ type: 'bayer', density: 50, matrix: 4, align: 'object', offsetX: 0, offsetY: 0 });
const defaultPattern = () => ({ type: 'horizontal', lineWidth: 1, gap: 2, align: 'object', offsetX: 0, offsetY: 0 });
const transformOf = props => normalizeTransform(props.transform || {});

function base(type, props) {
  if (type === 'background') throw new Error('V17 中页面本身就是背景');
  return {
    id: props.id || M.nextId(type), type, name: props.name || LABELS[type] || type,
    parentId: props.parentId ?? null, visible: props.visible !== false, locked: Boolean(props.locked),
  };
}

function createNode(type, props = {}) {
  const commonBase = base(type, props);
  if (type === 'line') return { ...commonBase, x1: integer(props.x1), y1: integer(props.y1), x2: integer(props.x2, 20), y2: integer(props.y2, 20), stroke: normalizeStroke(props.stroke), overlay: structuredClone(props.overlay || {}), transform: transformOf(props) };
  if (type === 'polygon') return { ...commonBase, points: (props.points || [{ x: 0, y: 20 }, { x: 20, y: 0 }, { x: 40, y: 20 }]).map(point => ({ x: integer(point.x), y: integer(point.y) })).slice(0, 24), stroke: normalizeStroke(props.stroke), fill: normalizeFill(props.fill), dither: structuredClone(props.dither || defaultDither()), pattern: structuredClone(props.pattern || defaultPattern()), overlay: structuredClone(props.overlay || {}), transform: transformOf(props) };

  const common = { ...commonBase, x: integer(props.x), y: integer(props.y), w: Math.max(1, integer(props.w, 40)), h: Math.max(1, integer(props.h, 30)), aspectLocked: Boolean(props.aspectLocked), overlay: structuredClone(props.overlay || {}), transform: transformOf(props) };
  if (type === 'rectangle') return { ...common, rTL: Math.max(0, integer(props.rTL)), rTR: Math.max(0, integer(props.rTR)), rBL: Math.max(0, integer(props.rBL)), rBR: Math.max(0, integer(props.rBR)), stroke: normalizeStroke(props.stroke), fill: normalizeFill(props.fill), dither: structuredClone(props.dither || defaultDither()), pattern: structuredClone(props.pattern || defaultPattern()) };
  if (type === 'circle') return { ...common, stroke: normalizeStroke(props.stroke), fill: normalizeFill(props.fill), dither: structuredClone(props.dither || defaultDither()), pattern: structuredClone(props.pattern || defaultPattern()) };
  if (type === 'text') return { ...common, text: props.text ?? '文字', fontFamily: props.fontFamily || 'sans-serif', fontSize: Math.max(1, integer(props.fontSize, 16)), fixedFontSize: props.fixedFontSize ?? null, letterSpacing: integer(props.letterSpacing), lineSpacing: integer(props.lineSpacing), alignH: props.alignH || 'left', alignV: props.alignV || 'top', wrap: props.wrap !== false, bold: Boolean(props.bold), invert: Boolean(props.invert), fill: normalizeFill(props.fill || { mode: 'solid', color: 1 }), dither: structuredClone(props.dither || defaultDither()), pattern: structuredClone(props.pattern || defaultPattern()) };
  if (type === 'image') {
    const sourceWidth = Math.max(1, integer(props.sourceWidth, common.w));
    const sourceHeight = Math.max(1, integer(props.sourceHeight, common.h));
    return { ...common, assetId: props.assetId || null, sourceWidth, sourceHeight, sourceType: props.sourceType || 'bitmap', sourceName: props.sourceName || '', svgViewBox: props.svgViewBox || null, image: { fit: 'stretch', interpolation: 'nearest', cropX: 0, cropY: 0, cropW: sourceWidth, cropH: sourceHeight, bwMode: 'threshold', threshold: 128, invert: false, ditherAlgorithm: 'bayer', bayerMatrix: 4, ...(props.image || {}) } };
  }
  if (type === 'raster') {
    let raster = props.raster ? structuredClone(props.raster) : createTriStateRaster(common.w, common.h, props.pixels || null);
    if (raster.encoding !== RASTER_ENCODING) throw new Error('V17 栅格数据格式无效');
    decodeTriStatePixels(raster.data, common.w, common.h);
    return { ...common, raster };
  }
  throw new Error(`unknown node type: ${type}`);
}

Object.assign(M, { createNode, defaultDither, defaultPattern, asInt: integer });
export { createNode, defaultDither, defaultPattern };
