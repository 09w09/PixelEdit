import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function comparePixelSets(actual, expected) {
  const missing = [...expected].filter(key => !actual.has(key));
  const extra = [...actual].filter(key => !expected.has(key));
  return { missing, extra };
}

async function renderTransformedRectangle(page, { rotation, x, y, w, h }) {
  return page.evaluate(({ rotation, x, y, w, h }) => {
    const editor = window.PixelEditorTest.editor;
    const PE = window.PixelEditor;
    const M = PE.model;
    const C = PE.commands;
    const R = PE.renderer;
    const T = PE.transformModel;
    const P = PE.pixelStrokeRuntime;

    editor.newProject({ force: true });
    const pageModel = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: pageModel.id,
      x,
      y,
      w: 80,
      h: 60,
      fill: { mode: 'transparent', color: 1 },
      stroke: { width: 1, color: 1, style: 'solid' },
      transform: { rotation: 0, flipX: false, flipY: false },
    });
    editor.exec(new C.AddNodesCommand([node], pageModel.id));
    editor.state.selection.replace([node.id]);

    node.transform = T.normalizeTransform({ rotation, flipX: false, flipY: false });
    editor.exec(new C.UpdateNodesCommand([node.id], { w, h }, pageModel.id, '调整大小'));

    const current = M.nodeById(editor.activePage(), node.id);
    const sourceBounds = { x: current.x, y: current.y, w: current.w, h: current.h };
    const matrix = T.nodeTransformMatrix(current, sourceBounds);
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
      expected: [...expected],
      actual: [...actual],
      node: {
        x: current.x,
        y: current.y,
        w: current.w,
        h: current.h,
        rotation: current.transform.rotation,
      },
    };
  }, { rotation, x, y, w, h });
}

test('90-degree rotated rectangle keeps all four 1px stroke edges after size adjustment', async ({ page }) => {
  await openEditor(page);
  const result = await renderTransformedRectangle(page, {
    rotation: -90,
    x: 94,
    y: 68,
    w: 248,
    h: 180,
  });

  const expected = new Set(result.expected);
  const actual = new Set(result.actual);
  const diff = comparePixelSets(actual, expected);
  expect(diff.missing, `missing transformed stroke pixels: ${diff.missing.slice(0, 20).join(' ')}`).toEqual([]);
  expect(diff.extra, `unexpected thick stroke pixels: ${diff.extra.slice(0, 20).join(' ')}`).toEqual([]);
});

test('45-degree rotated rectangle remains a single-pixel vector perimeter after size adjustment', async ({ page }) => {
  await openEditor(page);
  const result = await renderTransformedRectangle(page, {
    rotation: -45,
    x: 98,
    y: 60,
    w: 223,
    h: 222,
  });

  const expected = new Set(result.expected);
  const actual = new Set(result.actual);
  const diff = comparePixelSets(actual, expected);
  expect(diff.missing, `missing transformed stroke pixels: ${diff.missing.slice(0, 20).join(' ')}`).toEqual([]);
  expect(diff.extra, `unexpected thick stroke pixels: ${diff.extra.slice(0, 20).join(' ')}`).toEqual([]);
});
