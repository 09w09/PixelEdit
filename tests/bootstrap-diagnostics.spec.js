import { test, expect } from '@playwright/test';

test('页面启动诊断：打印控制台错误与模块加载异常', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push('pageerror: ' + String(error?.stack || error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  page.on('response', response => {
    if (response.status() >= 400) errors.push('http: ' + response.status() + ' ' + response.url());
  });
  await page.goto('/');
  await page.waitForTimeout(1200);
  const boot = await page.evaluate(() => ({
    initialized: Boolean(window.PixelEditorTest?.editor),
    scriptTags: [...document.querySelectorAll('script')].map(s => s.getAttribute('src')),
    document: document.documentElement.dataset.pixelEditor,
  }));
  if (!boot.initialized) {
    throw new Error('BOOT DIAG ' + JSON.stringify({ boot, errors }));
  }
  expect(errors).toEqual([]);
});
