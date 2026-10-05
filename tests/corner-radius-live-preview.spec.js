import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function createRectangle(page, props = {}) {
  return page.evaluate(extra => window.PixelEditorTest.createNode('rectangle', {
    x: 40,
    y: 40,
    w: 80,
    h: 60,
    rTL: 0,
    rTR: 0,
    rBL: 0,
    rBR: 0,
    stroke: { width: 0, color: 1, style: 'solid' },
    fill: { mode: 'solid', color: 1 },
    ...extra,
  }), props);
}

async function liveState(page, id) {
  return page.evaluate(nodeId => ({
    node: window.PixelEditorTest.getNode(nodeId),
    framebuffer: window.PixelEditorTest.framebufferString(),
    activeId: document.activeElement?.id || null,
    cursor: window.PixelEditorTest.editor.bus.cursor,
  }), id);
}

test('focused corner radius wheel changes update the rectangle before blur', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);
  const before = await liveState(page, id);
  const radius = page.locator('#propRTL');

  await radius.click();
  await radius.hover();
  for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, -100);

  await expect(radius).toHaveValue('5');
  const during = await liveState(page, id);
  expect(during.node.rTL).toBe(5);
  expect(during.framebuffer).not.toBe(before.framebuffer);
  expect(during.activeId).toBe('propRTL');
});

test('typing a corner radius updates live without rebuilding the focused input', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);
  const before = await liveState(page, id);
  const radius = page.locator('#propRTR');

  await radius.focus();
  await radius.fill('12');

  const during = await liveState(page, id);
  expect(during.node.rTR).toBe(12);
  expect(during.framebuffer).not.toBe(before.framebuffer);
  expect(during.activeId).toBe('propRTR');
  await expect(radius).toHaveValue('12');
});

test('one corner edit session is one undo step and a later session starts a new step', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);
  const baseline = await page.evaluate(() => window.PixelEditorTest.editor.bus.cursor);
  let radius = page.locator('#propRBL');

  await radius.focus();
  await radius.fill('3');
  await radius.fill('6');
  await radius.press('Tab');

  let state = await liveState(page, id);
  expect(state.node.rBL).toBe(6);
  expect(state.cursor - baseline).toBe(1);

  radius = page.locator('#propRBL');
  await radius.focus();
  await radius.fill('9');
  await radius.press('Tab');

  state = await liveState(page, id);
  expect(state.node.rBL).toBe(9);
  expect(state.cursor - baseline).toBe(2);

  const undone = await page.evaluate(nodeId => {
    const editor = window.PixelEditorTest.editor;
    editor.bus.undo();
    return window.PixelEditorDebug.services.model.nodeById(editor.activePage(), nodeId)?.rBL;
  }, id);
  expect(undone).toBe(6);
});

test('live corner radius editing applies to every selected rectangle and clamps limits', async ({ page }) => {
  await openEditor(page);
  const ids = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const a = M.createNode('rectangle', { parentId: p.id, x: 20, y: 20, w: 60, h: 50, rBR: 0, fill: { mode: 'solid', color: 1 } });
    const b = M.createNode('rectangle', { parentId: p.id, x: 120, y: 20, w: 60, h: 50, rBR: 0, fill: { mode: 'solid', color: 1 } });
    editor.exec(new C.AddNodesCommand([a, b], p.id));
    editor.state.selection.replace([a.id, b.id]);
    editor.pageSelectedId = null;
    editor.renderAll({ canvas: false, history: false });
    return [a.id, b.id];
  });

  const radius = page.locator('#propRBR');
  await radius.focus();
  await radius.fill('999');

  const result = await page.evaluate(nodeIds => ({
    values: nodeIds.map(id => window.PixelEditorTest.getNode(id).rBR),
    activeId: document.activeElement?.id || null,
  }), ids);
  expect(result.values).toEqual([200, 200]);
  expect(result.activeId).toBe('propRBR');
  await expect(radius).toHaveValue('200');
});
