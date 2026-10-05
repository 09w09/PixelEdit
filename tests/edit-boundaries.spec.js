import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('selected source image blocks pencil editing and explains rasterization requirement', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const assetId = editor.state.assets.add('image', '', { name: 'source.png', mime: 'image/png' });
    editor.state.assets.setRuntime(assetId, { width: 1, height: 1, data: Uint8ClampedArray.from([0, 0, 0, 255]) });
    const image = M.createNode('image', { parentId: active.id, x: 5, y: 5, w: 1, h: 1, assetId, sourceWidth: 1, sourceHeight: 1 });
    editor.exec(new C.AddNodesCommand([image], active.id));
    editor.state.selection.replace([image.id]);
    editor.tool = 'pencil';
    const ok = editor.beginPaint({ x: 5, y: 5 });
    return { ok, notice: document.querySelector('#noticeText')?.textContent || '' };
  });
  expect(result.ok).toBe(false);
  expect(result.notice).toContain('栅格化');
});

test('raster and page background remain paintable', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const raster = M.createNode('raster', { parentId: active.id, x: 10, y: 10, w: 3, h: 3 });
    editor.exec(new C.AddNodesCommand([raster], active.id));
    editor.state.selection.replace([raster.id]);
    editor.tool = 'pencil';
    const rasterOk = editor.beginPaint({ x: 11, y: 11 });
    editor.cancelCustomGesture();
    editor.state.selection.clear();
    const pageOk = editor.beginPaint({ x: 2, y: 2 });
    editor.cancelCustomGesture();
    return { rasterOk, pageOk };
  });
  expect(result).toEqual({ rasterOk: true, pageOk: true });
});

test('PNG file import creates a source image node rather than a raster node', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    const file = new File([bytes], 'pixel.png', { type: 'image/png' });
    const node = await editor.importImageFile(file);
    return {
      type: node?.type,
      sourceType: node?.sourceType,
      sourceName: node?.sourceName,
      hasImageOptions: Boolean(node?.image),
    };
  });
  expect(result).toEqual({ type: 'image', sourceType: 'bitmap', sourceName: 'pixel.png', hasImageOptions: true });
});
