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
    stroke: { width: 1, color: 1, style: 'solid' },
    fill: { mode: 'solid', color: 1 },
    ...extra,
  }), props);
}

async function state(page, id) {
  return page.evaluate(nodeId => ({
    node: window.PixelEditorTest.getNode(nodeId),
    activeId: document.activeElement?.id || null,
    cursor: window.PixelEditorTest.editor.bus.cursor,
    framebuffer: window.PixelEditorTest.framebufferString(),
  }), id);
}

async function historySince(page, baseline) {
  return page.evaluate(start => {
    const editor = window.PixelEditorTest.editor;
    return {
      cursor: editor.bus.cursor,
      entries: editor.bus.entries.slice(start + 1, editor.bus.cursor + 1).map(entry => ({
        label: entry.label,
        descriptor: entry.mergeDescriptor || null,
      })),
    };
  }, baseline);
}

test('number input updates geometry before blur and keeps the same focused control', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);
  const before = await state(page, id);
  const x = page.locator('#propX');

  await x.focus();
  await x.fill('73');

  const during = await state(page, id);
  expect(during.node.x).toBe(73);
  expect(during.framebuffer).not.toBe(before.framebuffer);
  expect(during.activeId).toBe('propX');
  await expect(x).toHaveValue('73');
});

test('focused number wheel previews immediately and stays in one undo session', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);
  const baseline = await page.evaluate(() => window.PixelEditorTest.editor.bus.cursor);
  const width = page.locator('#propW');

  await width.click();
  await width.hover();
  for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, -100);

  const during = await state(page, id);
  expect(during.node.w).toBe(84);
  expect(during.activeId).toBe('propW');

  await width.fill('90');
  await width.press('Tab');
  const after = await state(page, id);
  expect(after.node.w).toBe(90);
  expect(after.cursor - baseline).toBe(1);
});

test('a later focus session creates a separate undo step', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);
  const baseline = await page.evaluate(() => window.PixelEditorTest.editor.bus.cursor);

  let x = page.locator('#propX');
  await x.focus();
  await x.fill('50');
  await x.fill('60');
  await x.press('Tab');

  x = page.locator('#propX');
  await x.focus();
  await x.fill('70');
  await x.press('Tab');

  let current = await state(page, id);
  expect(current.node.x).toBe(70);
  expect(current.cursor - baseline).toBe(2);

  const undone = await page.evaluate(nodeId => {
    const editor = window.PixelEditorTest.editor;
    editor.bus.undo();
    editor.renderAll();
    return window.PixelEditorTest.getNode(nodeId)?.x;
  }, id);
  expect(undone).toBe(60);
});

test('invalid intermediate numeric input never writes NaN and blur restores the model value', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page, { x: 44 });
  const x = page.locator('#propX');

  await x.focus();
  await x.fill('');
  let during = await state(page, id);
  expect(during.node.x).toBe(44);
  expect(Number.isFinite(during.node.x)).toBe(true);

  await x.press('Tab');
  await expect(page.locator('#propX')).toHaveValue('44');
});

test('selection changes split live property history sessions', async ({ page }) => {
  await openEditor(page);
  const ids = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const a = window.PixelEditorTest.createNode('rectangle', { x: 20, y: 20, w: 40, h: 40, fill: { mode: 'solid', color: 1 } });
    const b = window.PixelEditorTest.createNode('rectangle', { x: 100, y: 20, w: 40, h: 40, fill: { mode: 'solid', color: 1 } });
    return [a, b];
  });
  const baseline = await page.evaluate(() => window.PixelEditorTest.editor.bus.cursor);
  const stages = {};

  await page.evaluate(id => {
    const editor = window.PixelEditorTest.editor;
    editor.state.selection.replace([id]);
    editor.pageSelectedId = null;
    editor.renderAll({ canvas: false, history: false });
  }, ids[0]);
  stages.afterFirstSelection = await historySince(page, baseline);
  await page.locator('#propX').fill('30');
  stages.afterFirstFill = await historySince(page, baseline);

  await page.evaluate(id => {
    const editor = window.PixelEditorTest.editor;
    editor.state.selection.replace([id]);
    editor.renderAll({ canvas: false, history: false });
  }, ids[1]);
  stages.afterSecondSelection = await historySince(page, baseline);
  await page.locator('#propX').fill('110');
  stages.afterSecondFill = await historySince(page, baseline);
  await page.locator('#propX').press('Tab');
  stages.afterTab = await historySince(page, baseline);

  const result = await page.evaluate(nodeIds => ({
    values: nodeIds.map(id => window.PixelEditorTest.getNode(id)?.x),
    cursor: window.PixelEditorTest.editor.bus.cursor,
  }), ids);
  console.log('LIVE_HISTORY_STAGES', JSON.stringify({ baseline, result, stages }));
  expect(result.values).toEqual([30, 110]);
  expect(result.cursor - baseline).toBe(2);
});
