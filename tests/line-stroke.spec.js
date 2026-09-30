import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function rasterLine(page, x1, y1, x2, y2, lineWidth) {
  return page.evaluate(
    ({ x1, y1, x2, y2, lineWidth }) => {
      const R = window.PixelEditor.renderer;
      const fb = new Uint8Array(400 * 300);
      R.plotThickLine(fb, x1, y1, x2, y2, lineWidth, 1);
      const pixels = [];
      for (let y = 0; y < 300; y += 1) {
        for (let x = 0; x < 400; x += 1) {
          if (fb[y * 400 + x]) pixels.push([x, y]);
        }
      }
      return pixels;
    },
    { x1, y1, x2, y2, lineWidth },
  );
}

test('2px horizontal line is exactly two pixels thick with flat ends', async ({ page }) => {
  await openEditor(page);
  const pixels = await rasterLine(page, 10, 10, 20, 10, 2);
  const xs = pixels.map(([x]) => x);
  const rows = [...new Set(pixels.map(([, y]) => y))].sort((a, b) => a - b);

  expect(rows).toEqual([10, 11]);
  expect(Math.min(...xs)).toBe(10);
  expect(Math.max(...xs)).toBe(20);
  expect(pixels).toHaveLength(22);
});

test('2px vertical line is exactly two pixels thick with flat ends', async ({ page }) => {
  await openEditor(page);
  const pixels = await rasterLine(page, 10, 10, 10, 20, 2);
  const ys = pixels.map(([, y]) => y);
  const columns = [...new Set(pixels.map(([x]) => x))].sort((a, b) => a - b);

  expect(columns).toEqual([10, 11]);
  expect(Math.min(...ys)).toBe(10);
  expect(Math.max(...ys)).toBe(20);
  expect(pixels).toHaveLength(22);
});

test('2px diagonal line has no three-pixel bulges and no round-cap extension', async ({ page }) => {
  await openEditor(page);
  const pixels = await rasterLine(page, 10, 10, 20, 20, 2);
  const byX = new Map();
  for (const [x, y] of pixels) {
    if (!byX.has(x)) byX.set(x, []);
    byX.get(x).push(y);
  }

  expect(Math.min(...pixels.map(([x]) => x))).toBe(10);
  expect(Math.max(...pixels.map(([x]) => x))).toBe(20);
  for (let x = 10; x <= 20; x += 1) {
    expect((byX.get(x) || []).length).toBe(2);
  }
});

test('line rasterization is independent of endpoint order', async ({ page }) => {
  await openEditor(page);
  const forward = await rasterLine(page, 12, 8, 29, 17, 4);
  const reverse = await rasterLine(page, 29, 17, 12, 8, 4);

  const normalize = pixels => pixels.map(([x, y]) => `${x},${y}`).sort();
  expect(normalize(reverse)).toEqual(normalize(forward));
});
