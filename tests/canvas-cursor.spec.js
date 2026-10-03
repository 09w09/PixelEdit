import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function canvasCenter(page) {
  const box = await page.locator('#screenCanvas').boundingBox();
  if (!box) throw new Error('screenCanvas is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('drawing-style tools use a crosshair cursor over the editable canvas', async ({ page }) => {
  await openEditor(page);
  const tools = ['select', 'line', 'rectangle', 'circle', 'polygon', 'text', 'bucket', 'image'];
  const point = await canvasCenter(page);

  for (const tool of tools) {
    await page.evaluate(toolName => window.PixelEditorTest.editor.setTool(toolName), tool);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('#screenCanvas')).toHaveCSS('cursor', 'crosshair');
  }
});

test('pencil and eraser hide the native pointer and show an exact brush-size frame', async ({ page }) => {
  await openEditor(page);
  const point = await canvasCenter(page);

  for (const { tool, width } of [{ tool: 'pencil', width: 5 }, { tool: 'eraser', width: 8 }]) {
    await page.evaluate(({ tool, width }) => {
      const editor = window.PixelEditorTest.editor;
      editor.setTool(tool);
      editor.setToolDefault(tool, 'width', width);
    }, { tool, width });
    await page.mouse.move(point.x, point.y);

    await expect(page.locator('#screenCanvas')).toHaveCSS('cursor', 'none');
    const frame = page.locator('#overlaySvg [data-canvas-tool-cursor="brush"]');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('width', String(width));
    await expect(frame).toHaveAttribute('height', String(width));
  }
});

test('brush frame follows the same odd/even anchor convention as painted pixels', async ({ page }) => {
  await openEditor(page);
  const canvas = page.locator('#screenCanvas');

  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.setZoom(4);
    editor.setTool('pencil');
    editor.setToolDefault('pencil', 'width', 4);
  });

  const zoomed = await canvas.boundingBox();
  if (!zoomed) throw new Error('screenCanvas is not visible after zoom');
  const logical = { x: 120, y: 80 };
  await page.mouse.move(zoomed.x + (logical.x + 0.5) * 4, zoomed.y + (logical.y + 0.5) * 4);

  const attrs = await page.locator('#overlaySvg [data-canvas-tool-cursor="brush"]').evaluate(node => ({
    x: Number(node.getAttribute('x')),
    y: Number(node.getAttribute('y')),
    width: Number(node.getAttribute('width')),
    height: Number(node.getAttribute('height')),
  }));
  expect(attrs).toEqual({ x: 119, y: 79, width: 4, height: 4 });
});

test('brush frame updates immediately when brush width changes without pointer movement', async ({ page }) => {
  await openEditor(page);
  const point = await canvasCenter(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.setTool('pencil');
    editor.setToolDefault('pencil', 'width', 3);
  });
  await page.mouse.move(point.x, point.y);

  const frame = page.locator('#overlaySvg [data-canvas-tool-cursor="brush"]');
  await expect(frame).toHaveAttribute('width', '3');
  await page.evaluate(() => window.PixelEditorTest.editor.setToolDefault('pencil', 'width', 11));
  await expect(frame).toHaveAttribute('width', '11');
  await expect(frame).toHaveAttribute('height', '11');
});

test('brush frame disappears when leaving the canvas and pointer tool keeps native behavior', async ({ page }) => {
  await openEditor(page);
  const point = await canvasCenter(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.setTool('pencil');
    editor.setToolDefault('pencil', 'width', 3);
  });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#overlaySvg [data-canvas-tool-cursor="brush"]')).toBeVisible();

  await page.mouse.move(5, 5);
  await expect(page.locator('#overlaySvg [data-canvas-tool-cursor="brush"]')).toHaveCount(0);

  await page.evaluate(() => window.PixelEditorTest.editor.setTool('pointer'));
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#screenCanvas')).not.toHaveCSS('cursor', 'none');
  await expect(page.locator('#screenCanvas')).not.toHaveCSS('cursor', 'crosshair');
});

test('image tool stays active until a canvas press requests an image file', async ({ page }) => {
  await openEditor(page);
  const point = await canvasCenter(page);

  await page.evaluate(() => {
    window.__imageInputClickCount = 0;
    const input = document.querySelector('#fileImage');
    input.addEventListener('click', event => {
      window.__imageInputClickCount += 1;
      event.preventDefault();
    });
    window.PixelEditorTest.editor.setTool('image');
  });

  expect(await page.evaluate(() => window.PixelEditorTest.editor.tool)).toBe('image');
  await expect(page.locator('[data-tool="image"]')).toHaveClass(/active/);
  await expect(page.locator('#screenCanvas')).toHaveCSS('cursor', 'crosshair');

  await page.mouse.click(point.x, point.y);
  expect(await page.evaluate(() => window.__imageInputClickCount)).toBe(1);
  expect(await page.evaluate(() => window.PixelEditorTest.editor.tool)).toBe('image');
});
