import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function createText(page, props = {}) {
  return page.evaluate(extra => window.PixelEditorTest.createNode('text', {
    x: 30,
    y: 30,
    w: 180,
    h: 90,
    text: 'Hello',
    fontFamily: 'sans-serif',
    fontSize: 24,
    letterSpacing: 0,
    lineSpacing: 0,
    alignH: 'left',
    alignV: 'top',
    wrap: true,
    bold: false,
    invert: false,
    fill: { mode: 'solid', color: 1 },
    ...extra,
  }), props);
}

async function state(page, id) {
  return page.evaluate(nodeId => ({
    node: window.PixelEditorTest.getNode(nodeId),
    framebuffer: window.PixelEditorTest.framebufferString(),
    activeId: document.activeElement?.id || null,
    cursor: window.PixelEditorTest.editor.bus.cursor,
  }), id);
}

test('text content updates on input while preserving focus and caret', async ({ page }) => {
  await openEditor(page);
  const id = await createText(page);
  const before = await state(page, id);
  const text = page.locator('#propText');

  await text.focus();
  await text.fill('实时文字');

  let current = await state(page, id);
  expect(current.node.text).toBe('实时文字');
  expect(current.framebuffer).not.toBe(before.framebuffer);
  expect(current.activeId).toBe('propText');
  await expect(text).toBeFocused();

  await text.press('End');
  await text.type('!');
  current = await state(page, id);
  expect(current.node.text).toBe('实时文字!');
  const selection = await text.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, length: el.value.length }));
  expect(selection).toEqual({ start: selection.length, end: selection.length, length: selection.length });
});

test('IME composition does not commit partial text and commits on compositionend', async ({ page }) => {
  await openEditor(page);
  const id = await createText(page, { text: 'A' });
  const text = page.locator('#propText');
  await text.focus();

  await text.evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    el.value = 'A中';
    el.dispatchEvent(new InputEvent('input', { data: '中', inputType: 'insertCompositionText', isComposing: true, bubbles: true }));
  });
  expect((await state(page, id)).node.text).toBe('A');

  await text.evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionend', { data: '中', bubbles: true }));
  });
  const current = await state(page, id);
  expect(current.node.text).toBe('A中');
  expect(current.activeId).toBe('propText');
});

test('all numeric typography fields update live and support focused wheel', async ({ page }) => {
  await openEditor(page);
  const id = await createText(page);
  const cases = [
    ['propFontSize', 'fontSize', 32],
    ['propLetterSpacing', 'letterSpacing', 4],
    ['propLineSpacing', 'lineSpacing', 7],
  ];

  for (const [controlId, key, value] of cases) {
    const control = page.locator(`#${controlId}`);
    await control.focus();
    await control.fill(String(value));
    let current = await state(page, id);
    expect(current.node[key]).toBe(value);
    expect(current.activeId).toBe(controlId);

    await control.hover();
    await page.mouse.wheel(0, -100);
    current = await state(page, id);
    expect(current.node[key]).toBe(value + 1);
    await expect(control).toHaveValue(String(value + 1));
    await control.press('Tab');
  }
});

test('font alignment and boolean typography properties apply immediately', async ({ page }) => {
  await openEditor(page);
  const id = await createText(page);

  await page.locator('#propFont').selectOption('SimHei, sans-serif');
  expect((await state(page, id)).node.fontFamily).toBe('SimHei, sans-serif');

  await page.locator('#propAlignH').selectOption('center');
  await page.locator('#propAlignV').selectOption('middle');
  await page.locator('#propWrap').uncheck();
  await page.locator('#propBold').check();
  await page.locator('#propInvert').check();

  const current = (await state(page, id)).node;
  expect(current.alignH).toBe('center');
  expect(current.alignV).toBe('middle');
  expect(current.wrap).toBe(false);
  expect(current.bold).toBe(true);
  expect(current.invert).toBe(true);
});

test('text dither and pattern controls remain live after structural fill changes', async ({ page }) => {
  await openEditor(page);
  const id = await createText(page);

  await page.locator('#propFill').selectOption('dither');
  const density = page.locator('#propDitherDensity');
  await density.focus();
  await density.fill('72');
  await page.locator('#propDitherType').selectOption('blueNoise');
  await page.locator('#propDitherMatrix').selectOption('8');
  await page.locator('#propDitherAlign').selectOption('object');
  await page.locator('#propDitherOffsetX').fill('3');
  await page.locator('#propDitherOffsetY').fill('-2');
  let current = (await state(page, id)).node;
  expect(current.fill.mode).toBe('dither');
  expect(current.dither).toMatchObject({ density: 72, type: 'blueNoise', matrix: 8, align: 'object', offsetX: 3, offsetY: -2 });

  await page.locator('#propFill').selectOption('pattern');
  await page.locator('#propPatternType').selectOption('checkerboard');
  await page.locator('#propPatternLineWidth').fill('4');
  await page.locator('#propPatternGap').fill('5');
  await page.locator('#propPatternAlign').selectOption('object');
  await page.locator('#propPatternOffsetX').fill('2');
  await page.locator('#propPatternOffsetY').fill('6');
  current = (await state(page, id)).node;
  expect(current.fill.mode).toBe('pattern');
  expect(current.pattern).toMatchObject({ type: 'checkerboard', lineWidth: 4, gap: 5, align: 'object', offsetX: 2, offsetY: 6 });
});

test('one focused text numeric session is one undo step and a later focus is separate', async ({ page }) => {
  await openEditor(page);
  const id = await createText(page);
  const baseline = (await state(page, id)).cursor;
  let size = page.locator('#propFontSize');

  await size.focus();
  await size.fill('30');
  await size.fill('34');
  await size.press('Tab');
  let current = await state(page, id);
  expect(current.node.fontSize).toBe(34);
  expect(current.cursor - baseline).toBe(1);

  size = page.locator('#propFontSize');
  await size.focus();
  await size.fill('40');
  await size.press('Tab');
  current = await state(page, id);
  expect(current.node.fontSize).toBe(40);
  expect(current.cursor - baseline).toBe(2);

  const undone = await page.evaluate(nodeId => {
    const editor = window.PixelEditorTest.editor;
    editor.bus.undo();
    return window.PixelEditor.model.nodeById(editor.activePage(), nodeId)?.fontSize;
  }, id);
  expect(undone).toBe(34);
});
