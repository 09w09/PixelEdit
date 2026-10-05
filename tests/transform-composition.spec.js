import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('inverse rotation and flip sequences return to identity without mutating source geometry', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const R = window.PixelEditorDebug.services.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const nodes = [
      M.createNode('rectangle', { parentId: p.id, x: 21, y: 17, w: 13, h: 7 }),
      M.createNode('line', {
        parentId: p.id, x1: 55, y1: 19, x2: 72, y2: 31,
        stroke: { width: 3, color: 1, style: 'solid' },
      }),
      M.createNode('polygon', {
        parentId: p.id,
        points: [{ x: 90, y: 18 }, { x: 111, y: 23 }, { x: 104, y: 39 }, { x: 94, y: 34 }],
        stroke: { width: 1, color: 1, style: 'solid' },
        fill: { mode: 'transparent', color: 1 },
      }),
    ];
    editor.exec(new C.AddNodesCommand(nodes, p.id));

    const sourceOf = node => node.type === 'line'
      ? { type: node.type, x1: node.x1, y1: node.y1, x2: node.x2, y2: node.y2 }
      : node.type === 'polygon'
        ? { type: node.type, points: structuredClone(node.points) }
        : { type: node.type, x: node.x, y: node.y, w: node.w, h: node.h };
    const context = () => ({ project: editor.state.project, pageId: p.id, assets: editor.state.assets });
    const before = nodes.map(node => ({
      id: node.id,
      source: sourceOf(node),
      bounds: R.FramebufferRenderer.visualBounds(node.id, context()),
    }));

    const after = [];
    for (const original of nodes) {
      editor.state.selection.replace([original.id]);
      editor.runSelectionTransform('rotate-angle', 37);
      editor.runSelectionTransform('flip-horizontal');
      editor.runSelectionTransform('flip-horizontal');
      editor.runSelectionTransform('rotate-angle', -37);
      const current = M.nodeById(p, original.id);
      after.push({
        id: current.id,
        source: sourceOf(current),
        transform: structuredClone(current.transform),
        bounds: R.FramebufferRenderer.visualBounds(current.id, context()),
      });
    }
    return { before, after };
  });

  for (let i = 0; i < result.before.length; i += 1) {
    expect(result.after[i].source).toEqual(result.before[i].source);
    expect(result.after[i].transform).toEqual({ rotation: 0, flipX: false, flipY: false });
    expect(result.after[i].bounds.x).toBeCloseTo(result.before[i].bounds.x, 8);
    expect(result.after[i].bounds.y).toBeCloseTo(result.before[i].bounds.y, 8);
    expect(result.after[i].bounds.w).toBeCloseTo(result.before[i].bounds.w, 8);
    expect(result.after[i].bounds.h).toBeCloseTo(result.before[i].bounds.h, 8);
  }
});

test('world-space flip composition is deterministic after arbitrary rotation', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', { parentId: p.id, x: 40, y: 50, w: 17, h: 9 });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    const source = { x: node.x, y: node.y, w: node.w, h: node.h };

    editor.runSelectionTransform('rotate-angle', 30);
    const afterRotate = structuredClone(M.nodeById(p, node.id).transform);
    editor.runSelectionTransform('flip-horizontal');
    const afterFirstFlip = structuredClone(M.nodeById(p, node.id).transform);
    editor.runSelectionTransform('flip-horizontal');
    const afterSecondFlip = structuredClone(M.nodeById(p, node.id).transform);
    const current = M.nodeById(p, node.id);

    return {
      source,
      sourceAfter: { x: current.x, y: current.y, w: current.w, h: current.h },
      afterRotate,
      afterFirstFlip,
      afterSecondFlip,
    };
  });

  expect(result.sourceAfter).toEqual(result.source);
  expect(result.afterRotate).toEqual({ rotation: 30, flipX: false, flipY: false });
  expect(result.afterFirstFlip).toEqual({ rotation: -30, flipX: true, flipY: false });
  expect(result.afterSecondFlip).toEqual({ rotation: 30, flipX: false, flipY: false });
});

test('undo and redo restore composed transform exactly while source geometry remains untouched', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const R = window.PixelEditorDebug.services.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const pageId = p.id;
    const a = M.createNode('rectangle', { parentId: pageId, x: 14, y: 16, w: 11, h: 7 });
    const b = M.createNode('rectangle', { parentId: pageId, x: 41, y: 27, w: 8, h: 14 });
    editor.exec(new C.AddNodesCommand([a, b], pageId));
    editor.state.selection.replace([a.id, b.id]);
    const source = [a, b].map(node => ({ id: node.id, x: node.x, y: node.y, w: node.w, h: node.h }));
    editor.runSelectionTransform('rotate-angle', 27);
    const transformed = [a.id, b.id].map(id => ({
      transform: structuredClone(M.nodeById(editor.activePage(), id).transform),
      bounds: R.FramebufferRenderer.visualBounds(id, { project: editor.state.project, pageId, assets: editor.state.assets }),
    }));

    editor.bus.undo();
    const undone = [a.id, b.id].map(id => {
      const node = M.nodeById(editor.activePage(), id);
      return { source: { id: node.id, x: node.x, y: node.y, w: node.w, h: node.h }, transform: structuredClone(node.transform) };
    });
    editor.bus.redo();
    const redone = [a.id, b.id].map(id => ({
      transform: structuredClone(M.nodeById(editor.activePage(), id).transform),
      bounds: R.FramebufferRenderer.visualBounds(id, { project: editor.state.project, pageId, assets: editor.state.assets }),
    }));
    return { source, transformed, undone, redone };
  });

  expect(result.undone.map(item => item.source)).toEqual(result.source);
  result.undone.forEach(item => expect(item.transform).toEqual({ rotation: 0, flipX: false, flipY: false }));
  expect(result.redone).toEqual(result.transformed);
});
