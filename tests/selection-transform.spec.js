import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('multi-selection rotation uses union center and is one undoable command', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const a = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 10, h: 10 });
    const b = M.createNode('rectangle', { parentId: p.id, x: 30, y: 10, w: 10, h: 10 });
    editor.exec(new C.AddNodesCommand([a, b], p.id));
    editor.state.selection.replace([a.id, b.id]);
    const beforeCursor = editor.bus.cursor;
    const changed = editor.runSelectionTransform('rotate-cw-90');
    const after = [a.id, b.id].map(id => {
      const node = M.nodeById(editor.activePage(), id);
      return { x: node.x, y: node.y, transform: structuredClone(node.transform) };
    });
    const afterCursor = editor.bus.cursor;
    editor.bus.undo();
    const undone = [a.id, b.id].map(id => {
      const node = M.nodeById(editor.activePage(), id);
      return { x: node.x, y: node.y, transform: structuredClone(node.transform) };
    });
    return { changed, beforeCursor, afterCursor, after, undone };
  });

  expect(result.changed).toBe(true);
  expect(result.afterCursor - result.beforeCursor).toBe(1);
  expect(result.after).toEqual([
    { x: 20, y: 0, transform: { rotation: 90, flipX: false, flipY: false } },
    { x: 20, y: 20, transform: { rotation: 90, flipX: false, flipY: false } },
  ]);
  expect(result.undone).toEqual([
    { x: 10, y: 10, transform: { rotation: 0, flipX: false, flipY: false } },
    { x: 30, y: 10, transform: { rotation: 0, flipX: false, flipY: false } },
  ]);
});

test('group flip reflects transformed visual centers and composes orientation', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const R = window.PixelEditor.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const a = M.createNode('rectangle', { parentId: p.id, x: 10, y: 20, w: 10, h: 10, transform: { rotation: 30, flipX: false, flipY: true } });
    const b = M.createNode('rectangle', { parentId: p.id, x: 30, y: 20, w: 10, h: 10, transform: { rotation: -20, flipX: true, flipY: false } });
    editor.exec(new C.AddNodesCommand([a, b], p.id));
    editor.state.selection.replace([a.id, b.id]);
    const context = { project: editor.state.project, pageId: p.id, assets: editor.state.assets };
    const beforeBounds = [a.id, b.id].map(id => R.FramebufferRenderer.visualBounds(id, context));
    const left = Math.min(...beforeBounds.map(item => item.x));
    const right = Math.max(...beforeBounds.map(item => item.x + item.w));
    const pivotX = (left + right) / 2;
    const beforeCenters = beforeBounds.map(item => ({ x: item.x + item.w / 2, y: item.y + item.h / 2 }));

    editor.runSelectionTransform('flip-horizontal');
    const afterContext = { project: editor.state.project, pageId: p.id, assets: editor.state.assets };
    const after = [a.id, b.id].map(id => {
      const node = M.nodeById(editor.activePage(), id);
      const bounds = R.FramebufferRenderer.visualBounds(id, afterContext);
      return {
        center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
        transform: structuredClone(node.transform),
      };
    });
    return { pivotX, beforeCenters, after };
  });

  result.after.forEach((item, index) => {
    expect(item.center.x).toBeCloseTo(result.pivotX * 2 - result.beforeCenters[index].x, 8);
    expect(item.center.y).toBeCloseTo(result.beforeCenters[index].y, 8);
  });
  expect(result.after.map(item => item.transform)).toEqual([
    { rotation: -30, flipX: true, flipY: true },
    { rotation: 20, flipX: false, flipY: false },
  ]);
});

test('locked selected nodes remain selected but are skipped by transforms', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const open = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 10, h: 10 });
    const locked = M.createNode('rectangle', { parentId: p.id, x: 50, y: 10, w: 10, h: 10, locked: true });
    editor.exec(new C.AddNodesCommand([open, locked], p.id));
    editor.state.selection.replace([open.id, locked.id]);
    const changed = editor.runSelectionTransform('rotate-angle', 45);
    const currentOpen = M.nodeById(editor.activePage(), open.id);
    const currentLocked = M.nodeById(editor.activePage(), locked.id);
    return {
      changed,
      selected: [...editor.state.selection.ids],
      open: { x: currentOpen.x, y: currentOpen.y, transform: structuredClone(currentOpen.transform) },
      locked: { x: currentLocked.x, y: currentLocked.y, transform: structuredClone(currentLocked.transform) },
    };
  });

  expect(result.changed).toBe(true);
  expect(result.selected).toHaveLength(2);
  expect(result.open.transform.rotation).toBe(45);
  expect(result.open.x).toBe(10);
  expect(result.open.y).toBe(10);
  expect(result.locked).toEqual({ x: 50, y: 10, transform: { rotation: 0, flipX: false, flipY: false } });
});

test('align and distribute operate on transformed visual bounds', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const R = window.PixelEditor.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const nodes = [
      M.createNode('rectangle', { parentId: p.id, x: 20, y: 20, w: 30, h: 10, transform: { rotation: 90 } }),
      M.createNode('rectangle', { parentId: p.id, x: 100, y: 40, w: 20, h: 20 }),
      M.createNode('rectangle', { parentId: p.id, x: 180, y: 60, w: 10, h: 30, transform: { rotation: 45 } }),
    ];
    editor.exec(new C.AddNodesCommand(nodes, p.id));
    editor.state.selection.replace(nodes.map(node => node.id));
    editor.align('top');
    const tops = nodes.map(node => R.FramebufferRenderer.visualBounds(node.id, { project: editor.state.project, pageId: p.id, assets: editor.state.assets }).y);
    editor.distribute('horizontal');
    const bounds = nodes.map(node => R.FramebufferRenderer.visualBounds(node.id, { project: editor.state.project, pageId: p.id, assets: editor.state.assets })).sort((a, b) => a.x - b.x);
    const gaps = [bounds[1].x - (bounds[0].x + bounds[0].w), bounds[2].x - (bounds[1].x + bounds[1].w)];
    return { tops, gaps };
  });

  expect(Math.max(...result.tops) - Math.min(...result.tops)).toBeLessThan(1e-5);
  expect(Math.abs(result.gaps[0] - result.gaps[1])).toBeLessThanOrEqual(1e-5);
});

test('zero-angle and empty selection transforms do not create history entries', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const first = editor.bus.cursor;
    const empty = editor.runSelectionTransform('rotate-cw-90');
    const afterEmpty = editor.bus.cursor;
    const zero = editor.runSelectionTransform('rotate-angle', 0);
    return { first, empty, afterEmpty, zero, finalCursor: editor.bus.cursor };
  });
  expect(result.empty).toBe(false);
  expect(result.zero).toBe(false);
  expect(result.afterEmpty).toBe(result.first);
  expect(result.finalCursor).toBe(result.first);
});
