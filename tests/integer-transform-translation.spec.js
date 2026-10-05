import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function expectIntegerTranslation(transform) {
  expect(Number.isInteger(transform?.translateX ?? 0)).toBe(true);
  expect(Number.isInteger(transform?.translateY ?? 0)).toBe(true);
}

test('node creation and UpdateNodesCommand canonicalize transform translation to integer pixels', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: p.id,
      x: 20, y: 20, w: 31, h: 17,
      transform: { rotation: 23, flipX: false, flipY: false, translateX: 3.6, translateY: -2.4 },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    const current = M.nodeById(p, node.id);
    const afterCreate = structuredClone(current.transform);
    editor.exec(new C.UpdateNodesCommand([node.id], n => ({
      transform: { ...n.transform, translateX: 8.49, translateY: -9.51 },
    }), p.id));
    return { afterCreate, afterUpdate: structuredClone(M.nodeById(p, node.id).transform) };
  });

  expectIntegerTranslation(result.afterCreate);
  expectIntegerTranslation(result.afterUpdate);
});

test('arbitrary multi-selection rotate and flip keep transform translation on integer pixels', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const nodes = [
      M.createNode('rectangle', { parentId: p.id, x: 17, y: 19, w: 31, h: 13 }),
      M.createNode('rectangle', { parentId: p.id, x: 84, y: 43, w: 22, h: 29 }),
      M.createNode('circle', { parentId: p.id, x: 151, y: 77, w: 27, h: 21 }),
    ];
    editor.exec(new C.AddNodesCommand(nodes, p.id));
    editor.state.selection.replace(nodes.map(node => node.id));
    const snapshots = [];
    for (const [action, value] of [['rotate-angle', 37], ['flip-horizontal', 0], ['rotate-angle', -19], ['flip-vertical', 0]]) {
      editor.runSelectionTransform(action, value);
      snapshots.push(nodes.map(node => structuredClone(M.nodeById(p, node.id).transform)));
    }
    return snapshots;
  });

  for (const snapshot of result) for (const transform of snapshot) expectIntegerTranslation(transform);
});

test('rotated live resize compensation never introduces fractional transform translation', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const PE = window.PixelEditorDebug.services;
    const M = PE.model;
    const C = PE.commands;
    const G = PE.selectionGeometry;
    const S = PE.selectionOverlay;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: p.id,
      x: 91, y: 73, w: 37, h: 23,
      transform: { rotation: 31, flipX: true, flipY: false, translateX: 7, translateY: -4 },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.renderOverlay();
    const pivot = S.sourcePivotBounds(editor, node);
    const geometry = G.selectionGeometry(node, pivot);
    const handle = editor.selectionHandleAt(geometry.handles.se);
    editor.beginLiveHandle(handle, geometry.handles.se);
    const gesture = editor.customGesture;
    editor.updateLiveResize(gesture, { x: geometry.handles.se.x + 17.37, y: geometry.handles.se.y + 9.61 });
    const live = structuredClone(M.nodeById(p, node.id).transform);
    editor.commitLiveHandle(gesture);
    editor.customGesture = null;
    return { live, committed: structuredClone(M.nodeById(p, node.id).transform) };
  });

  expectIntegerTranslation(result.live);
  expectIntegerTranslation(result.committed);
});

test('serializer rejects fractional transform translation in a corrupted project', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const P = window.PixelEditorDebug.services.persistence;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 20, h: 20 });
    editor.exec(new C.AddNodesCommand([node], p.id));
    M.nodeById(p, node.id).transform.translateX = 0.5;
    try {
      P.ProjectSerializer.serialize(editor.state.project, editor.state.assets);
      return { threw: false, message: '' };
    } catch (error) {
      return { threw: true, message: String(error?.message || error) };
    }
  });

  expect(result.threw).toBe(true);
  expect(result.message).toContain('整数');
});
