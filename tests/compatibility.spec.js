import { expect, test } from '@playwright/test';

test('project creation, browser download, undo and PNG export work without file pickers', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    window.PixelEditorTest.createNode('rectangle', { x: 10, y: 10, w: 32, h: 20 });
  });
  expect(await page.evaluate(() => window.PixelEditorTest.editor.state.dirty)).toBe(true);
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(async () => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
    await window.PixelEditorTest.editor.saveProject();
  });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pix$/);
  // Downloads cannot prove that bytes reached the user's disk.
  expect(await page.evaluate(() => window.PixelEditorTest.editor.state.dirty)).toBe(true);
  await page.evaluate(() => { window.PixelEditorTest.editor.bus.undo(); });
  expect(await page.evaluate(() => window.PixelEditorTest.editor.activePage().nodes.length)).toBe(0);
  const pngPromise = page.waitForEvent('download');
  await page.evaluate(() => window.PixelEditorTest.editor.exportPng());
  expect((await pngPromise).suggestedFilename()).toBe('screen-400x300.png');
});
