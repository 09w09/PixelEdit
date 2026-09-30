import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('polygon selection exposes one handle for every vertex at exact coordinates', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const points = [{ x: 15, y: 20 }, { x: 40, y: 12 }, { x: 55, y: 35 }, { x: 25, y: 45 }];
    const id = window.PixelEditorTest.createNode('polygon', { points, lineWidth: 1, fill: { mode: 'transparent' } });
    editor.state.selection.replace([id]);
    editor.renderOverlay();
    const handles = [...editor.overlay.querySelectorAll('rect.selection-handle')].map(el => ({
      x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
      y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
    }));
    return { handles, polygonCount: editor.overlay.querySelectorAll('polygon.selection-box').length };
  });
  expect(result.polygonCount).toBe(1);
  expect(result.handles).toEqual([{ x: 15, y: 20 }, { x: 40, y: 12 }, { x: 55, y: 35 }, { x: 25, y: 45 }]);
});

test('a one-pixel object at bottom-right uses canvas outer edge 400 by 300', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const id = window.PixelEditorTest.createNode('rectangle', { x: 399, y: 299, w: 1, h: 1, lineWidth: 1 });
    editor.state.selection.replace([id]);
    editor.renderOverlay();
    const box = editor.overlay.querySelector('rect.selection-box');
    const handles = [...editor.overlay.querySelectorAll('rect.selection-handle')].map(el => ({
      x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
      y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
    }));
    return {
      x: Number(box?.getAttribute('x')),
      y: Number(box?.getAttribute('y')),
      w: Number(box?.getAttribute('width')),
      h: Number(box?.getAttribute('height')),
      handles,
    };
  });
  expect(result).toEqual({
    x: 399, y: 299, w: 1, h: 1,
    handles: [{ x: 399, y: 299 }, { x: 400, y: 299 }, { x: 399, y: 300 }, { x: 400, y: 300 }],
  });
});
