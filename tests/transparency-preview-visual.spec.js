import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

const digest = buffer => createHash('sha256').update(buffer).digest('hex');

async function start(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(() => {
    window.PixelEditorTest.editor.newProject({ force: true });
    window.PixelEditorTest.editor.setTransparencyPreview(false);
  });
}

test('透明区域按钮：选中真实栅格时能改变实际截图，并且可以还原', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const model = window.PixelEditorDebug.services.model;
    const commands = window.PixelEditorDebug.services.commands;
    const active = editor.activePage();
    const pixels = new Uint8Array(32 * 24);
    // 透明像素 0，右侧一条不透明黑色区域 2。
    for (let y = 0; y < 24; y += 1) {
      for (let x = 24; x < 32; x += 1) pixels[y * 32 + x] = 2;
    }
    const node = model.createNode('raster', {
      parentId: active.id, x: 50, y: 40, w: 32, h: 24, pixels,
    });
    editor.exec(new commands.AddNodesCommand([node], active.id));
    editor.state.selection.replace([node.id]);
    editor.setZoom(3);
    editor.renderAll();
  });
  const button = page.locator('#transparencyPreviewBtn');
  const overlay = page.locator('#overlaySvg [data-transparency-preview="true"]');
  const stage = page.locator('#stage');
  expect(await button.getAttribute('aria-pressed')).toBe('false');
  expect(await overlay.count()).toBe(0);
  const hidden = await stage.screenshot();

  await button.click();
  expect(await button.getAttribute('aria-pressed')).toBe('true');
  expect(await overlay.count()).toBe(24 * 24);
  const shown = await stage.screenshot();
  expect(digest(shown)).not.toBe(digest(hidden));

  await button.click();
  expect(await button.getAttribute('aria-pressed')).toBe('false');
  expect(await overlay.count()).toBe(0);
  const hiddenAgain = await stage.screenshot();
  expect(digest(hiddenAgain)).toBe(digest(hidden));
  console.log('TRANSPARENCY_VISUAL_PASS', {
    hiddenSHA: digest(hidden), shownSHA: digest(shown),
    transparentRectCount: 24 * 24, restored: true,
  });
});

test('透明区域按钮：非栅格图层上点击只改变按钮状态，不改变画面', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const id = window.PixelEditorTest.createNode('rectangle', { x: 50, y: 40, w: 32, h: 24 });
    editor.state.selection.replace([id]);
    editor.setZoom(3);
    editor.renderAll();
  });
  const button = page.locator('#transparencyPreviewBtn');
  const stage = page.locator('#stage');
  const before = await stage.screenshot();
  await button.click();
  const after = await stage.screenshot();
  const marked = await page.locator('#overlaySvg [data-transparency-preview="true"]').count();
  expect(await button.getAttribute('aria-pressed')).toBe('true');
  expect(marked).toBe(0);
  expect(digest(after)).toBe(digest(before));
  console.log('TRANSPARENCY_NON_RASTER_EXPECTED_NO_EFFECT', { marked, unchanged: true });
});
