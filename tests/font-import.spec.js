import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('duplicate font files in one import batch are skipped and later imports remain deduplicated', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const firstFile = new File([bytes], 'demo.ttf', { type: 'font/ttf' });
    const duplicateFile = new File([bytes], 'demo-copy.ttf', { type: 'font/ttf' });
    const first = await editor.importFonts([firstFile, duplicateFile]);
    const again = await editor.importFonts([new File([bytes], 'demo-again.ttf', { type: 'font/ttf' })]);
    return {
      first,
      again,
      fontCount: editor.state.project.fonts.length,
      fontAssetCount: editor.state.assets.records().filter(item => item.type === 'font').length,
    };
  });
  expect(result.first).toEqual({ imported: 1, skipped: 1 });
  expect(result.again).toEqual({ imported: 0, skipped: 1 });
  expect(result.fontCount).toBe(1);
  expect(result.fontAssetCount).toBe(1);
});
