import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function expectIntegerRecord(record) {
  for (const value of Object.values(record)) expect(Number.isInteger(value)).toBe(true);
}

test('UpdateNodesCommand canonicalizes fractional geometry in the actual page model', async ({ page }) => {
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

    const currentBox = M.nodeById(p, box.id);
    const currentLine = M.nodeById(p, line.id);
    const currentPolygon = M.nodeById(p, polygon.id);
    return {
      box: { x: currentBox.x, y: currentBox.y, w: currentBox.w, h: currentBox.h },
      line: { x1: currentLine.x1, y1: currentLine.y1, x2: currentLine.x2, y2: currentLine.y2 },
      points: structuredClone(currentPolygon.points),
    };
  });

  expectIntegerRecord(result.box);
  expectIntegerRecord(result.line);
  result.points.forEach(expectIntegerRecord);
});

test('generic commands are normalized before their history snapshot is committed', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const box = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 20, h: 20 });
    editor.exec(new C.AddNodesCommand([box], p.id));
    const beforeCursor = editor.bus.cursor;
    editor.exec({
      label: 'custom fractional mutation',
      execute(state) {
        const page = M.pageById(state.project, p.id);
        const node = M.nodeById(page, box.id);
        node.x = 12.25;
        node.y = 15.75;
        node.w = 23.4;
        node.h = 18.6;
        node.transform = { ...node.transform, translateX: 2.5, translateY: -3.5 };
        return true;
      },
    });
    const current = M.nodeById(p, box.id);
    const after = {
      x: current.x, y: current.y, w: current.w, h: current.h,
      translateX: current.transform.translateX || 0,
      translateY: current.transform.translateY || 0,
    };
    const afterCursor = editor.bus.cursor;
    editor.bus.undo();
    const undoneNode = M.nodeById(editor.activePage(), box.id);
    const undone = { x: undoneNode.x, y: undoneNode.y, w: undoneNode.w, h: undoneNode.h };
    editor.bus.redo();
    const redoneNode = M.nodeById(editor.activePage(), box.id);
    const redone = {
      x: redoneNode.x, y: redoneNode.y, w: redoneNode.w, h: redoneNode.h,
      translateX: redoneNode.transform.translateX || 0,
      translateY: redoneNode.transform.translateY || 0,
    };
    return { beforeCursor, afterCursor, after, undone, redone };
  });

  expect(result.afterCursor - result.beforeCursor).toBe(1);
  expectIntegerRecord(result.after);
  expect(result.undone).toEqual({ x: 10, y: 10, w: 20, h: 20 });
  expect(result.redone).toEqual(result.after);
  expectIntegerRecord(result.redone);
});

test('serializer rejects a corrupted project containing fractional editable geometry', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const P = window.PixelEditor.persistence;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 20, h: 20 });
    editor.exec(new C.AddNodesCommand([node], p.id));
    M.nodeById(p, node.id).x = 10.5;
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
