import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('screenPointToRasterPixel inverts rotation and flips through one mapping helper', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const S = window.PixelEditorDebug.services.selectionTransform;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const rotated = M.createNode('raster', { parentId: p.id, x: 100, y: 100, w: 5, h: 5, transform: { rotation: 90, flipX: false, flipY: false } });
    const flipped = M.createNode('raster', { parentId: p.id, x: 100, y: 100, w: 5, h: 5, transform: { rotation: 0, flipX: true, flipY: false } });
    return {
      rotated: S?.screenPointToRasterPixel?.(rotated, { x: 101, y: 101 }),
      flipped: S?.screenPointToRasterPixel?.(flipped, { x: 104, y: 100 }),
    };
  });
  expect(result.rotated).toEqual({ x: 1, y: 3 });
  expect(result.flipped).toEqual({ x: 0, y: 0 });
});

test('pencil edits rotated raster local pixels instead of its screen-space AABB', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const T = window.PixelEditorDebug.services.tristateRaster;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const raster = M.createNode('raster', {
      parentId: p.id, x: 100, y: 100, w: 5, h: 5,
      transform: { rotation: 90, flipX: false, flipY: false },
    });
    editor.exec(new C.AddNodesCommand([raster], p.id));
    editor.state.selection.replace([raster.id]);
    editor.setToolDefault('pencil', 'width', 1);
    editor.setToolDefault('pencil', 'color', 1);
    editor.setTool('pencil');
    editor.beginPaint({ x: 101, y: 101 });
    const gesture = editor.customGesture;
    if (gesture) { editor.customGesture = null; editor.commitPaint(gesture); }
    const node = M.nodeById(editor.activePage(), raster.id);
    const pixels = [...T.decodeTriStatePixels(node.raster.data, 5, 5)];
    const black = pixels.map((value, index) => value === T.RASTER_BLACK ? index : -1).filter(index => index >= 0);
    return { black, transform: structuredClone(node.transform) };
  });
  expect(result.black).toEqual([3 * 5 + 1]);
  expect(result.transform).toEqual({ rotation: 90, flipX: false, flipY: false });
});

test('three-pixel brush expands in raster-local axes after arbitrary transform', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const T = window.PixelEditorDebug.services.tristateRaster;
    const S = window.PixelEditorDebug.services.selectionTransform;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const raster = M.createNode('raster', {
      parentId: p.id, x: 100, y: 100, w: 7, h: 7,
      transform: { rotation: 37, flipX: true, flipY: false },
    });
    editor.exec(new C.AddNodesCommand([raster], p.id));
    editor.state.selection.replace([raster.id]);
    const screen = S?.rasterPixelToScreenPoint?.(raster, { x: 3, y: 3 });
    editor.setToolDefault('pencil', 'width', 3);
    editor.setToolDefault('pencil', 'color', 1);
    editor.setTool('pencil');
    editor.beginPaint({ x: Math.floor(screen.x), y: Math.floor(screen.y) });
    const gesture = editor.customGesture;
    if (gesture) { editor.customGesture = null; editor.commitPaint(gesture); }
    const node = M.nodeById(editor.activePage(), raster.id);
    const pixels = [...T.decodeTriStatePixels(node.raster.data, 7, 7)];
    const black = [];
    for (let y = 0; y < 7; y += 1) for (let x = 0; x < 7; x += 1) if (pixels[y * 7 + x] === T.RASTER_BLACK) black.push([x, y]);
    return { black };
  });
  expect(result.black).toEqual([
    [2, 2], [3, 2], [4, 2],
    [2, 3], [3, 3], [4, 3],
    [2, 4], [3, 4], [4, 4],
  ]);
});
