import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function createRectangle(page) {
  return page.evaluate(() => window.PixelEditorTest.createNode('rectangle', {
    x: 40,
    y: 40,
    w: 80,
    h: 60,
    fill: { mode: 'solid', color: 1 },
    stroke: { width: 1, color: 1, style: 'solid' },
  }));
}

async function state(page, id) {
  return page.evaluate(nodeId => ({
    node: window.PixelEditorTest.getNode(nodeId),
    framebuffer: window.PixelEditorTest.framebufferString(),
    activeId: document.activeElement?.id || null,
    cursor: window.PixelEditorTest.editor.bus.cursor,
  }), id);
}

test('rotation typing and wheel preview immediately while flips apply through unified controls', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);
  const before = await state(page, id);
  const baseline = before.cursor;
  const rotation = page.locator('#propRotation');

  await rotation.focus();
  await rotation.fill('30');
  let current = await state(page, id);
  expect(current.node.transform.rotation).toBe(30);
  expect(current.framebuffer).not.toBe(before.framebuffer);
  expect(current.activeId).toBe('propRotation');

  await rotation.hover();
  await page.mouse.wheel(0, -100);
  current = await state(page, id);
  expect(current.node.transform.rotation).toBe(31);
  expect(current.cursor - baseline).toBe(1);
  await expect(rotation).toHaveValue('31');
  await rotation.press('Tab');

  await page.locator('#propFlipX').check();
  await page.locator('#propFlipY').check();
  current = await state(page, id);
  expect(current.node.transform.flipX).toBe(true);
  expect(current.node.transform.flipY).toBe(true);
});

test('shape style runtime no longer exposes the old rectangle-only live property binder', async ({ page }) => {
  await openEditor(page);
  const shapeStyle = await page.evaluate(() => ({
    hasLegacyBinder: typeof window.PixelEditorDebug.services.shapeStyleProperties?.bindLiveIntegerInput === 'function',
    hasLegacyNormalizer: typeof window.PixelEditorDebug.services.shapeStyleProperties?.normalizeLiveInteger === 'function',
  }));
  expect(shapeStyle).toEqual({ hasLegacyBinder: false, hasLegacyNormalizer: false });
});
