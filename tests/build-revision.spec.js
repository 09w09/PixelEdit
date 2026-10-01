import { expect, test } from '@playwright/test';

test('runtime exposes the exact build revision endpoint', async ({ page }) => {
  await page.goto('/');
  const response = await page.request.get(new URL('./build-info.json', page.url()).toString(), {
    headers: { 'Cache-Control': 'no-cache' },
  });
  expect(response.ok()).toBe(true);
  const info = await response.json();
  expect(info).toEqual({
    sha: expect.stringMatching(/^(?:local|[0-9a-f]{40})$/),
  });
});
