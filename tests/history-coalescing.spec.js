import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function seedTwoNodes(page) {
  return page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const a = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 10, h: 10 });
    const b = M.createNode('rectangle', { parentId: p.id, x: 30, y: 10, w: 10, h: 10 });
    editor.exec(new C.AddNodesCommand([a, b], p.id));
    return { pageId: p.id, a: a.id, b: b.id, cursor: editor.bus.cursor };
  });
}

test('merge descriptors normalize target order and duplicates', async ({ page }) => {
  await openEditor(page);
  const normalized = await page.evaluate(() => {
    const H = window.PixelEditorDebug.services.commands;
    const value = H.normalizeMergeDescriptor({ operation: 'move', targets: ['b', 'a', 'b'], channel: 'geometry' });
    return { value, key: H.mergeDescriptorKey(value) };
  });
  expect(normalized.value).toEqual({ operation: 'move', targets: ['a', 'b'], channel: 'geometry' });
  expect(normalized.key).toBe(JSON.stringify(normalized.value));
});

test('matching moves coalesce without a time window and ignore target order', async ({ page }) => {
  await openEditor(page);
  const seed = await seedTwoNodes(page);
  const result = await page.evaluate(async ({ pageId, a, b, cursor }) => {
    const editor = window.PixelEditorTest.editor;
    const C = window.PixelEditorDebug.services.commands;
    editor.exec(new C.MoveSelectionCommand([b, a], 1, 0, pageId, { mergeKey: 'legacy-nudge' }));
    await new Promise(resolve => setTimeout(resolve, 650));
    editor.exec(new C.MoveSelectionCommand([a, b], 1, 0, pageId, { mergeKey: 'legacy-nudge' }));
    editor.exec(new C.MoveSelectionCommand([b, a], -1, 0, pageId, { mergeKey: 'legacy-nudge' }));
    const afterSameTargets = editor.bus.cursor;
    editor.exec(new C.MoveSelectionCommand([a], 1, 0, pageId, { mergeKey: 'legacy-nudge' }));
    return {
      baseline: cursor,
      afterSameTargets,
      afterDifferentTargets: editor.bus.cursor,
      entries: editor.bus.entries.map(entry => ({ label: entry.label, descriptor: entry.mergeDescriptor || null })),
    };
  }, seed);

  expect(result.afterSameTargets - result.baseline).toBe(1);
  expect(result.afterDifferentTargets - result.baseline).toBe(2);
  expect(result.entries[result.afterSameTargets].descriptor).toEqual({ operation: 'move', targets: [seed.a, seed.b].sort(), channel: 'geometry' });
});

test('property edits merge by semantic channel and split when channel changes', async ({ page }) => {
  await openEditor(page);
  const seed = await seedTwoNodes(page);
  const result = await page.evaluate(({ pageId, a, cursor }) => {
    const editor = window.PixelEditorTest.editor;
    const C = window.PixelEditorDebug.services.commands;
    const edit = (patch, channel, label) => editor.exec(new C.UpdateNodesCommand(
      [a], patch, pageId, label, { historyChannel: channel },
    ));
    edit({ x: 20 }, 'x', 'X');
    edit({ x: 30 }, 'x', 'X');
    edit({ x: 40 }, 'x', 'X');
    const afterX = editor.bus.cursor;
    edit({ y: 20 }, 'y', 'Y');
    edit({ y: 30 }, 'y', 'Y');
    return {
      baseline: cursor,
      afterX,
      afterY: editor.bus.cursor,
      descriptors: editor.bus.entries.slice(cursor + 1).map(entry => entry.mergeDescriptor || null),
    };
  }, seed);

  expect(result.afterX - result.baseline).toBe(1);
  expect(result.afterY - result.baseline).toBe(2);
  expect(result.descriptors).toEqual([
    { operation: 'property', targets: [seed.a], channel: 'x' },
    { operation: 'property', targets: [seed.a], channel: 'y' },
  ]);
});

test('selection, tool, and page changes explicitly break a matching move chain', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;

    const setup = () => {
      editor.newProject({ force: true });
      const first = editor.activePage();
      const a = M.createNode('rectangle', { parentId: first.id, x: 10, y: 10, w: 10, h: 10 });
      const b = M.createNode('rectangle', { parentId: first.id, x: 30, y: 10, w: 10, h: 10 });
      editor.exec(new C.AddNodesCommand([a, b], first.id));
      editor.exec(new C.CreatePageCommand('第二页'));
      const secondId = editor.activePage().id;
      editor.selectPage(first.id);
      editor.state.selection.replace([a.id]);
      return { firstId: first.id, secondId, a: a.id, b: b.id, baseline: editor.bus.cursor };
    };
    const move = s => editor.exec(new C.MoveSelectionCommand([s.a], 1, 0, s.firstId, { mergeKey: 'same' }));

    const selection = setup();
    move(selection);
    editor.state.selection.replace([selection.b]);
    editor.state.selection.replace([selection.a]);
    move(selection);
    const selectionDelta = editor.bus.cursor - selection.baseline;

    const tool = setup();
    move(tool);
    editor.setTool('rectangle');
    editor.setTool('pointer');
    move(tool);
    const toolDelta = editor.bus.cursor - tool.baseline;

    const pageBoundary = setup();
    move(pageBoundary);
    editor.selectPage(pageBoundary.secondId);
    editor.selectPage(pageBoundary.firstId);
    editor.state.selection.replace([pageBoundary.a]);
    move(pageBoundary);
    const pageDelta = editor.bus.cursor - pageBoundary.baseline;

    return { selectionDelta, toolDelta, pageDelta };
  });

  expect(result).toEqual({ selectionDelta: 2, toolDelta: 2, pageDelta: 2 });
});

test('create delete and paste are nonmergeable boundaries', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;

    const setup = () => {
      editor.newProject({ force: true });
      const p = editor.activePage();
      const a = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 10, h: 10 });
      const b = M.createNode('rectangle', { parentId: p.id, x: 30, y: 10, w: 10, h: 10 });
      editor.exec(new C.AddNodesCommand([a, b], p.id));
      return { pageId: p.id, a: a.id, b: b.id, baseline: editor.bus.cursor };
    };
    const move = s => editor.exec(new C.MoveSelectionCommand([s.a], 1, 0, s.pageId, { mergeKey: 'same' }));

    const create = setup();
    move(create);
    const c = M.createNode('circle', { parentId: create.pageId, x: 50, y: 10, w: 10, h: 10 });
    editor.exec(new C.AddNodesCommand([c], create.pageId));
    move(create);
    const createDelta = editor.bus.cursor - create.baseline;

    const del = setup();
    move(del);
    editor.exec(new C.DeleteNodesCommand([del.b], del.pageId));
    move(del);
    const deleteDelta = editor.bus.cursor - del.baseline;

    const paste = setup();
    move(paste);
    const page = editor.activePage();
    const payload = C.payloadFromIds(editor.state.project, page, [paste.b]);
    editor.exec(new C.PasteCommand(payload, 1, paste.pageId));
    editor.state.selection.replace([paste.a]);
    move(paste);
    const pasteDelta = editor.bus.cursor - paste.baseline;

    return { createDelta, deleteDelta, pasteDelta };
  });

  expect(result).toEqual({ createDelta: 3, deleteDelta: 3, pasteDelta: 3 });
});

test('undo redo jump and undo-then-edit break merge continuity and truncate redo branches', async ({ page }) => {
  await openEditor(page);
  const seed = await seedTwoNodes(page);
  const result = await page.evaluate(({ pageId, a, cursor }) => {
    const editor = window.PixelEditorTest.editor;
    const C = window.PixelEditorDebug.services.commands;
    const move = () => editor.exec(new C.MoveSelectionCommand([a], 1, 0, pageId, { mergeKey: 'same' }));

    move();
    move();
    const coalescedCursor = editor.bus.cursor;
    editor.bus.undo();
    editor.bus.redo();
    move();
    const afterRedoMove = { cursor: editor.bus.cursor, length: editor.bus.entries.length };

    editor.exec(new C.UpdateNodesCommand([a], { y: 50 }, pageId, 'Y', { historyChannel: 'y' }));
    const futureLabel = editor.bus.entries.at(-1).label;
    const moveEntryIndex = afterRedoMove.cursor;
    editor.bus.jump(moveEntryIndex);
    move();
    const afterJumpEdit = {
      cursor: editor.bus.cursor,
      length: editor.bus.entries.length,
      labels: editor.bus.entries.map(entry => entry.label),
    };

    editor.bus.undo();
    move();
    const afterUndoEdit = {
      cursor: editor.bus.cursor,
      length: editor.bus.entries.length,
      labels: editor.bus.entries.map(entry => entry.label),
    };

    return { baseline: cursor, coalescedCursor, afterRedoMove, futureLabel, afterJumpEdit, afterUndoEdit };
  }, seed);

  expect(result.coalescedCursor - result.baseline).toBe(1);
  expect(result.afterRedoMove.cursor - result.baseline).toBe(2);
  expect(result.afterJumpEdit.cursor - result.baseline).toBe(3);
  expect(result.afterJumpEdit.labels).not.toContain(result.futureLabel);
  expect(result.afterUndoEdit.cursor - result.baseline).toBe(3);
  expect(result.afterUndoEdit.length).toBe(result.afterUndoEdit.cursor + 1);
});
