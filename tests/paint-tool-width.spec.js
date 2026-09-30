import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('raster pencil snapshots width and color and paints a square pixel brush', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const T = window.PixelEditor.tristateRaster;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const raster = M.createNode('raster', { parentId: p.id, x: 10, y: 10, w: 7, h: 7 });
    editor.exec(new C.AddNodesCommand([raster], p.id));
    editor.state.selection.replace([raster.id]);
    editor.setToolDefault('pencil', 'width', 3);
    editor.setToolDefault('pencil', 'color', 0);
    editor.setTool('pencil');
    editor.beginPaint({ x: 13, y: 13 });
    const gesture = editor.customGesture;
    const snapshot = { width: gesture?.brushWidth, value: gesture?.value };
    editor.setToolDefault('pencil', 'width', 1);
    if (gesture) { editor.customGesture = null; editor.commitPaint(gesture); }
    const node = M.nodeById(editor.activePage(), raster.id);
    const pixels = T.decodeTriStatePixels(node.raster.data, node.w, node.h);
    const white = [];
    for (let y = 0; y < node.h; y += 1) for (let x = 0; x < node.w; x += 1) if (pixels[y * node.w + x] === T.RASTER_WHITE) white.push([x, y]);
    return { snapshot, white };
  });

  expect(result.snapshot).toEqual({ width: 3, value: 1 });
  expect(result.white).toEqual([
    [2, 2], [3, 2], [4, 2],
    [2, 3], [3, 3], [4, 3],
    [2, 4], [3, 4], [4, 4],
  ]);
});

test('raster eraser width writes transparent while page eraser width writes opaque white', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const T = window.PixelEditor.tristateRaster;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const raster = M.createNode('raster', { parentId: p.id, x: 20, y: 20, w: 5, h: 5, pixels: new Uint8Array(25).fill(T.RASTER_BLACK) });
    editor.exec(new C.AddNodesCommand([raster], p.id));
    editor.state.selection.replace([raster.id]);
    editor.setToolDefault('eraser', 'width', 3);
    editor.setTool('eraser');
    editor.beginPaint({ x: 22, y: 22 });
    let gesture = editor.customGesture;
    if (gesture) { editor.customGesture = null; editor.commitPaint(gesture); }
    const current = M.nodeById(editor.activePage(), raster.id);
    const rasterPixels = T.decodeTriStatePixels(current.raster.data, 5, 5);
    const transparentCount = [...rasterPixels].filter(value => value === T.RASTER_TRANSPARENT).length;

    p.overlay = {};
    for (let y = 0; y < 5; y += 1) for (let x = 0; x < 5; x += 1) p.overlay[`${x},${y}`] = 1;
    editor.state.selection.clear();
    editor.pageSelectedId = p.id;
    editor.setTool('eraser');
    editor.beginPaint({ x: 2, y: 2 });
    gesture = editor.customGesture;
    const pageWidth = gesture?.brushWidth;
    if (gesture) { editor.customGesture = null; editor.commitPaint(gesture); }
    const whiteCount = Object.entries(editor.activePage().overlay).filter(([key, value]) => {
      const [x, y] = key.split(',').map(Number);
      return x >= 1 && x <= 3 && y >= 1 && y <= 3 && value === 0;
    }).length;
    return { transparentCount, pageWidth, whiteCount };
  });

  expect(result.transparentCount).toBe(9);
  expect(result.pageWidth).toBe(3);
  expect(result.whiteCount).toBe(9);
});
