import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function createImage(page) {
  return page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const p = editor.activePage();
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,   255, 255, 255, 255,   64, 64, 64, 255,   192, 192, 192, 255,
      255, 255, 255, 255,   0, 0, 0, 255,   160, 160, 160, 255,   96, 96, 96, 255,
      32, 32, 32, 255,   224, 224, 224, 255,   128, 128, 128, 255,   80, 80, 80, 255,
      240, 240, 240, 255,   16, 16, 16, 255,   176, 176, 176, 255,   112, 112, 112, 255,
    ]);
    const assetId = editor.state.assets.add('image', '', { name: 'live.png', mime: 'image/png' });
    editor.state.assets.setRuntime(assetId, { width: 4, height: 4, data: rgba });
    const node = M.createNode('image', {
      parentId: p.id,
      x: 20, y: 20, w: 80, h: 60,
      assetId,
      sourceWidth: 4,
      sourceHeight: 4,
      sourceName: 'live.png',
      image: {
        fit: 'stretch', interpolation: 'nearest',
        cropX: 0, cropY: 0, cropW: 4, cropH: 4,
        bwMode: 'threshold', threshold: 128, invert: false,
        ditherAlgorithm: 'bayer', bayerMatrix: 4,
      },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;
    editor.renderAll();
    return node.id;
  });
}

async function createRaster(page) {
  return page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const p = editor.activePage();
    const node = M.createNode('raster', { parentId: p.id, x: 20, y: 30, w: 12, h: 8 });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;
    editor.renderAll();
    return node.id;
  });
}

async function createPolygon(page) {
  return page.evaluate(() => window.PixelEditorTest.createNode('polygon', {
    points: [{ x: 20, y: 20 }, { x: 90, y: 20 }, { x: 60, y: 80 }],
    stroke: { width: 1, color: 1, style: 'solid' },
    fill: { mode: 'transparent', color: 1 },
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

test('all image select and checkbox properties apply immediately', async ({ page }) => {
  await openEditor(page);
  const id = await createImage(page);

  await page.locator('#propImageFit').selectOption('contain');
  await page.locator('#propInterpolation').selectOption('bilinear');
  await page.locator('#propImageInvert').check();
  const image = (await state(page, id)).node.image;
  expect(image.fit).toBe('contain');
  expect(image.interpolation).toBe('bilinear');
  expect(image.invert).toBe(true);
});

test('all image crop and threshold numeric properties update before blur and wheel live', async ({ page }) => {
  await openEditor(page);
  const id = await createImage(page);
  const cases = [
    ['propCropX', 'cropX', 1],
    ['propCropY', 'cropY', 1],
    ['propCropW', 'cropW', 3],
    ['propCropH', 'cropH', 3],
    ['propThreshold', 'threshold', 150],
  ];
  for (const [controlId, key, value] of cases) {
    const control = page.locator(`#${controlId}`);
    await control.focus();
    await control.fill(String(value));
    let current = await state(page, id);
    expect(current.node.image[key]).toBe(value);
    expect(current.activeId).toBe(controlId);
    await control.hover();
    await page.mouse.wheel(0, -100);
    current = await state(page, id);
    expect(current.node.image[key]).toBe(value + 1);
    await control.press('Tab');
  }
});

test('image BW mode and dither algorithm structural changes expose controls that are immediately live', async ({ page }) => {
  await openEditor(page);
  const id = await createImage(page);

  await page.locator('#propBwMode').selectOption('dither');
  await expect(page.locator('#propImageDitherAlgorithm')).toBeVisible();
  await page.locator('#propImageDitherAlgorithm').selectOption('bayer');
  await expect(page.locator('#propImageBayerMatrix')).toBeVisible();
  await page.locator('#propImageBayerMatrix').selectOption('8');
  let image = (await state(page, id)).node.image;
  expect(image.bwMode).toBe('dither');
  expect(image.ditherAlgorithm).toBe('bayer');
  expect(image.bayerMatrix).toBe(8);

  await page.locator('#propImageDitherAlgorithm').selectOption('blueNoise');
  await expect(page.locator('#propImageBayerMatrix')).toHaveCount(0);
  image = (await state(page, id)).node.image;
  expect(image.ditherAlgorithm).toBe('blueNoise');

  await page.locator('#propBwMode').selectOption('threshold');
  const threshold = page.locator('#propThreshold');
  await expect(threshold).toBeVisible();
  await threshold.focus();
  await threshold.fill('111');
  const current = await state(page, id);
  expect(current.node.image.threshold).toBe(111);
  expect(current.activeId).toBe('propThreshold');
});

test('image visual properties change framebuffer before blur', async ({ page }) => {
  await openEditor(page);
  const id = await createImage(page);
  const before = await state(page, id);
  const threshold = page.locator('#propThreshold');
  await threshold.focus();
  await threshold.fill('20');
  const current = await state(page, id);
  expect(current.framebuffer).not.toBe(before.framebuffer);
  expect(current.activeId).toBe('propThreshold');
});

test('raster X Y W H and aspect properties use the same live transform transaction', async ({ page }) => {
  await openEditor(page);
  const id = await createRaster(page);
  for (const [controlId, key, value] of [
    ['propX', 'x', 35],
    ['propY', 'y', 45],
    ['propW', 'w', 16],
    ['propH', 'h', 10],
  ]) {
    const control = page.locator(`#${controlId}`);
    await control.focus();
    await control.fill(String(value));
    const current = await state(page, id);
    expect(current.node[key]).toBe(value);
    expect(current.activeId).toBe(controlId);
    await control.press('Tab');
  }
  await page.locator('#propAspect').check();
  expect((await state(page, id)).node.aspectLocked).toBe(true);
});

test('polygon point count changes live without replacing the active count control', async ({ page }) => {
  await openEditor(page);
  const id = await createPolygon(page);
  const count = page.locator('#propPointCount');
  await count.evaluate(el => { window.__pointCountIdentity = el; });
  await count.focus();
  await count.fill('4');

  let current = await state(page, id);
  expect(current.node.points).toHaveLength(4);
  expect(current.activeId).toBe('propPointCount');
  await expect(count).toBeFocused();
  expect(await page.evaluate(() => document.getElementById('propPointCount') === window.__pointCountIdentity)).toBe(true);
  await expect(page.locator('#propPoint3X')).toBeVisible();
  await expect(page.locator('#propPoint3Y')).toBeVisible();

  const x = page.locator('#propPoint3X');
  await x.focus();
  await x.fill('123');
  current = await state(page, id);
  expect(current.node.points[3].x).toBe(123);
  expect(current.activeId).toBe('propPoint3X');
});

test('existing polygon point X Y fields update live and use separate history channels', async ({ page }) => {
  await openEditor(page);
  const id = await createPolygon(page);
  const baseline = (await state(page, id)).cursor;

  const x = page.locator('#propPoint0X');
  await x.focus();
  await x.fill('30');
  await x.fill('34');
  await x.press('Tab');
  let current = await state(page, id);
  expect(current.node.points[0].x).toBe(34);
  expect(current.cursor - baseline).toBe(1);

  const y = page.locator('#propPoint0Y');
  await y.focus();
  await y.fill('40');
  await y.press('Tab');
  current = await state(page, id);
  expect(current.node.points[0].y).toBe(40);
  expect(current.cursor - baseline).toBe(2);
});
