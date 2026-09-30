import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('top aligned text baseline is derived from actual ink ascent', async ({ page }) => {
  await openEditor(page);
  const metrics = await page.evaluate(() => {
    const T = window.PixelEditor.textLayout;
    const node = window.PixelEditor.model.createNode('text', {
      x: 0, y: 0, w: 120, h: 50, text: '文字Ag', fontFamily: 'sans-serif', fontSize: 28, alignV: 'top', wrap: false,
    });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = T?.fontString?.(node) || '';
    const layout = T?.layoutText?.(node, ctx);
    const line = layout?.lines?.[0];
    return line ? {
      baseline: line.baseline,
      ascent: line.ascent,
      descent: line.descent,
      inkTop: line.baseline - line.ascent,
      finite: Object.values(line).filter(v => typeof v === 'number').every(Number.isFinite),
    } : null;
  });
  expect(metrics).not.toBeNull();
  expect(metrics.finite).toBe(true);
  expect(metrics.ascent).toBeGreaterThan(0);
  expect(metrics.inkTop).toBeCloseTo(0, 5);
});

test('measured layout keeps italic-like overhang inside a left aligned text box', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const T = window.PixelEditor.textLayout;
    const node = window.PixelEditor.model.createNode('text', {
      w: 80, h: 40, text: 'fj', fontFamily: 'serif', fontSize: 30, alignH: 'left', alignV: 'top', wrap: false,
    });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = T?.fontString?.(node) || '';
    const layout = T?.layoutText?.(node, ctx);
    const line = layout?.lines?.[0];
    return line && {
      leftInk: line.x + line.inkLeft,
      rightInk: line.x + line.inkRight,
      width: node.w,
    };
  });
  expect(result).toBeTruthy();
  expect(result.leftInk).toBeGreaterThanOrEqual(-0.01);
  expect(result.rightInk).toBeLessThanOrEqual(result.width + 0.01);
});

test('top middle and bottom alignment produce ordered measured text blocks', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const T = window.PixelEditor.textLayout;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    return ['top', 'middle', 'bottom'].map(alignV => {
      const node = window.PixelEditor.model.createNode('text', {
        w: 120, h: 90, text: '第一行\n第二行', fontFamily: 'sans-serif', fontSize: 18,
        lineSpacing: 5, alignV, wrap: false,
      });
      ctx.font = T?.fontString?.(node) || '';
      const layout = T?.layoutText?.(node, ctx);
      return { alignV, top: layout?.blockTop, bottom: layout?.blockBottom, totalHeight: layout?.totalHeight };
    });
  });
  expect(result.every(item => Number.isFinite(item.top) && Number.isFinite(item.bottom))).toBe(true);
  expect(result[0].top).toBeLessThan(result[1].top);
  expect(result[1].top).toBeLessThan(result[2].top);
  expect(result[2].bottom).toBeLessThanOrEqual(90.01);
});

test('empty whitespace wrapped and descender text all produce valid binary masks', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const T = window.PixelEditor.textLayout;
    return ['', '   ', 'gypq', '一二三四五六七八九十'].map(text => {
      const node = window.PixelEditor.model.createNode('text', {
        w: 45, h: 80, text, fontFamily: 'sans-serif', fontSize: 18, wrap: true, letterSpacing: 1, lineSpacing: 2,
      });
      const out = T?.renderTextMask?.(node);
      return out && {
        size: out.mask.length,
        binary: out.mask.every(v => v === 0 || v === 1),
        black: out.mask.reduce((a, b) => a + b, 0),
      };
    });
  });
  expect(result.every(Boolean)).toBe(true);
  for (const item of result) {
    expect(item.size).toBe(45 * 80);
    expect(item.binary).toBe(true);
  }
  expect(result[2].black).toBeGreaterThan(0);
  expect(result[3].black).toBeGreaterThan(0);
});
