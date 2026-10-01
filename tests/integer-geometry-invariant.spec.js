import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function expectNoViolations(result, label = 'geometry') {
  expect(result, label).toEqual([]);
}

async function collectViolations(page) {
  return page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const violations = [];
    const boxTypes = new Set(['rectangle', 'circle', 'text', 'image', 'raster']);
    for (const node of editor.activePage().nodes) {
      const add = (key, value) => {
        if (!Number.isInteger(value)) violations.push(`${node.type}:${node.id}:${key}=${value}`);
      };
      if (boxTypes.has(node.type)) {
        add('x', node.x); add('y', node.y); add('w', node.w); add('h', node.h);
      } else if (node.type === 'line') {
        add('x1', node.x1); add('y1', node.y1); add('x2', node.x2); add('y2', node.y2);
      } else if (node.type === 'polygon') {
        (node.points || []).forEach((point, index) => {
          add(`points[${index}].x`, point.x);
          add(`points[${index}].y`, point.y);
        });
      }
    }
    return violations;
  });
}

async function draw(page, tool, start, end) {
  return page.evaluate(({ tool, start, end }) => {
    const editor = window.PixelEditorTest.editor;
    const before = new Set(editor.activePage().nodes.map(node => node.id));
    editor.state.selection.clear();
    editor.setTool(tool);
    editor.beginLiveDraw(tool, start);
    const gesture = editor.customGesture;
    if (!gesture) throw new Error(`failed to begin ${tool}`);
    editor.updateLiveDraw(gesture, end);
    editor.customGesture = null;
    editor.commitLiveDraw(gesture);
    return editor.activePage().nodes.find(node => !before.has(node.id))?.id || null;
  }, { tool, start, end });
}

test('all creation tools commit editable source geometry to integer pixels', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => window.PixelEditorTest.editor.newProject({ force: true }));

  await draw(page, 'line', { x: 11.25, y: 13.75 }, { x: 47.6, y: 29.4 });
  await draw(page, 'rectangle', { x: 55.4, y: 41.6 }, { x: 93.7, y: 76.2 });
  await draw(page, 'circle', { x: 104.2, y: 38.8 }, { x: 142.9, y: 78.1 });
  await draw(page, 'text', { x: 155.3, y: 44.7 }, { x: 226.6, y: 72.4 });

  expectNoViolations(await collectViolations(page), 'creation tools');
});

test('property edits, pointer-style moves, duplicate and paste never persist fractional geometry', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', { parentId: p.id, x: 10, y: 20, w: 31, h: 19 });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.renderAll();
    return node.id;
  });

  for (const [selector, value] of [
    ['#propX', '18.7'], ['#propY', '22.2'], ['#propW', '37.8'], ['#propH', '24.4'],
  ]) {
    const input = page.locator(selector);
    await input.fill(value);
    await input.dispatchEvent('change');
  }

  await page.evaluate(id => {
    const editor = window.PixelEditorTest.editor;
    const C = window.PixelEditor.commands;
    const p = editor.activePage();
    editor.exec(new C.MoveSelectionCommand([id], 3.6, -2.4, p.id));
    editor.state.selection.replace([id]);
    editor.duplicateSelection?.();
    editor.copySelection();
    editor.pasteClipboard();
  }, result);

  expectNoViolations(await collectViolations(page), 'properties/move/clipboard');
});

test('rotated resize, line endpoint and polygon vertex edits stay on the integer grid during live editing and after commit', async ({ page }) => {
  await openEditor(page);
  const snapshots = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const PE = window.PixelEditor;
    const M = PE.model;
    const C = PE.commands;
    const G = PE.selectionGeometry;
    const S = PE.selectionOverlay;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const rectangle = M.createNode('rectangle', {
      parentId: p.id, x: 70, y: 60, w: 43, h: 27,
      transform: { rotation: 37, flipX: true, flipY: false },
    });
    const line = M.createNode('line', {
      parentId: p.id, x1: 20, y1: 120, x2: 61, y2: 137,
      transform: { rotation: 29, flipX: false, flipY: false },
    });
    const polygon = M.createNode('polygon', {
      parentId: p.id,
      points: [{ x: 140, y: 120 }, { x: 181, y: 127 }, { x: 158, y: 164 }],
      transform: { rotation: -33, flipX: false, flipY: true },
    });
    editor.exec(new C.AddNodesCommand([rectangle, line, polygon], p.id));

    const inspect = label => {
      const out = [];
      for (const node of p.nodes) {
        const check = (key, value) => { if (!Number.isInteger(value)) out.push(`${label}:${node.type}:${key}=${value}`); };
        if (['rectangle', 'circle', 'text', 'image', 'raster'].includes(node.type)) {
          check('x', node.x); check('y', node.y); check('w', node.w); check('h', node.h);
        } else if (node.type === 'line') {
          check('x1', node.x1); check('y1', node.y1); check('x2', node.x2); check('y2', node.y2);
        } else if (node.type === 'polygon') {
          node.points.forEach((point, index) => { check(`p${index}.x`, point.x); check(`p${index}.y`, point.y); });
        }
      }
      return out;
    };

    const output = [];

    editor.state.selection.replace([rectangle.id]);
    editor.renderOverlay();
    let pivot = S.sourcePivotBounds(editor, rectangle);
    let geometry = G.selectionGeometry(rectangle, pivot);
    let handle = editor.selectionHandleAt(geometry.handles.se);
    editor.beginLiveHandle(handle, geometry.handles.se);
    let gesture = editor.customGesture;
    editor.updateLiveResize(gesture, { x: geometry.handles.se.x + 17.37, y: geometry.handles.se.y + 9.61 });
    output.push(...inspect('resize-live'));
    editor.commitLiveHandle(gesture);
    editor.customGesture = null;
    output.push(...inspect('resize-commit'));

    editor.state.selection.replace([line.id]);
    editor.renderOverlay();
    pivot = S.sourcePivotBounds(editor, line);
    geometry = G.selectionGeometry(line, pivot);
    handle = editor.selectionHandleAt(geometry.controlPoints[0]);
    editor.beginLiveHandle(handle, geometry.controlPoints[0]);
    gesture = editor.customGesture;
    editor.updateLivePoint(gesture, { x: geometry.controlPoints[0].x + 5.49, y: geometry.controlPoints[0].y - 3.51 });
    output.push(...inspect('line-live'));
    editor.commitLiveHandle(gesture);
    editor.customGesture = null;
    output.push(...inspect('line-commit'));

    editor.state.selection.replace([polygon.id]);
    editor.renderOverlay();
    pivot = S.sourcePivotBounds(editor, polygon);
    geometry = G.selectionGeometry(polygon, pivot);
    handle = editor.selectionHandleAt(geometry.controlPoints[1]);
    editor.beginLiveHandle(handle, geometry.controlPoints[1]);
    gesture = editor.customGesture;
    editor.updateLivePoint(gesture, { x: geometry.controlPoints[1].x + 6.71, y: geometry.controlPoints[1].y + 4.26 });
    output.push(...inspect('polygon-live'));
    editor.commitLiveHandle(gesture);
    editor.customGesture = null;
    output.push(...inspect('polygon-commit'));

    return output;
  });

  expectNoViolations(snapshots, 'live transform editing');
});

test('visual align and distribute commands never introduce fractional source positions', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const nodes = [
      M.createNode('rectangle', { parentId: p.id, x: 20, y: 20, w: 31, h: 11, transform: { rotation: 37 } }),
      M.createNode('rectangle', { parentId: p.id, x: 103, y: 43, w: 20, h: 20, transform: { rotation: -19 } }),
      M.createNode('rectangle', { parentId: p.id, x: 181, y: 67, w: 13, h: 29, transform: { rotation: 45 } }),
      M.createNode('rectangle', { parentId: p.id, x: 260, y: 92, w: 17, h: 23, transform: { rotation: 11 } }),
    ];
    editor.exec(new C.AddNodesCommand(nodes, p.id));
    editor.state.selection.replace(nodes.map(node => node.id));

    const snapshots = [];
    const snapshot = operation => snapshots.push({
      operation,
      geometry: nodes.map(node => {
        const current = M.nodeById(p, node.id);
        return { id: current.id, x: current.x, y: current.y, w: current.w, h: current.h };
      }),
    });

    editor.align('top'); snapshot('align-top');
    editor.align('hcenter'); snapshot('align-hcenter');
    editor.distribute('horizontal'); snapshot('distribute-horizontal');
    editor.distribute('vertical'); snapshot('distribute-vertical');
    return snapshots;
  });

  const violations = [];
  for (const snapshot of result) {
    for (const node of snapshot.geometry) {
      for (const key of ['x', 'y', 'w', 'h']) {
        if (!Number.isInteger(node[key])) violations.push(`${snapshot.operation}:${node.id}:${key}=${node[key]}`);
      }
    }
  }
  expectNoViolations(violations, 'align/distribute');
});

test('command mutation boundary canonicalizes fractional box, line and polygon geometry patches', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const box = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 20, h: 20 });
    const line = M.createNode('line', { parentId: p.id, x1: 40, y1: 10, x2: 60, y2: 20 });
    const polygon = M.createNode('polygon', {
      parentId: p.id,
      points: [{ x: 80, y: 10 }, { x: 100, y: 20 }, { x: 90, y: 40 }],
    });
    editor.exec(new C.AddNodesCommand([box, line, polygon], p.id));
    editor.exec(new C.UpdateNodesCommand([box.id], { x: 10.49, y: 11.51, w: 20.49, h: 21.51 }, p.id));
    editor.exec(new C.UpdateNodesCommand([line.id], { x1: 40.49, y1: 10.51, x2: 61.6, y2: 20.4 }, p.id));
    editor.exec(new C.UpdateNodesCommand([polygon.id], {
      points: [{ x: 80.49, y: 10.51 }, { x: 100.6, y: 20.4 }, { x: 90.2, y: 40.8 }],
    }, p.id));
    return {
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
      line: { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 },
      points: structuredClone(polygon.points),
    };
  });

  for (const value of Object.values(result.box)) expect(Number.isInteger(value)).toBe(true);
  for (const value of Object.values(result.line)) expect(Number.isInteger(value)).toBe(true);
  for (const point of result.points) {
    expect(Number.isInteger(point.x)).toBe(true);
    expect(Number.isInteger(point.y)).toBe(true);
  }
});
