import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function boot(page) {
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    editor.activePage().fill = { mode: 'transparent', color: 0 };
    editor.renderAll();
    editor.setTransparencyPreview(false);
  });
}

test('透明预览层在全部缩放倍率下与主画布、交互层和舞台对齐', async ({ page }) => {
  await boot(page);
  const results = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const result = [];
    for (const zoom of [1, 2, 3, 4, 8, 16, 30, 1]) {
      editor.setZoom(zoom);
      editor.setTransparencyPreview(true);
      const stage = document.querySelector('#stage');
      const main = document.querySelector('#screenCanvas');
      const preview = document.querySelector('#transparencyOverlayCanvas');
      const handles = document.querySelector('#overlaySvg');
      const rects = [stage, main, preview, handles].map(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const same = rects.every(r => Math.abs(r.x - rects[0].x) < .1
        && Math.abs(r.y - rects[0].y) < .1
        && Math.abs(r.width - 400 * zoom) < .1
        && Math.abs(r.height - 300 * zoom) < .1);
      result.push({
        zoom, same, sizes: rects.map(r => [r.width, r.height]),
        intrinsic: [preview.width, preview.height],
        pointerEvents: getComputedStyle(preview).pointerEvents,
        enabled: editor.editorPreferences.transparencyPreview,
      });
    }
    return result;
  });
  for (const record of results) {
    expect(record.same, `缩放 ${record.zoom}x 时各层的 CSS 显示尺寸必须相同：${JSON.stringify(record.sizes)}`).toBe(true);
    expect(record.intrinsic).toEqual([400, 300]);
    expect(record.pointerEvents).toBe('none');
    expect(record.enabled).toBe(true);
  }
});

test('200% 缩放下画布右下角也能看到透明预览，关闭后截图完全恢复', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.setZoom(2);
    editor.state.selection.clear();
    editor.renderAll();
  });
  const stage = page.locator('#stage');
  const stageBox = await stage.boundingBox();
  expect(stageBox).not.toBeNull();
  expect(stageBox.width).toBe(800);
  expect(stageBox.height).toBe(600);
  const bottomRight = {
    x: Math.floor(stageBox.x + stageBox.width * .75),
    y: Math.floor(stageBox.y + stageBox.height * .75),
    width: 64, height: 64,
  };
  const screenshot = async () => sha256(await page.screenshot({ clip: bottomRight }));
  const baseline = await screenshot();
  const button = page.locator('#transparencyPreviewBtn');
  await button.click();
  expect(await button.getAttribute('aria-pressed')).toBe('true');
  const preview = await screenshot();
  expect(preview, '右下角不能保持空白，否则是原先左上角四分之一覆盖的缩放问题').not.toBe(baseline);

  // The overlay is a visual-only layer: exported black/white framebuffer stays unchanged.
  const framebufferBefore = await page.evaluate(() => window.PixelEditorTest.editor.lastFramebuffer.join(''));
  await button.click();
  expect(await button.getAttribute('aria-pressed')).toBe('false');
  expect(await screenshot()).toBe(baseline);
  const framebufferAfter = await page.evaluate(() => window.PixelEditorTest.editor.lastFramebuffer.join(''));
  expect(framebufferAfter).toBe(framebufferBefore);
});

test('透明预览开启后反复切换缩放，始终正确覆盖整个舞台', async ({ page }) => {
  await boot(page);
  await page.locator('#transparencyPreviewBtn').click();
  const state = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    return [1, 2, 4, 3, 1].map(zoom => {
      editor.setZoom(zoom);
      editor.renderAll();
      const a = editor.canvas.getBoundingClientRect();
      const b = editor.transparencyCanvas.getBoundingClientRect();
      const data = editor.transparencyCanvas.getContext('2d').getImageData(399, 299, 1, 1).data;
      return { zoom, equal: a.width === b.width && a.height === b.height
        && a.x === b.x && a.y === b.y, lastPixelAlpha: data[3] };
    });
  });
  for (const v of state) {
    expect(v.equal, `透明预览层在 ${v.zoom}x 放大时未对齐`).toBe(true);
    expect(v.lastPixelAlpha).toBe(82);
  }
});
