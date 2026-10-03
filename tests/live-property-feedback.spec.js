import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function createRectangle(page, props = {}) {
  return page.evaluate(extra => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const id = window.PixelEditorTest.createNode('rectangle', {
      x: 40, y: 40, w: 80, h: 60,
      stroke: { width: 1, color: 1, style: 'solid' },
      fill: { mode: 'solid', color: 1 },
      ...extra,
    });
    editor.state.selection.replace([id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    return id;
  }, props);
}

async function dispatchInput(page, selector, value) {
  await page.locator(selector).focus();
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(nextValue) }));
  }, value);
}

test('rectangle corner radius updates on input before blur and keeps focus', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);
  const before = await page.evaluate(() => window.PixelEditorTest.framebufferString());

  await dispatchInput(page, '#propRTL', 5);
  await page.waitForFunction(nodeId => window.PixelEditorTest.getNode(nodeId)?.rTL === 5, id);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const result = await page.evaluate(nodeId => ({
    radius: window.PixelEditorTest.getNode(nodeId).rTL,
    activeId: document.activeElement?.id,
    framebuffer: window.PixelEditorTest.framebufferString(),
  }), id);
  expect(result.radius).toBe(5);
  expect(result.activeId).toBe('propRTL');
  expect(result.framebuffer).not.toBe(before);
});

test('continuous numeric input coalesces into one undo step', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);
  const before = await page.evaluate(() => window.PixelEditorTest.editor.bus.cursor);

  await page.locator('#propRTL').focus();
  await page.locator('#propRTL').evaluate(element => {
    for (const value of ['1', '12', '25']) {
      element.value = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }
  });
  await page.waitForFunction(nodeId => window.PixelEditorTest.getNode(nodeId)?.rTL === 25, id);

  const result = await page.evaluate(nodeId => ({
    radius: window.PixelEditorTest.getNode(nodeId).rTL,
    cursor: window.PixelEditorTest.editor.bus.cursor,
    activeId: document.activeElement?.id,
  }), id);
  expect(result.radius).toBe(25);
  expect(result.cursor - before).toBe(1);
  expect(result.activeId).toBe('propRTL');
});

test('transform and shape numeric fields update live', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);

  await dispatchInput(page, '#propX', 73);
  await page.waitForFunction(nodeId => window.PixelEditorTest.getNode(nodeId)?.x === 73, id);
  await dispatchInput(page, '#propW', 96);
  await page.waitForFunction(nodeId => window.PixelEditorTest.getNode(nodeId)?.w === 96, id);
  await dispatchInput(page, '#propStrokeWidth', 4);
  await page.waitForFunction(nodeId => window.PixelEditorTest.getNode(nodeId)?.stroke?.width === 4, id);

  const node = await page.evaluate(nodeId => window.PixelEditorTest.getNode(nodeId), id);
  expect(node.x).toBe(73);
  expect(node.w).toBe(96);
  expect(node.stroke.width).toBe(4);
});

test('dither pattern text and image numeric properties update live', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const rectangle = M.createNode('rectangle', {
      parentId: p.id, x: 10, y: 10, w: 40, h: 30,
      fill: { mode: 'dither', color: 1 },
      dither: { type: 'bayer', density: 20, matrix: 4, align: 'object', offsetX: 0, offsetY: 0 },
    });
    const text = M.createNode('text', { parentId: p.id, x: 60, y: 10, w: 80, h: 30, text: 'abc', fontSize: 16, letterSpacing: 0, lineSpacing: 0 });
    const image = M.createNode('image', {
      parentId: p.id, x: 10, y: 70, w: 20, h: 20,
      assetId: 'missing', sourceWidth: 20, sourceHeight: 20,
      image: { fit: 'stretch', interpolation: 'nearest', cropX: 0, cropY: 0, cropW: 20, cropH: 20, bwMode: 'threshold', threshold: 128, invert: false },
    });
    editor.exec(new C.AddNodesCommand([rectangle, text, image], p.id));
    return { rectangle: rectangle.id, text: text.id, image: image.id };
  });

  await page.evaluate(id => {
    const editor = window.PixelEditorTest.editor;
    editor.state.selection.replace([id]); editor.pageSelectedId = null; editor.properties.render();
  }, result.rectangle);
  await dispatchInput(page, '#propDitherDensity', 67);
  await page.waitForFunction(id => window.PixelEditorTest.getNode(id)?.dither?.density === 67, result.rectangle);

  await page.evaluate(id => {
    const editor = window.PixelEditorTest.editor;
    editor.state.selection.replace([id]); editor.properties.render();
  }, result.text);
  await dispatchInput(page, '#propFontSize', 31);
  await page.waitForFunction(id => window.PixelEditorTest.getNode(id)?.fontSize === 31, result.text);
  await dispatchInput(page, '#propLetterSpacing', 3);
  await page.waitForFunction(id => window.PixelEditorTest.getNode(id)?.letterSpacing === 3, result.text);

  await page.evaluate(id => {
    const editor = window.PixelEditorTest.editor;
    editor.state.selection.replace([id]); editor.properties.render();
  }, result.image);
  await dispatchInput(page, '#propThreshold', 201);
  await page.waitForFunction(id => window.PixelEditorTest.getNode(id)?.image?.threshold === 201, result.image);

  const values = await page.evaluate(ids => ({
    density: window.PixelEditorTest.getNode(ids.rectangle).dither.density,
    fontSize: window.PixelEditorTest.getNode(ids.text).fontSize,
    letterSpacing: window.PixelEditorTest.getNode(ids.text).letterSpacing,
    threshold: window.PixelEditorTest.getNode(ids.image).image.threshold,
  }), result);
  expect(values).toEqual({ density: 67, fontSize: 31, letterSpacing: 3, threshold: 201 });
});

test('page numeric properties and names update live', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const p = editor.activePage();
    p.fill = { mode: 'dither', color: 0 };
    p.dither = { type: 'bayer', density: 10, matrix: 4, align: 'global', offsetX: 0, offsetY: 0 };
    editor.state.selection.clear();
    editor.pageSelectedId = p.id;
    editor.properties.render();
  });

  await dispatchInput(page, '#propPageName', '实时页面');
  await page.waitForFunction(() => window.PixelEditorTest.getActivePage().name === '实时页面');
  await dispatchInput(page, '#propDitherDensity', 55);
  await page.waitForFunction(() => window.PixelEditorTest.getActivePage().dither?.density === 55);

  const value = await page.evaluate(() => ({
    name: window.PixelEditorTest.getActivePage().name,
    density: window.PixelEditorTest.getActivePage().dither.density,
    activeId: document.activeElement?.id,
  }));
  expect(value.name).toBe('实时页面');
  expect(value.density).toBe(55);
  expect(value.activeId).toBe('propDitherDensity');
});

test('numeric tool options update on input without losing focus', async ({ page }) => {
  await openEditor(page);

  await page.evaluate(() => window.PixelEditorTest.editor.setTool('pencil'));
  await dispatchInput(page, '#toolOptionWidth', 13);
  await page.waitForFunction(() => window.PixelEditorTest.editor.getToolDefaults('pencil').width === 13);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('toolOptionWidth');

  await page.evaluate(() => window.PixelEditorTest.editor.setTool('rectangle'));
  await dispatchInput(page, '#toolOptionWidth', 6);
  await page.waitForFunction(() => window.PixelEditorTest.editor.getToolDefaults('rectangle').width === 6);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('toolOptionWidth');

  await page.evaluate(() => window.PixelEditorTest.editor.setTool('text'));
  await dispatchInput(page, '#toolOptionFontSize', 28);
  await page.waitForFunction(() => window.PixelEditorTest.editor.getToolDefaults('text').fontSize === 28);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('toolOptionFontSize');

  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.setTool('bucket');
    editor.setToolDefault('bucket', 'fill', { mode: 'dither', color: 1 });
    editor.toolOptionsBar.render();
  });
  await dispatchInput(page, '#toolOptionDitherDensity', 74);
  await page.waitForFunction(() => window.PixelEditorTest.editor.getToolDefaults('bucket').dither?.density === 74);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('toolOptionDitherDensity');
});

test('live edits avoid panel rebuilds and batch canvas rendering for rapid input', async ({ page }) => {
  await openEditor(page);
  const id = await createRectangle(page);

  const result = await page.evaluate(async nodeId => {
    const editor = window.PixelEditorTest.editor;
    const counts = { properties: 0, layers: 0, tools: 0, canvas: 0 };
    const wrap = (object, key, counter) => {
      const original = object[key].bind(object);
      object[key] = (...args) => { counts[counter] += 1; return original(...args); };
    };
    wrap(editor.properties, 'render', 'properties');
    wrap(editor.pageLayers, 'render', 'layers');
    wrap(editor.toolOptionsBar, 'render', 'tools');
    wrap(editor, 'renderCanvas', 'canvas');

    const input = document.querySelector('#propRTL');
    input.focus();
    const beforeCursor = editor.bus.cursor;
    const start = performance.now();
    for (let value = 1; value <= 50; value += 1) {
      input.value = String(value);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
    }
    const dispatchMs = performance.now() - start;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      counts,
      dispatchMs,
      historyDelta: editor.bus.cursor - beforeCursor,
      radius: window.PixelEditorTest.getNode(nodeId).rTL,
      activeId: document.activeElement?.id,
    };
  }, id);

  expect(result.radius).toBe(50);
  expect(result.activeId).toBe('propRTL');
  expect(result.historyDelta).toBe(1);
  expect(result.counts.properties).toBe(0);
  expect(result.counts.layers).toBe(0);
  expect(result.counts.tools).toBe(0);
  expect(result.counts.canvas).toBeLessThanOrEqual(2);
  expect(result.dispatchMs).toBeLessThan(750);
});
