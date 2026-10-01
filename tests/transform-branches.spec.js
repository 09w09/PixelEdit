import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function parsePoints(value = '') {
  return value.trim().split(/\s+/).filter(Boolean).map(pair => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
}

function expectPointsClose(actual, expected) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => {
    expect(point.x).toBeCloseTo(expected[index].x, 5);
    expect(point.y).toBeCloseTo(expected[index].y, 5);
  });
}

test('90-degree box selection uses perimeter outline and semantic corner handles', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: p.id, x: 100, y: 100, w: 20, h: 10,
      stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'transparent', color: 1 },
      transform: { rotation: 90, flipX: false, flipY: false },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.renderOverlay();
    const polygon = editor.overlay.querySelector('polygon.selection-box');
    const handles = [...editor.overlay.querySelectorAll('rect.selection-handle')].map(el => ({
      x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
      y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
    }));
    return { points: polygon?.getAttribute('points') || '', handles, rectCount: editor.overlay.querySelectorAll('rect.selection-box').length };
  });
  const points = parsePoints(result.points);
  const outlineExpected = [
    { x: 115, y: 95 }, { x: 115, y: 115 }, { x: 105, y: 115 }, { x: 105, y: 95 },
  ];
  const handlesExpected = [
    { x: 115, y: 95 }, { x: 115, y: 115 }, { x: 105, y: 95 }, { x: 105, y: 115 },
  ];
  expect(result.rectCount).toBe(0);
  expectPointsClose(points, outlineExpected);
  expectPointsClose(result.handles, handlesExpected);
});

test('line and polygon control handles follow their canonical transform', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const T = window.PixelEditor.transformModel;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const cases = [];
    for (const [type, props] of [
      ['line', { x1: 20, y1: 20, x2: 40, y2: 20 }],
      ['polygon', { points: [{ x: 60, y: 20 }, { x: 80, y: 20 }, { x: 70, y: 40 }] }],
    ]) {
      const node = M.createNode(type, {
        parentId: p.id, ...props,
        stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'transparent', color: 1 },
        transform: { rotation: 90, flipX: true, flipY: false },
      });
      editor.exec(new C.AddNodesCommand([node], p.id));
      editor.state.selection.replace([node.id]);
      editor.renderOverlay();
      const base = type === 'line'
        ? { x: Math.min(node.x1, node.x2), y: Math.min(node.y1, node.y2), w: Math.abs(node.x2 - node.x1), h: Math.abs(node.y2 - node.y1) }
        : (() => {
            const xs = node.points.map(q => q.x), ys = node.points.map(q => q.y);
            return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
          })();
      const matrix = T.nodeTransformMatrix(node, base);
      const source = type === 'line' ? [{ x: node.x1, y: node.y1 }, { x: node.x2, y: node.y2 }] : node.points;
      const expected = source.map(point => T.transformPoint(matrix, point));
      const actual = [...editor.overlay.querySelectorAll('rect.selection-handle')].map(el => ({
        x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
        y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
      }));
      cases.push({ type, expected, actual });
    }
    return cases;
  });
  for (const item of result) expectPointsClose(item.actual, item.expected);
});

test('horizontal flip changes raster presentation without mutating source pixels', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const T = window.PixelEditor.tristateRaster;
    const R = window.PixelEditor.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const raster = M.createNode('raster', {
      parentId: p.id, x: 100, y: 50, w: 3, h: 1,
      pixels: Uint8Array.from([T.RASTER_BLACK, T.RASTER_TRANSPARENT, T.RASTER_TRANSPARENT]),
      transform: { rotation: 0, flipX: true, flipY: false },
    });
    p.nodes.push(raster);
    const sourceBefore = [...T.decodeTriStatePixels(raster.raster.data, 3, 1)];
    const fb = R.FramebufferRenderer.renderPage(editor.state.project, p.id, editor.state.assets);
    const sourceAfter = [...T.decodeTriStatePixels(raster.raster.data, 3, 1)];
    return {
      sourceBefore,
      sourceAfter,
      visible: [fb[50 * 400 + 100], fb[50 * 400 + 101], fb[50 * 400 + 102]],
      normalizedFourTurns: window.PixelEditor.transformModel.normalizeRotation(90 * 4),
    };
  });
  expect(result.sourceBefore).toEqual([2, 0, 0]);
  expect(result.sourceAfter).toEqual(result.sourceBefore);
  expect(result.visible).toEqual([0, 0, 1]);
  expect(result.normalizedFourTurns).toBe(0);
});

test('transformed bounds remain outside canvas while rendering clips and properties stay editable', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const R = window.PixelEditor.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: p.id, x: -8, y: -6, w: 20, h: 10,
      stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'solid', color: 1 },
      transform: { rotation: 45, flipX: false, flipY: false },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    const bounds = R.FramebufferRenderer.visualBounds(node.id, { project: editor.state.project, pageId: p.id, assets: editor.state.assets });
    const fb = R.FramebufferRenderer.renderPage(editor.state.project, p.id, editor.state.assets);
    return {
      bounds,
      length: fb.length,
      binary: fb.every(value => value === 0 || value === 1),
      nodeType: M.nodeById(p, node.id).type,
      hasX: Boolean(document.querySelector('#propX')),
      hasW: Boolean(document.querySelector('#propW')),
      hasStroke: Boolean(document.querySelector('#propStrokeWidth')),
    };
  });
  expect(result.bounds.x).toBeLessThan(0);
  expect(result.bounds.y).toBeLessThan(0);
  expect(result.length).toBe(400 * 300);
  expect(result.binary).toBe(true);
  expect(result.nodeType).toBe('rectangle');
  expect(result.hasX).toBe(true);
  expect(result.hasW).toBe(true);
  expect(result.hasStroke).toBe(true);
});
