import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function expectPointClose(actual, expected, tolerance = 0.500001) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
}

test('rotated box resize keeps the opposite world corner fixed and the dragged handle under the pointer after commit', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const G = window.PixelEditorDebug.services.selectionGeometry;
    const S = window.PixelEditorDebug.services.selectionOverlay;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: p.id,
      x: 100, y: 100, w: 20, h: 10,
      transform: { rotation: 90, flipX: false, flipY: false },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.renderOverlay();

    const centers = () => [...editor.overlay.querySelectorAll('rect.selection-handle')].map(el => ({
      x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
      y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
    }));
    const before = centers();
    const pivot = S.sourcePivotBounds(editor, node);
    const target = G.localToWorld(node, { x: 130, y: 120 }, pivot);
    const handle = editor.selectionHandleAt(before[3]);
    editor.beginLiveHandle(handle, before[3]);
    const gesture = editor.customGesture;
    editor.updateLiveResize(gesture, target);
    const committed = editor.commitLiveHandle(gesture);
    editor.customGesture = null;
    editor.renderOverlay();

    const after = centers();
    const current = M.nodeById(editor.activePage(), node.id);
    return {
      committed,
      fixedBefore: before[0],
      fixedAfter: after[0],
      draggedAfter: after[3],
      target,
      source: { x: current.x, y: current.y, w: current.w, h: current.h },
      transform: structuredClone(current.transform),
    };
  });

  expect(result.committed).toBe(true);
  expect(result.source).toEqual({ x: 100, y: 100, w: 30, h: 20 });
  expectPointClose(result.fixedAfter, result.fixedBefore);
  expectPointClose(result.draggedAfter, result.target);
  expect(result.transform.rotation).toBe(90);
});

test('rotated line endpoint editing maps the pointer back to source coordinates without moving the other endpoint after commit', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const G = window.PixelEditorDebug.services.selectionGeometry;
    const S = window.PixelEditorDebug.services.selectionOverlay;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('line', {
      parentId: p.id,
      x1: 20, y1: 20, x2: 40, y2: 20,
      stroke: { width: 1, color: 1, style: 'solid' },
      transform: { rotation: 90, flipX: false, flipY: false },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.renderOverlay();

    const centers = () => [...editor.overlay.querySelectorAll('rect.selection-handle')].map(el => ({
      x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
      y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
    }));
    const before = centers();
    const pivot = S.sourcePivotBounds(editor, node);
    const target = G.localToWorld(node, { x: 20, y: 15 }, pivot);
    const handle = editor.selectionHandleAt(before[0]);
    editor.beginLiveHandle(handle, before[0]);
    const gesture = editor.customGesture;
    editor.updateLivePoint(gesture, target);
    const committed = editor.commitLiveHandle(gesture);
    editor.customGesture = null;
    editor.renderOverlay();

    const after = centers();
    const current = M.nodeById(editor.activePage(), node.id);
    return {
      committed,
      source: { x1: current.x1, y1: current.y1, x2: current.x2, y2: current.y2 },
      draggedAfter: after[0],
      otherBefore: before[1],
      otherAfter: after[1],
      target,
    };
  });

  expect(result.committed).toBe(true);
  expect(result.source).toEqual({ x1: 20, y1: 15, x2: 40, y2: 20 });
  expectPointClose(result.draggedAfter, result.target);
  expectPointClose(result.otherAfter, result.otherBefore);
});

test('rotated polygon vertex editing keeps untouched vertices stable in world space after commit', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const G = window.PixelEditorDebug.services.selectionGeometry;
    const S = window.PixelEditorDebug.services.selectionOverlay;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('polygon', {
      parentId: p.id,
      points: [{ x: 60, y: 20 }, { x: 80, y: 20 }, { x: 70, y: 40 }],
      stroke: { width: 1, color: 1, style: 'solid' },
      fill: { mode: 'transparent', color: 1 },
      transform: { rotation: 90, flipX: false, flipY: false },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.renderOverlay();

    const centers = () => [...editor.overlay.querySelectorAll('rect.selection-handle')].map(el => ({
      x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
      y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
    }));
    const before = centers();
    const pivot = S.sourcePivotBounds(editor, node);
    const targetLocal = { x: 60, y: 15 };
    const target = G.localToWorld(node, targetLocal, pivot);
    const handle = editor.selectionHandleAt(before[0]);
    editor.beginLiveHandle(handle, before[0]);
    const gesture = editor.customGesture;
    editor.updateLivePoint(gesture, target);
    const committed = editor.commitLiveHandle(gesture);
    editor.customGesture = null;
    editor.renderOverlay();

    const after = centers();
    const current = M.nodeById(editor.activePage(), node.id);
    return { committed, points: structuredClone(current.points), before, after, target, targetLocal };
  });

  expect(result.committed).toBe(true);
  expect(result.points[0]).toEqual(result.targetLocal);
  expectPointClose(result.after[0], result.target);
  expectPointClose(result.after[1], result.before[1]);
  expectPointClose(result.after[2], result.before[2]);
});

test('rotated and mirrored box resize uses the original gesture transform as a stable basis after commit', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const G = window.PixelEditorDebug.services.selectionGeometry;
    const S = window.PixelEditorDebug.services.selectionOverlay;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: p.id,
      x: 90, y: 70, w: 40, h: 20,
      transform: { rotation: 31, flipX: true, flipY: false, translateX: 7, translateY: -4 },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.renderOverlay();

    const centers = () => [...editor.overlay.querySelectorAll('rect.selection-handle')].map(el => ({
      x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
      y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
    }));
    const before = centers();
    const pivot = S.sourcePivotBounds(editor, node);
    const target = G.localToWorld(node, { x: 140, y: 98 }, pivot);
    const handle = editor.selectionHandleAt(before[3]);
    editor.beginLiveHandle(handle, before[3]);
    const gesture = editor.customGesture;
    editor.updateLiveResize(gesture, target);
    const committed = editor.commitLiveHandle(gesture);
    editor.customGesture = null;
    editor.renderOverlay();

    const after = centers();
    const current = M.nodeById(editor.activePage(), node.id);
    return {
      committed,
      fixedBefore: before[0], fixedAfter: after[0], draggedAfter: after[3], target,
      source: { x: current.x, y: current.y, w: current.w, h: current.h },
      orientation: { rotation: current.transform.rotation, flipX: current.transform.flipX, flipY: current.transform.flipY },
    };
  });

  expect(result.committed).toBe(true);
  expect(result.source).toEqual({ x: 90, y: 70, w: 50, h: 28 });
  expect(result.orientation).toEqual({ rotation: 31, flipX: true, flipY: false });
  expectPointClose(result.fixedAfter, result.fixedBefore);
  expectPointClose(result.draggedAfter, result.target);
});
