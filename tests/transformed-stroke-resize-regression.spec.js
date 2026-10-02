import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function comparePixelSets(actual, expected) {
  return {
    missing: [...expected].filter(key => !actual.has(key)),
    extra: [...actual].filter(key => !expected.has(key)),
  };
}

async function exerciseRectangle(page, finalRotation) {
  return page.evaluate(finalRotation => {
    const editor = window.PixelEditorTest.editor;
    const PE = window.PixelEditor;
    const M = PE.model;
    const C = PE.commands;
    const R = PE.renderer;
    const T = PE.transformModel;
    const G = PE.selectionGeometry;
    const S = PE.selectionOverlay;
    const P = PE.pixelStrokeRuntime;

    editor.newProject({ force: true });
    editor.setZoom(3);
    const pageModel = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: pageModel.id,
      x: 105,
      y: 78,
      w: 128,
      h: 92,
      fill: { mode: 'transparent', color: 1 },
      stroke: { width: 1, color: 1, style: 'solid' },
    });
    editor.exec(new C.AddNodesCommand([node], pageModel.id));
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;
    editor.setTool('pointer');

    const resizeCorner = (corner, deltaX, deltaY) => {
      const current = M.nodeById(editor.activePage(), node.id);
      const pivot = S.sourcePivotBounds(editor, current);
      const geometry = G.selectionGeometry(current, pivot);
      const start = geometry.handles[corner];
      const b = geometry.sourceBounds;
      const sourceTarget = {
        x: corner.includes('w') ? b.x + deltaX : b.x + b.w + deltaX,
        y: corner.includes('n') ? b.y + deltaY : b.y + b.h + deltaY,
      };
      const target = G.localToWorld(current, sourceTarget, pivot);
      const handle = editor.selectionHandleAt(start);
      editor.beginLiveHandle(handle, start);
      const gesture = editor.customGesture;
      editor.updateLiveResize(gesture, target);
      const committed = editor.commitLiveHandle(gesture);
      editor.customGesture = null;
      editor.renderAll();
      return committed;
    };

    editor.runSelectionTransform('rotate-ccw-90');
    const firstResize = resizeCorner('se', 74, 52);
    editor.exec(new C.MoveSelectionCommand([node.id], 13, -9, pageModel.id));
    editor.renderAll();
    const secondResize = resizeCorner('nw', -31, -24);

    if (finalRotation === -45) {
      editor.runSelectionTransform('rotate-angle', 45);
      editor.exec(new C.MoveSelectionCommand([node.id], -7, 11, pageModel.id));
      editor.renderAll();
      resizeCorner('e', 37, 0);
      resizeCorner('s', 0, 28);
    }

    const current = M.nodeById(editor.activePage(), node.id);
    const pivot = S.sourcePivotBounds(editor, current);
    const matrix = T.nodeTransformMatrix(current, pivot);
    const sourceCorners = [
      { x: current.x, y: current.y },
      { x: current.x + current.w - 1, y: current.y },
      { x: current.x + current.w - 1, y: current.y + current.h - 1 },
      { x: current.x, y: current.y + current.h - 1 },
    ];
    const corners = sourceCorners.map(point => T.transformPoint(matrix, point));
    const expected = new Set();
    for (let index = 0; index < corners.length; index += 1) {
      const a = corners[index];
      const b = corners[(index + 1) % corners.length];
      P.rasterThinLine(a.x, a.y, b.x, b.y, (px, py) => {
        if (px >= 0 && py >= 0 && px < 400 && py < 300) expected.add(`${px},${py}`);
      });
    }

    const fb = R.FramebufferRenderer.renderPage(editor.state.project, pageModel.id, editor.state.assets);
    const actual = new Set();
    for (let py = 0; py < 300; py += 1) {
      for (let px = 0; px < 400; px += 1) {
        if (fb[py * 400 + px] === 1) actual.add(`${px},${py}`);
      }
    }

    return {
      firstResize,
      secondResize,
      expected: [...expected],
      actual: [...actual],
      node: {
        x: current.x,
        y: current.y,
        w: current.w,
        h: current.h,
        transform: structuredClone(current.transform),
      },
      history: editor.bus.entries.map(entry => entry.label),
    };
  }, finalRotation);
}

function expectExactOnePixelPerimeter(result) {
  expect(result.firstResize).toBe(true);
  expect(result.secondResize).toBe(true);
  const expected = new Set(result.expected);
  const actual = new Set(result.actual);
  const diff = comparePixelSets(actual, expected);
  expect(diff.missing, `missing transformed stroke pixels: ${diff.missing.slice(0, 30).join(' ')}`).toEqual([]);
  expect(diff.extra, `unexpected thick stroke pixels: ${diff.extra.slice(0, 30).join(' ')}`).toEqual([]);
}

test('rotate -90, resize, move, resize keeps the rectangle stroke complete and 1px', async ({ page }) => {
  await openEditor(page);
  const result = await exerciseRectangle(page, -90);
  expect(result.history).toEqual(expect.arrayContaining(['逆时针旋转 90°', '调整大小', '移动选择']));
  expect(result.node.transform.rotation).toBe(-90);
  expectExactOnePixelPerimeter(result);
});

test('continued -45 rotation and edge resizes keep the rectangle stroke complete and 1px', async ({ page }) => {
  await openEditor(page);
  const result = await exerciseRectangle(page, -45);
  expect(result.node.transform.rotation).toBe(-45);
  expectExactOnePixelPerimeter(result);
});
