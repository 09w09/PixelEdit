import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function createRectangle(page) {
  return page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const id = window.PixelEditorTest.createNode('rectangle', {
      x: 40, y: 40, w: 80, h: 60,
      stroke: { width: 1, color: 1, style: 'solid' },
      fill: { mode: 'solid', color: 1 },
    });
    editor.state.selection.replace([id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    return id;
  });
}

test('live property render keeps the Window receiver required by Firefox', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await openEditor(page);
  const id = await createRectangle(page);
  const before = await page.evaluate(() => window.PixelEditorTest.framebufferString());

  await page.evaluate(() => {
    const nativeRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = function requestAnimationFrameWithStrictReceiver(callback) {
      if (this !== window) throw new TypeError('Illegal invocation: Window receiver required');
      return nativeRaf.call(window, callback);
    };
  });

  const radius = page.locator('#propRTL');
  await radius.fill('9');
  await page.waitForFunction(nodeId => window.PixelEditorTest.getNode(nodeId)?.rTL === 9, id);
  await radius.press('Tab');
  await page.waitForTimeout(50);

  const result = await page.evaluate(nodeId => ({
    radius: window.PixelEditorTest.getNode(nodeId)?.rTL,
    framebuffer: window.PixelEditorTest.framebufferString(),
  }), id);

  expect(result.radius).toBe(9);
  expect(result.framebuffer).not.toBe(before);
  expect(pageErrors).toEqual([]);
});
