import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function createNode(page, type, props = {}) {
  return page.evaluate(({ type, props }) => window.PixelEditorTest.createNode(type, props), { type, props });
}

async function node(page, id) {
  return page.evaluate(nodeId => window.PixelEditorTest.getNode(nodeId), id);
}

async function framebuffer(page) {
  return page.evaluate(() => window.PixelEditorTest.framebufferString());
}

async function showPageProperties(page) {
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.state.selection.clear();
    editor.pageSelectedId = editor.activePage().id;
    editor.properties.render();
  });
}

async function setSelect(page, id, value) {
  const control = page.locator(`#${id}`);
  await control.selectOption(String(value));
  return control;
}

test('generic element name, visibility, lock and aspect controls apply immediately', async ({ page }) => {
  await openEditor(page);
  const id = await createNode(page, 'rectangle', { x: 30, y: 30, w: 80, h: 50, fill: { mode: 'solid', color: 1 } });

  const name = page.locator('#propName');
  await name.focus();
  await name.fill('实时矩形');
  expect((await node(page, id)).name).toBe('实时矩形');
  await expect(name).toBeFocused();

  const beforeVisible = await framebuffer(page);
  await page.locator('#propVisible').uncheck();
  expect((await node(page, id)).visible).toBe(false);
  expect(await framebuffer(page)).not.toBe(beforeVisible);

  await page.locator('#propVisible').check();
  await page.locator('#propAspect').check();
  expect((await node(page, id)).aspectLocked).toBe(true);

  await page.locator('#propLocked').check();
  expect((await node(page, id)).locked).toBe(true);
  await expect(page.locator('#propX')).toBeDisabled();
});

test('line endpoints and every stroke property preview immediately', async ({ page }) => {
  await openEditor(page);
  const id = await createNode(page, 'line', { x1: 20, y1: 20, x2: 120, y2: 80, stroke: { width: 1, color: 1, style: 'solid' } });
  const numeric = [
    ['propX1', 'x1', 33], ['propY1', 'y1', 34], ['propX2', 'x2', 140], ['propY2', 'y2', 100],
  ];
  for (const [controlId, key, value] of numeric) {
    const control = page.locator(`#${controlId}`);
    await control.focus();
    await control.fill(String(value));
    expect((await node(page, id))[key]).toBe(value);
    await expect(control).toBeFocused();
  }

  const width = page.locator('#propStrokeWidth');
  await width.focus();
  await width.fill('7');
  expect((await node(page, id)).stroke.width).toBe(7);
  await setSelect(page, 'propStrokeColor', '0');
  expect((await node(page, id)).stroke.color).toBe(0);
  await setSelect(page, 'propStrokeStyle', 'dash-dot');
  expect((await node(page, id)).stroke.style).toBe('dash-dot');
});

test('rectangle corner, stroke and solid fill controls are all live', async ({ page }) => {
  await openEditor(page);
  const id = await createNode(page, 'rectangle', {
    x: 20, y: 20, w: 100, h: 70,
    rTL: 0, rTR: 0, rBL: 0, rBR: 0,
    stroke: { width: 1, color: 1, style: 'solid' },
    fill: { mode: 'solid', color: 1 },
  });
  for (const [controlId, key, value] of [
    ['propRTL', 'rTL', 5], ['propRTR', 'rTR', 6], ['propRBL', 'rBL', 7], ['propRBR', 'rBR', 8],
  ]) {
    const control = page.locator(`#${controlId}`);
    await control.focus();
    await control.fill(String(value));
    expect((await node(page, id))[key]).toBe(value);
  }
  await page.locator('#propStrokeWidth').fill('4');
  expect((await node(page, id)).stroke.width).toBe(4);
  await setSelect(page, 'propStrokeColor', '0');
  expect((await node(page, id)).stroke.color).toBe(0);
  await setSelect(page, 'propStrokeStyle', 'short-dash');
  expect((await node(page, id)).stroke.style).toBe('short-dash');
  await setSelect(page, 'propFillColor', '0');
  expect((await node(page, id)).fill.color).toBe(0);
});

test('circle and polygon share live stroke and fill bindings', async ({ page }) => {
  await openEditor(page);
  for (const [type, props] of [
    ['circle', { x: 20, y: 20, w: 80, h: 80 }],
    ['polygon', { points: [{ x: 20, y: 20 }, { x: 100, y: 20 }, { x: 60, y: 90 }] }],
  ]) {
    const id = await createNode(page, type, { ...props, stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'solid', color: 1 } });
    await page.locator('#propStrokeWidth').fill('6');
    expect((await node(page, id)).stroke.width).toBe(6);
    await setSelect(page, 'propStrokeStyle', 'dot');
    expect((await node(page, id)).stroke.style).toBe('dot');
    await setSelect(page, 'propFillColor', '0');
    expect((await node(page, id)).fill.color).toBe(0);
  }
});

test('shape dither controls update model and preview before blur', async ({ page }) => {
  await openEditor(page);
  const id = await createNode(page, 'rectangle', {
    x: 20, y: 20, w: 100, h: 70,
    fill: { mode: 'dither', color: 1 },
    dither: { type: 'bayer', density: 50, matrix: 4, align: 'global', offsetX: 0, offsetY: 0 },
  });
  const preview = page.locator('#ditherPreview');
  const before = await preview.screenshot();

  const density = page.locator('#propDitherDensity');
  await density.focus();
  await density.fill('75');
  expect((await node(page, id)).dither.density).toBe(75);
  await expect(density).toBeFocused();

  await setSelect(page, 'propDitherType', 'blueNoise');
  expect((await node(page, id)).dither.type).toBe('blueNoise');
  await setSelect(page, 'propDitherMatrix', '8');
  expect((await node(page, id)).dither.matrix).toBe(8);
  await setSelect(page, 'propDitherAlign', 'object');
  expect((await node(page, id)).dither.align).toBe('object');
  await page.locator('#propDitherOffsetX').fill('3');
  await page.locator('#propDitherOffsetY').fill('-2');
  const value = await node(page, id);
  expect(value.dither.offsetX).toBe(3);
  expect(value.dither.offsetY).toBe(-2);
  const after = await preview.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
});

test('shape pattern controls update live', async ({ page }) => {
  await openEditor(page);
  const id = await createNode(page, 'rectangle', {
    x: 20, y: 20, w: 100, h: 70,
    fill: { mode: 'pattern', color: 1 },
    pattern: { type: 'horizontal', lineWidth: 1, gap: 2, align: 'global', offsetX: 0, offsetY: 0 },
  });
  await setSelect(page, 'propPatternType', 'checkerboard');
  await page.locator('#propPatternLineWidth').fill('4');
  await page.locator('#propPatternGap').fill('5');
  await setSelect(page, 'propPatternAlign', 'object');
  await page.locator('#propPatternOffsetX').fill('2');
  await page.locator('#propPatternOffsetY').fill('3');
  const value = await node(page, id);
  expect(value.pattern).toMatchObject({ type: 'checkerboard', lineWidth: 4, gap: 5, align: 'object', offsetX: 2, offsetY: 3 });
});

test('mixed multi-selection numeric property becomes live for every selected shape', async ({ page }) => {
  await openEditor(page);
  const ids = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const p = editor.activePage();
    const a = M.createNode('rectangle', { parentId: p.id, x: 20, y: 20, w: 50, h: 40, stroke: { width: 1, color: 1, style: 'solid' } });
    const b = M.createNode('rectangle', { parentId: p.id, x: 100, y: 20, w: 50, h: 40, stroke: { width: 3, color: 1, style: 'solid' } });
    editor.exec(new C.AddNodesCommand([a, b], p.id));
    editor.state.selection.replace([a.id, b.id]);
    editor.pageSelectedId = null;
    editor.renderAll({ canvas: false, history: false });
    return [a.id, b.id];
  });
  const width = page.locator('#propStrokeWidth');
  await expect(width).toHaveValue('');
  await width.focus();
  await width.fill('5');
  const values = await page.evaluate(nodeIds => nodeIds.map(id => window.PixelEditorTest.getNode(id).stroke.width), ids);
  expect(values).toEqual([5, 5]);
  await expect(width).toBeFocused();
});

test('page name, lock and solid background are immediate', async ({ page }) => {
  await openEditor(page);
  await showPageProperties(page);
  const name = page.locator('#propPageName');
  await name.focus();
  await name.fill('实时页面');
  expect((await page.evaluate(() => window.PixelEditorTest.getActivePage().name))).toBe('实时页面');
  await expect(name).toBeFocused();

  await setSelect(page, 'propBgSolid', '1');
  expect((await page.evaluate(() => window.PixelEditorTest.getActivePage().fill.color))).toBe(1);

  await page.locator('#propPageLocked').check();
  expect((await page.evaluate(() => window.PixelEditorTest.getActivePage().locked))).toBe(true);
  await expect(page.locator('#propFill')).toBeDisabled();
});

test('page dither and pattern numeric/select controls update immediately', async ({ page }) => {
  await openEditor(page);
  await showPageProperties(page);
  await setSelect(page, 'propFill', 'dither');
  await page.locator('#propDitherDensity').fill('63');
  await setSelect(page, 'propDitherType', 'blueNoise');
  await setSelect(page, 'propDitherMatrix', '8');
  await setSelect(page, 'propDitherAlign', 'object');
  await page.locator('#propDitherOffsetX').fill('4');
  await page.locator('#propDitherOffsetY').fill('-3');
  let active = await page.evaluate(() => window.PixelEditorTest.getActivePage());
  expect(active.dither).toMatchObject({ density: 63, type: 'blueNoise', matrix: 8, align: 'object', offsetX: 4, offsetY: -3 });

  await setSelect(page, 'propFill', 'pattern');
  await setSelect(page, 'propPatternType', 'dots');
  await page.locator('#propPatternLineWidth').fill('3');
  await page.locator('#propPatternGap').fill('6');
  await setSelect(page, 'propPatternAlign', 'object');
  await page.locator('#propPatternOffsetX').fill('2');
  await page.locator('#propPatternOffsetY').fill('5');
  active = await page.evaluate(() => window.PixelEditorTest.getActivePage());
  expect(active.pattern).toMatchObject({ type: 'dots', lineWidth: 3, gap: 6, align: 'object', offsetX: 2, offsetY: 5 });
});
