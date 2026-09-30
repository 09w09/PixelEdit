function fontSizeFor(node) {
  return Math.max(1, Math.round(Number(node?.fixedFontSize ?? node?.fontSize ?? 16) || 16));
}

function fontString(node) {
  const size = fontSizeFor(node);
  return `${node?.bold ? 'bold ' : ''}${size}px ${node?.fontFamily || 'sans-serif'}`;
}

function metricNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function measureGlyphRun(ctx, text, letterSpacing = 0) {
  const chars = [...String(text ?? '')];
  const spacing = Number(letterSpacing) || 0;
  let cursor = 0;
  let inkLeft = Infinity;
  let inkRight = -Infinity;
  let ascent = 0;
  let descent = 0;
  const glyphs = [];

  chars.forEach((char, index) => {
    const metrics = ctx.measureText(char);
    const leftMetric = metricNumber(metrics.actualBoundingBoxLeft, 0);
    const rightMetric = metricNumber(metrics.actualBoundingBoxRight, metricNumber(metrics.width, 0));
    const glyphLeft = cursor - leftMetric;
    const glyphRight = cursor + rightMetric;
    const glyphAscent = metricNumber(
      metrics.actualBoundingBoxAscent,
      metricNumber(metrics.fontBoundingBoxAscent, 0),
    );
    const glyphDescent = metricNumber(
      metrics.actualBoundingBoxDescent,
      metricNumber(metrics.fontBoundingBoxDescent, 0),
    );
    inkLeft = Math.min(inkLeft, glyphLeft);
    inkRight = Math.max(inkRight, glyphRight);
    ascent = Math.max(ascent, glyphAscent);
    descent = Math.max(descent, glyphDescent);
    glyphs.push({ char, origin: cursor, metrics });
    cursor += metricNumber(metrics.width, 0);
    if (index < chars.length - 1) cursor += spacing;
  });

  if (!chars.length) {
    inkLeft = 0;
    inkRight = 0;
  }

  return {
    text: chars.join(''),
    glyphs,
    advance: cursor,
    inkLeft,
    inkRight,
    ascent,
    descent,
  };
}

function fallbackFontMetrics(ctx, fontSize) {
  const metrics = ctx.measureText('Mg国');
  const ascent = metricNumber(
    metrics.actualBoundingBoxAscent,
    metricNumber(metrics.fontBoundingBoxAscent, Math.ceil(fontSize * 0.8)),
  );
  const descent = metricNumber(
    metrics.actualBoundingBoxDescent,
    metricNumber(metrics.fontBoundingBoxDescent, Math.max(1, Math.ceil(fontSize * 0.2))),
  );
  return {
    ascent: Math.max(1, ascent || Math.ceil(fontSize * 0.8)),
    descent: Math.max(0, descent || Math.ceil(fontSize * 0.2)),
  };
}

function fitsRun(run, width) {
  const inkWidth = Math.max(0, run.inkRight - run.inkLeft);
  return Math.max(run.advance, inkWidth) <= width + 1e-6;
}

function wrapParagraph(ctx, paragraph, width, letterSpacing) {
  if (!paragraph) return [''];
  const out = [];
  let current = '';
  for (const char of [...paragraph]) {
    const candidate = current + char;
    const run = measureGlyphRun(ctx, candidate, letterSpacing);
    if (current && !fitsRun(run, width)) {
      out.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  out.push(current);
  return out;
}

function horizontalOrigin(node, run) {
  const width = Math.max(1, Number(node.w) || 1);
  const inkWidth = Math.max(0, run.inkRight - run.inkLeft);
  if (node.alignH === 'right') return width - run.inkRight;
  if (node.alignH === 'center') return (width - inkWidth) / 2 - run.inkLeft;
  return -run.inkLeft;
}

function layoutText(node, ctx) {
  const width = Math.max(1, Math.round(Number(node?.w) || 1));
  const height = Math.max(1, Math.round(Number(node?.h) || 1));
  const fontSize = fontSizeFor(node);
  const letterSpacing = Number(node?.letterSpacing) || 0;
  const lineSpacing = Number(node?.lineSpacing) || 0;
  ctx.font = fontString(node);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const rawLines = String(node?.text ?? '').split('\n');
  const texts = [];
  for (const raw of rawLines) {
    if (node?.wrap === false) texts.push(raw);
    else texts.push(...wrapParagraph(ctx, raw, width, letterSpacing));
  }
  if (!texts.length) texts.push('');

  const defaults = fallbackFontMetrics(ctx, fontSize);
  const lines = texts.map(text => {
    const run = measureGlyphRun(ctx, text, letterSpacing);
    const ascent = Math.max(0, run.ascent || defaults.ascent);
    const descent = Math.max(0, run.descent || defaults.descent);
    const lineHeight = Math.max(fontSize, ascent + descent, 1);
    return {
      ...run,
      x: horizontalOrigin(node, run),
      ascent,
      descent,
      lineHeight,
      baseline: 0,
    };
  });

  const totalHeight = lines.reduce((sum, line) => sum + line.lineHeight, 0)
    + Math.max(0, lines.length - 1) * lineSpacing;
  let blockTop = 0;
  if (node?.alignV === 'middle') blockTop = (height - totalHeight) / 2;
  else if (node?.alignV === 'bottom') blockTop = height - totalHeight;

  let y = blockTop;
  for (const line of lines) {
    line.baseline = y + line.ascent;
    y += line.lineHeight + lineSpacing;
  }

  return {
    lines,
    totalHeight,
    blockTop,
    blockBottom: blockTop + totalHeight,
    width,
    height,
  };
}

function fallbackTextMask(node) {
  const w = Math.max(1, Math.round(Number(node?.w) || 1));
  const h = Math.max(1, Math.round(Number(node?.h) || 1));
  return { w, h, mask: new Uint8Array(w * h) };
}

function renderTextMask(node) {
  if (typeof document === 'undefined') return fallbackTextMask(node);
  const w = Math.max(1, Math.round(Number(node?.w) || 1));
  const h = Math.max(1, Math.round(Number(node?.h) || 1));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.font = fontString(node);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const layout = layoutText(node, ctx);

  for (const line of layout.lines) {
    for (const glyph of line.glyphs) {
      ctx.fillText(glyph.char, line.x + glyph.origin, line.baseline);
    }
  }

  const rgba = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = rgba[index * 4 + 3] > 64 ? 1 : 0;
  }
  return { w, h, mask };
}

function installTextLayoutRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const renderer = PE?.renderer;
  if (!renderer?.TextRenderer) throw new Error('PixelEditor is not initialized');
  if (PE.textLayoutInstalled) return;
  PE.textLayoutInstalled = true;
  renderer.TextRenderer.mask = node => renderTextMask(node);
  PE.textLayout = { fontString, measureGlyphRun, layoutText, renderTextMask };
}

export {
  fontString,
  measureGlyphRun,
  layoutText,
  renderTextMask,
  installTextLayoutRuntime,
};
