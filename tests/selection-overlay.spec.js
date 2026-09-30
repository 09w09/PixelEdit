import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('box helper geometry uses outer pixel edges without w-1 offsets', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const S = window.PixelEditor.selectionOverlay;
    return {
      one: S?.boxHandlePoints?.({ x: 7, y: 9, w: 1, h: 1 }),
      ten: S?.boxHandlePoints?.({ x: 10, y: 20, w: 10, h: 10 }),
    };
  });
  expect(result.one).toEqual([
    { x: 7, y: 9, corner: 'nw' }, { x: 8, y: 9, corner: 'ne' },
    { x: 7, y: 10, corner: 'sw' }, { x: 8, y: 10, corner: 'se' },
  ]);
  expect(result.ten.at(-1)).toEqual({ x: 20, y: 30, corner: 'se' });
});

test('selection handle visual size stays ten CSS pixels at 100 800 and 1600 percent', async ({ page }) => {
  await openEditor(page);
  const sizes = await page.evaluate(() => [1, 8, 16].map(zoom => ({
    zoom,
    logical: window.PixelEditor.selectionOverlay?.handleVisualSize?.(zoom),
  })));
  for (const item of sizes) expect(item.logical * item.zoom).toBeCloseTo(10, 5);
});

test('line selection renders a line with only endpoint handles instead of a bounds rectangle', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const id = window.PixelEditorTest.createNode('line', { x1: 25, y1: 30, x2: 80, y2: 70, lineWidth: 2 });
    editor.state.selection.replace([id]);
    editor.renderOverlay();
    const svg = editor.overlay;
    return {
      rects: svg.querySelectorAll('rect.selection-box').length,
      lines: svg.querySelectorAll('line.selection-box').length,
      handles: svg.querySelectorAll('rect.selection-handle').length,
      centers: [...svg.querySelectorAll('rect.selection-handle')].map(el => ({
        x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
        y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
      })),
    };
  });
  expect(result.rects).toBe(0);
  expect(result.lines).toBe(1);
  expect(result.handles).toBe(2);
  expect(result.centers).toEqual([{ x: 25, y: 30 }, { x: 80, y: 70 }]);
});

test('box resize handle hit target remains about sixteen CSS pixels across zoom levels', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const S = window.PixelEditor.selectionOverlay;
    return [1, 8, 16].map(zoom => ({
      zoom,
      inside: Boolean(S?.hitBoxHandle?.({ x: 10, y: 10, w: 20, h: 20 }, { x: 10 + 7.5 / zoom, y: 10 }, zoom)),
      outside: Boolean(S?.hitBoxHandle?.({ x: 10, y: 10, w: 20, h: 20 }, { x: 10 + 9 / zoom, y: 10 }, zoom)),
    }));
  });
  for (const item of result) {
    expect(item.inside).toBe(true);
    expect(item.outside).toBe(false);
  }
});
