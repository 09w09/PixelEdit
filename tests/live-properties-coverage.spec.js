import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function assertAllWritableControlsBound(page, label) {
  const unbound = await page.locator('#properties input:not([readonly]), #properties select, #properties textarea').evaluateAll(controls => controls
    .filter(control => !control.disabled)
    .filter(control => !control.dataset.liveProperty)
    .map(control => ({ id: control.id, tag: control.tagName, type: control.type || '' })));
  expect(unbound, `${label}: every enabled writable property control must use the live-property runtime`).toEqual([]);
}

async function createNode(page, type, props = {}) {
  return page.evaluate(({ nodeType, extra }) => window.PixelEditorTest.createNode(nodeType, extra), {
    nodeType: type,
    extra: props,
  });
}

async function createImage(page) {
  return page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const p = editor.activePage();
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i += 1) {
      const value = i * 17;
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = value;
      rgba[i * 4 + 3] = 255;
    }
    const assetId = editor.state.assets.add('image', '', { name: 'coverage.png', mime: 'image/png' });
    editor.state.assets.setRuntime(assetId, { width: 4, height: 4, data: rgba });
    const node = M.createNode('image', {
      parentId: p.id,
      x: 20, y: 20, w: 80, h: 60,
      assetId,
      sourceWidth: 4,
      sourceHeight: 4,
      sourceName: 'coverage.png',
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
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const p = editor.activePage();
    const node = M.createNode('raster', { parentId: p.id, x: 20, y: 20, w: 12, h: 8 });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;
    editor.renderAll();
    return node.id;
  });
}

async function selectPageProperties(page) {
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.state.selection.clear();
    editor.pageSelectedId = editor.activePage().id;
    editor.properties.render();
  });
}

test('every enabled writable property control is owned by the unified live-property runtime', async ({ page }) => {
  await openEditor(page);

  await selectPageProperties(page);
  await assertAllWritableControlsBound(page, 'page solid');
  await page.locator('#propFill').selectOption('dither');
  await expect(page.locator('#propDitherDensity')).toBeVisible();
  await assertAllWritableControlsBound(page, 'page dither');
  await page.locator('#propFill').selectOption('pattern');
  await expect(page.locator('#propPatternLineWidth')).toBeVisible();
  await assertAllWritableControlsBound(page, 'page pattern');

  await createNode(page, 'line', {
    x1: 20, y1: 20, x2: 90, y2: 60,
    stroke: { width: 1, color: 1, style: 'solid' },
  });
  await assertAllWritableControlsBound(page, 'line');

  await createNode(page, 'rectangle', {
    x: 20, y: 20, w: 80, h: 60,
    stroke: { width: 1, color: 1, style: 'solid' },
    fill: { mode: 'solid', color: 1 },
  });
  await assertAllWritableControlsBound(page, 'rectangle solid');
  await page.locator('#propFill').selectOption('dither');
  await assertAllWritableControlsBound(page, 'rectangle dither');
  await page.locator('#propFill').selectOption('pattern');
  await assertAllWritableControlsBound(page, 'rectangle pattern');

  await createNode(page, 'circle', {
    x: 30, y: 30, w: 60, h: 60,
    stroke: { width: 2, color: 1, style: 'dot' },
    fill: { mode: 'solid', color: 0 },
  });
  await assertAllWritableControlsBound(page, 'circle');

  await createNode(page, 'polygon', {
    points: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 60, y: 70 }],
    stroke: { width: 1, color: 1, style: 'solid' },
    fill: { mode: 'transparent', color: 1 },
  });
  await assertAllWritableControlsBound(page, 'polygon');
  await page.locator('#propPointCount').focus();
  await page.locator('#propPointCount').fill('4');
  await expect(page.locator('#propPoint3X')).toBeVisible();
  await assertAllWritableControlsBound(page, 'polygon expanded');

  await createNode(page, 'text', {
    x: 20, y: 20, w: 180, h: 90,
    text: 'Coverage', fontFamily: 'sans-serif', fontSize: 24,
    fill: { mode: 'solid', color: 1 },
  });
  await assertAllWritableControlsBound(page, 'text solid');
  await page.locator('#propFill').selectOption('dither');
  await assertAllWritableControlsBound(page, 'text dither');
  await page.locator('#propFill').selectOption('pattern');
  await assertAllWritableControlsBound(page, 'text pattern');

  await createImage(page);
  await assertAllWritableControlsBound(page, 'image threshold');
  await page.locator('#propBwMode').selectOption('dither');
  await expect(page.locator('#propImageDitherAlgorithm')).toBeVisible();
  await assertAllWritableControlsBound(page, 'image bayer');
  await page.locator('#propImageDitherAlgorithm').selectOption('blueNoise');
  await assertAllWritableControlsBound(page, 'image blue noise');

  await createRaster(page);
  await assertAllWritableControlsBound(page, 'raster');
});
