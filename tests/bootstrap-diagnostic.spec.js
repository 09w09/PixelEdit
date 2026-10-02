import { expect, test } from '@playwright/test';

test('v17 bootstrap reports the first browser initialization error', async ({ page }) => {
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => ({
    version: window.PixelEditor?.model?.PROJECT_VERSION ?? null,
    hasSetToolDefault: typeof window.PixelEditorTest?.editor?.setToolDefault === 'function',
    hasTriStateRaster: Boolean(window.PixelEditor?.tristateRaster),
  }));

  expect(errors, `pageerror:\n${errors.join('\n\n')}\nconsole.error:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(state).toEqual({ version: 17, hasSetToolDefault: true, hasTriStateRaster: true });
});
