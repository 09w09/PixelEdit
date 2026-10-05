import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('zero transparent tool defaults are snapshotted into newly drawn shapes', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const output = {};
    for (const type of ['line', 'rectangle', 'circle', 'polygon']) {
      editor.newProject({ force: true });
      editor.setToolDefault(type, 'width', 0);
      editor.setToolDefault(type, 'color', 'transparent');
      editor.setTool(type);
      editor.beginLiveDraw(type, { x: 20, y: 20 });
      editor.updateLiveDraw(editor.customGesture, { x: 50, y: 45 });
      output[type] = structuredClone(M.nodeById(editor.activePage(), editor.customGesture.nodeId).stroke);
      editor.cancelCustomGesture();
    }
    editor.newProject({ force: true });
    editor.setToolDefault('pencil', 'width', 0);
    return { output, pencil: editor.getToolDefaults('pencil') };
  });

  for (const type of ['line', 'rectangle', 'circle', 'polygon']) {
    expect(result.output[type]).toEqual({ width: 0, color: 'transparent', style: 'solid' });
  }
  expect(result.pencil.width).toBe(1);
});

test('invisible line and polygon strokes retain source geometry bounds for selection', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const R = window.PixelEditorDebug.services.renderer.FramebufferRenderer;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const line = M.createNode('line', {
      parentId: active.id,
      x1: 10, y1: 15, x2: 30, y2: 25,
      stroke: { width: 0, color: 1, style: 'solid' },
    });
    const polygon = M.createNode('polygon', {
      parentId: active.id,
      points: [{ x: 50, y: 60 }, { x: 70, y: 40 }, { x: 90, y: 65 }],
      stroke: { width: 3, color: 'transparent', style: 'solid' },
      fill: { mode: 'transparent', color: 1 },
    });
    active.nodes.push(line, polygon);
    const context = { project: editor.state.project, pageId: active.id, assets: editor.state.assets };
    return {
      line: R.visualBounds(line.id, context),
      polygon: R.visualBounds(polygon.id, context),
    };
  });

  expect(result.line).toEqual({ x: 10, y: 15, w: 21, h: 11 });
  expect(result.polygon).toEqual({ x: 50, y: 40, w: 41, h: 26 });
});

test('text editing creates one undo step per focus session and restores each session exactly', async ({ page }) => {
  await openEditor(page);
  const seed = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const node = M.createNode('text', {
      parentId: active.id,
      x: 20, y: 20, w: 120, h: 40,
      text: '', fontSize: 16,
    });
    editor.exec(new C.AddNodesCommand([node], active.id));
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    return { id: node.id, baseline: editor.bus.cursor };
  });

  const text = page.locator('#propText');
  await text.focus();
  await page.keyboard.type('abc');
  await text.blur();
  await text.focus();
  await page.keyboard.type('d');

  const beforeUndo = await page.evaluate(id => {
    const editor = window.PixelEditorTest.editor;
    return {
      text: window.PixelEditorDebug.services.model.nodeById(editor.activePage(), id).text,
      cursor: editor.bus.cursor,
    };
  }, seed.id);
  expect(beforeUndo).toEqual({ text: 'abcd', cursor: seed.baseline + 2 });

  const states = await page.evaluate(id => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    editor.bus.undo();
    const afterFirstUndo = M.nodeById(editor.activePage(), id).text;
    editor.bus.undo();
    const afterSecondUndo = M.nodeById(editor.activePage(), id).text;
    editor.bus.redo();
    const afterFirstRedo = M.nodeById(editor.activePage(), id).text;
    editor.bus.redo();
    const afterSecondRedo = M.nodeById(editor.activePage(), id).text;
    return { afterFirstUndo, afterSecondUndo, afterFirstRedo, afterSecondRedo };
  }, seed.id);

  expect(states).toEqual({
    afterFirstUndo: 'abc',
    afterSecondUndo: '',
    afterFirstRedo: 'abc',
    afterSecondRedo: 'abcd',
  });
});
