import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('mixed box selection size updates raster and vector nodes together', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const T = window.PixelEditorDebug.services.tristateRaster;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const rectangle = M.createNode('rectangle', { parentId: active.id, x: 5, y: 5, w: 4, h: 3, stroke: { width: 1, color: 1, style: 'solid' } });
    const raster = M.createNode('raster', { parentId: active.id, x: 20, y: 5, w: 2, h: 2, pixels: Uint8Array.from([2, 1, 0, 2]) });
    editor.exec(new C.AddNodesCommand([rectangle, raster], active.id));
    editor.state.selection.replace([rectangle.id, raster.id]);
    const ok = editor.setSelectionSize('w', 6);
    const currentRect = M.nodeById(editor.activePage(), rectangle.id);
    const currentRaster = M.nodeById(editor.activePage(), raster.id);
    return {
      ok,
      rectangle: { w: currentRect.w, h: currentRect.h },
      raster: { w: currentRaster.w, h: currentRaster.h, pixels: [...T.decodeTriStatePixels(currentRaster.raster.data, currentRaster.w, currentRaster.h)] },
    };
  });
  expect(result.ok).toBe(true);
  expect(result.rectangle.w).toBe(6);
  expect(result.raster.w).toBe(6);
  expect(result.raster.pixels.slice(0, 2)).toEqual([2, 1]);
  expect(result.raster.pixels.slice(6, 8)).toEqual([0, 2]);
});
