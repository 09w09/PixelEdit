import { expect, test } from '@playwright/test';

test('v17 bootstrap reports the first browser initialization error', async ({ page }) => {
  const errors = [];
  const consoleErrors = [];
  const requestFailures = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText || 'unknown'}`));

  await page.goto('/');
  await page.waitForTimeout(500);

  const state = await page.evaluate(async () => {
    const scripts = [...document.scripts].map(script => ({
      type: script.type,
      src: script.getAttribute('src'),
    }));
    async function inspect(url) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        return {
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get('content-type'),
          text: (await response.text()).slice(0, 4000),
        };
      } catch (error) {
        return { error: error?.stack || error?.message || String(error) };
      }
    }
    return {
      version: window.PixelEditorTest?.version ?? window.PixelEditor?.model?.PROJECT_VERSION ?? null,
      hasSetToolDefault: typeof window.PixelEditorTest?.editor?.setToolDefault === 'function',
      hasTriStateRaster: Boolean(window.PixelEditor?.tristateRaster),
      scripts,
      mainFetch: await inspect('/src/main.js'),
      toolStateFetch: await inspect('/src/tools/tool-state.js'),
    };
  });

  const diagnostics = JSON.stringify({ errors, consoleErrors, requestFailures, state }, null, 2);
  expect(state.toolStateFetch.status, diagnostics).toBe(200);
  expect(errors, diagnostics).toEqual([]);
  expect(consoleErrors, diagnostics).toEqual([]);
  expect(requestFailures, diagnostics).toEqual([]);
  expect(state.version, diagnostics).toBe(17);
  expect(state.hasSetToolDefault, diagnostics).toBe(true);
  expect(state.hasTriStateRaster, diagnostics).toBe(true);
});
