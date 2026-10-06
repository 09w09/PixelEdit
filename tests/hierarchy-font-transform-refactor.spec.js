import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('child rendering and hit testing are clipped by every ancestor layer bounds', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const R = window.PixelEditorDebug.services.renderer;
    const I = window.PixelEditorDebug.services.interaction;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const parent = M.createNode('rectangle', {
      parentId: p.id,
      x: 20, y: 20, w: 10, h: 10,
      stroke: { width: 1, color: 1, style: 'solid' },
      fill: { mode: 'transparent', color: 1 },
    });
    const child = M.createNode('rectangle', {
      parentId: parent.id,
      x: 25, y: 25, w: 10, h: 10,
      stroke: { width: 1, color: 1, style: 'solid' },
      fill: { mode: 'solid', color: 1 },
    });
    const grandchild = M.createNode('rectangle', {
      parentId: child.id,
      x: 28, y: 28, w: 10, h: 10,
      stroke: { width: 1, color: 1, style: 'solid' },
      fill: { mode: 'solid', color: 1 },
    });
    p.nodes.push(parent, child, grandchild);

    const fb = R.FramebufferRenderer.renderPage(editor.state.project, p.id, editor.state.assets);
    const hit = new I.HitTest(editor.state.project, p.id, editor.state.assets);
    const inside = hit.topmostAt(28, 28);
    const outside = hit.topmostAt(32, 32);
    return {
      insidePixel: fb[28 * 400 + 28],
      outsidePixel: fb[32 * 400 + 32],
      insideHit: inside?.id || null,
      outsideHit: outside?.id || null,
      grandchildId: grandchild.id,
    };
  });

  expect(result.insidePixel).toBe(1);
  expect(result.outsidePixel).toBe(0);
  expect(result.insideHit).toBe(result.grandchildId);
  expect(result.outsideHit).toBeNull();
});

test('font import and current-font removal live in text tool options, not element properties', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    editor.state.project.fonts.push({
      name: 'Test Imported.ttf',
      family: 'Imported_Test',
      fixedSize: null,
      assetId: 'font-test',
      sha256: 'test-font-sha',
    });
    editor.setToolDefault('text', 'fontFamily', 'Imported_Test');
    editor.setTool('text');

    const text = M.createNode('text', {
      parentId: p.id,
      x: 10, y: 10, w: 80, h: 30,
      text: 'abc',
      fontFamily: 'Imported_Test',
      fontSize: 16,
    });
    editor.exec(new C.AddNodesCommand([text], p.id));
    editor.state.selection.replace([text.id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    editor.toolOptionsBar.render();

    return {
      toolImport: Boolean(document.querySelector('#toolOptionsBar #importFontBtn')),
      toolRemove: Boolean(document.querySelector('#toolOptionsBar #removeFontBtn')),
      propertyImport: Boolean(document.querySelector('#properties #importFontBtn')),
      propertyRemove: Boolean(document.querySelector('#properties #removeFontBtn')),
    };
  });

  expect(result).toEqual({
    toolImport: true,
    toolRemove: true,
    propertyImport: false,
    propertyRemove: false,
  });
});

test('group rotation keeps source geometry immutable and stores placement only in transform state', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const center = bounds => ({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const R = window.PixelEditorDebug.services.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const a = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 10, h: 6 });
    const b = M.createNode('rectangle', { parentId: p.id, x: 32, y: 18, w: 8, h: 12 });
    editor.exec(new C.AddNodesCommand([a, b], p.id));
    editor.state.selection.replace([a.id, b.id]);
    const sourceBefore = [a, b].map(node => ({ id: node.id, x: node.x, y: node.y, w: node.w, h: node.h }));
    const beforeCenters = [a, b].map(node => center(R.FramebufferRenderer.visualBounds(node.id, {
      project: editor.state.project, pageId: p.id, assets: editor.state.assets,
    })));

    editor.runSelectionTransform('rotate-cw-90');

    const after = [a.id, b.id].map(id => {
      const node = M.nodeById(p, id);
      return {
        source: { id: node.id, x: node.x, y: node.y, w: node.w, h: node.h },
        transform: structuredClone(node.transform),
        center: center(R.FramebufferRenderer.visualBounds(id, {
          project: editor.state.project, pageId: p.id, assets: editor.state.assets,
        })),
      };
    });
    return { sourceBefore, beforeCenters, after };
  });

  expect(result.after.map(item => item.source)).toEqual(result.sourceBefore);
  expect(result.after.some((item, index) =>
    Math.abs(item.center.x - result.beforeCenters[index].x) > 1e-6 ||
    Math.abs(item.center.y - result.beforeCenters[index].y) > 1e-6
  )).toBe(true);
  for (const item of result.after) {
    expect(item.transform.rotation).toBe(90);
    expect(Number.isFinite(item.transform.translateX || 0)).toBe(true);
    expect(Number.isFinite(item.transform.translateY || 0)).toBe(true);
  }
});

test('four quarter turns return exactly to canonical identity without source-geometry drift', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const R = window.PixelEditorDebug.services.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const nodes = [
      M.createNode('rectangle', { parentId: p.id, x: 11, y: 13, w: 9, h: 5 }),
      M.createNode('circle', { parentId: p.id, x: 37, y: 24, w: 7, h: 11 }),
    ];
    editor.exec(new C.AddNodesCommand(nodes, p.id));
    editor.state.selection.replace(nodes.map(node => node.id));
    const sourceBefore = nodes.map(node => ({ id: node.id, x: node.x, y: node.y, w: node.w, h: node.h }));
    const boundsBefore = nodes.map(node => R.FramebufferRenderer.visualBounds(node.id, {
      project: editor.state.project, pageId: p.id, assets: editor.state.assets,
    }));

    for (let i = 0; i < 4; i += 1) editor.runSelectionTransform('rotate-cw-90');

    return {
      sourceBefore,
      sourceAfter: nodes.map(({ id }) => {
        const node = M.nodeById(p, id);
        return { id: node.id, x: node.x, y: node.y, w: node.w, h: node.h };
      }),
      transforms: nodes.map(({ id }) => structuredClone(M.nodeById(p, id).transform)),
      boundsBefore,
      boundsAfter: nodes.map(({ id }) => R.FramebufferRenderer.visualBounds(id, {
        project: editor.state.project, pageId: p.id, assets: editor.state.assets,
      })),
    };
  });

  expect(result.sourceAfter).toEqual(result.sourceBefore);
  expect(result.transforms).toEqual([
    { rotation: 0, flipX: false, flipY: false },
    { rotation: 0, flipX: false, flipY: false },
  ]);
  result.boundsAfter.forEach((bounds, index) => {
    expect(bounds.x).toBeCloseTo(result.boundsBefore[index].x, 8);
    expect(bounds.y).toBeCloseTo(result.boundsBefore[index].y, 8);
    expect(bounds.w).toBeCloseTo(result.boundsBefore[index].w, 8);
    expect(bounds.h).toBeCloseTo(result.boundsBefore[index].h, 8);
  });
});

test('selection overlay follows composed transforms without rewriting source control points', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const poly = M.createNode('polygon', {
      parentId: p.id,
      points: [{ x: 40, y: 40 }, { x: 60, y: 42 }, { x: 52, y: 60 }],
      stroke: { width: 1, color: 1, style: 'solid' },
      fill: { mode: 'transparent', color: 1 },
    });
    const rect = M.createNode('rectangle', { parentId: p.id, x: 90, y: 50, w: 12, h: 8 });
    editor.exec(new C.AddNodesCommand([poly, rect], p.id));
    editor.state.selection.replace([poly.id, rect.id]);
    const originalPoints = structuredClone(poly.points);
    editor.runSelectionTransform('flip-horizontal');
    editor.runSelectionTransform('rotate-angle', 37);
    editor.state.selection.replace([poly.id]);
    editor.renderOverlay();
    const handles = [...editor.overlay.querySelectorAll('rect.selection-handle')].map(el => ({
      x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
      y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
    }));
    const current = M.nodeById(p, poly.id);
    const pivotBounds = window.PixelEditorDebug.services.selectionOverlay.sourcePivotBounds(editor, current);
    const expected = window.PixelEditorDebug.services.selectionGeometry.selectionGeometry(current, pivotBounds).controlPoints;
    return {
      originalPoints,
      currentPoints: structuredClone(current.points),
      handles,
      expected,
    };
  });

  expect(result.currentPoints).toEqual(result.originalPoints);
  expect(result.handles).toHaveLength(result.expected.length);
  result.handles.forEach((point, index) => {
    expect(point.x).toBeCloseTo(result.expected[index].x, 6);
    expect(point.y).toBeCloseTo(result.expected[index].y, 6);
  });
});
