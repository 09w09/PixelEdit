import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('history renders newest first while data indices remain chronological', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const snapshot = () => [...document.querySelectorAll('#historyDock .history-item')].map(button => ({
      label: button.textContent.trim(),
      index: Number(button.dataset.historyIndex),
      active: button.classList.contains('active'),
    }));
    editor.newProject({ force: true });
    const id = editor.activePage().id;
    const step = (name, label) => editor.exec({
      label,
      execute(state) {
        const target = state.project.pages.find(pageItem => pageItem.id === id);
        if (!target || target.name === name) return false;
        target.name = name;
        return true;
      },
    });
    step('A', '第一步');
    step('B', '第二步');
    step('C', '第三步');
    editor.history.render();
    return {
      cursor: editor.bus.cursor,
      labels: editor.bus.entries.map(entry => entry.label),
      items: snapshot(),
    };
  });

  expect(result.labels).toEqual(['初始状态', '第一步', '第二步', '第三步']);
  expect(result.cursor).toBe(3);
  expect(result.items.map(item => item.index)).toEqual([3, 2, 1, 0]);
  expect(result.items[0].label).toContain('第三步');
  expect(result.items[0].active).toBe(true);
});

test('undo redo and branch history keep reversed display mapped to real cursor', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const snapshot = () => [...document.querySelectorAll('#historyDock .history-item')].map(button => ({
      label: button.textContent.trim(),
      index: Number(button.dataset.historyIndex),
      active: button.classList.contains('active'),
    }));
    editor.newProject({ force: true });
    const id = editor.activePage().id;
    const step = (name, label) => editor.exec({
      label,
      execute(state) {
        const target = state.project.pages.find(pageItem => pageItem.id === id);
        if (!target || target.name === name) return false;
        target.name = name;
        return true;
      },
    });
    step('A', '第一步');
    step('B', '第二步');
    step('C', '第三步');

    editor.bus.undo(); editor.renderAll();
    const afterUndo = { cursor: editor.bus.cursor, items: snapshot() };
    editor.bus.redo(); editor.renderAll();
    const afterRedo = { cursor: editor.bus.cursor, items: snapshot() };
    editor.bus.undo(); editor.renderAll();
    step('BRANCH', '分支步骤');
    const afterBranch = { cursor: editor.bus.cursor, entries: editor.bus.entries.map(entry => entry.label), items: snapshot() };
    return { afterUndo, afterRedo, afterBranch };
  });

  expect(result.afterUndo.cursor).toBe(2);
  expect(result.afterUndo.items).toHaveLength(4);
  expect(result.afterUndo.items.find(item => item.active)?.index).toBe(2);
  expect(result.afterUndo.items.map(item => item.index)).toEqual([3, 2, 1, 0]);
  expect(result.afterRedo.items.find(item => item.active)?.index).toBe(3);
  expect(result.afterBranch.entries).toEqual(['初始状态', '第一步', '第二步', '分支步骤']);
  expect(result.afterBranch.items.map(item => item.index)).toEqual([3, 2, 1, 0]);
  expect(result.afterBranch.items[0].label).toContain('分支步骤');
});

test('clicking a reversed history row jumps to its chronological command index', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const id = editor.activePage().id;
    const step = (name, label) => editor.exec({
      label,
      execute(state) {
        const targetPage = state.project.pages.find(pageItem => pageItem.id === id);
        if (!targetPage || targetPage.name === name) return false;
        targetPage.name = name;
        return true;
      },
    });
    step('A', '第一步');
    step('B', '第二步');
    step('C', '第三步');
    editor.history.render();
    const target = document.querySelector('#historyDock [data-history-index="1"]');
    target?.click();
    return { cursor: editor.bus.cursor, name: editor.activePage().name, active: Number(document.querySelector('#historyDock .history-item.active')?.dataset.historyIndex) };
  });
  expect(result).toEqual({ cursor: 1, name: 'A', active: 1 });
});

test('element stroke and transform edits create history without changing tool defaults', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    editor.setToolDefault('rectangle', 'width', 5);
    editor.setToolDefault('rectangle', 'color', 0);
    editor.setToolDefault('rectangle', 'style', 'dot');
    const p = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: p.id, x: 20, y: 20, w: 30, h: 20,
      stroke: { width: 1, color: 1, style: 'solid' },
      transform: { rotation: 23, flipX: false, flipY: false },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    const before = editor.bus.cursor;

    const width = document.querySelector('#propStrokeWidth');
    width.value = '3'; width.dispatchEvent(new Event('change', { bubbles: true }));
    const afterStroke = editor.bus.cursor;

    const rotation = document.querySelector('#propRotation');
    const flipX = document.querySelector('#propFlipX');
    const flipY = document.querySelector('#propFlipY');
    const controls = {
      rotation: rotation?.value,
      flipX: flipX?.checked,
      flipY: flipY?.checked,
    };
    if (rotation) { rotation.value = '45'; rotation.dispatchEvent(new Event('change', { bubbles: true })); }
    if (flipY) { flipY.checked = true; flipY.dispatchEvent(new Event('change', { bubbles: true })); }
    const afterTransform = editor.bus.cursor;
    const current = M.nodeById(editor.activePage(), node.id);
    const defaultsBeforeToolEdit = structuredClone(editor.getToolDefaults('rectangle'));
    editor.setToolDefault('rectangle', 'width', 7);
    const afterToolDefault = editor.bus.cursor;
    return {
      before, afterStroke, afterTransform, afterToolDefault,
      controls,
      stroke: structuredClone(current.stroke),
      transform: structuredClone(current.transform),
      defaultsBeforeToolEdit,
      defaultsAfterToolEdit: structuredClone(editor.getToolDefaults('rectangle')),
    };
  });

  expect(result.afterStroke - result.before).toBe(1);
  expect(result.controls).toEqual({ rotation: '23', flipX: false, flipY: false });
  expect(result.afterTransform - result.afterStroke).toBe(2);
  expect(result.afterToolDefault).toBe(result.afterTransform);
  expect(result.stroke).toEqual({ width: 3, color: 1, style: 'solid' });
  expect(result.transform).toEqual({ rotation: 45, flipX: false, flipY: true });
  expect(result.defaultsBeforeToolEdit).toEqual({ width: 5, color: 0, style: 'dot', fill: { mode: 'transparent', color: 1 } });
  expect(result.defaultsAfterToolEdit).toEqual({ width: 7, color: 0, style: 'dot', fill: { mode: 'transparent', color: 1 } });
});

test('selection tool buttons refresh enabled state from modifiable selection cardinality', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    editor.setTool('pointer');
    const p = editor.activePage();
    const nodes = [
      M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 10, h: 10 }),
      M.createNode('rectangle', { parentId: p.id, x: 30, y: 10, w: 10, h: 10 }),
      M.createNode('rectangle', { parentId: p.id, x: 50, y: 10, w: 10, h: 10 }),
      M.createNode('rectangle', { parentId: p.id, x: 70, y: 10, w: 10, h: 10, locked: true }),
    ];
    editor.exec(new C.AddNodesCommand(nodes, p.id));
    const snap = () => Object.fromEntries([...document.querySelectorAll('#toolOptionsBar [data-tool-action]')].map(button => [button.dataset.toolAction, button.disabled]));

    editor.state.selection.clear(); editor.renderAll({ canvas: false, history: false }); const none = snap();
    editor.state.selection.replace([nodes[0].id]); editor.renderAll({ canvas: false, history: false }); const one = snap();
    editor.state.selection.replace([nodes[0].id, nodes[1].id]); editor.renderAll({ canvas: false, history: false }); const two = snap();
    editor.state.selection.replace([nodes[0].id, nodes[1].id, nodes[2].id]); editor.renderAll({ canvas: false, history: false }); const three = snap();
    editor.state.selection.replace([nodes[3].id]); editor.renderAll({ canvas: false, history: false }); const locked = snap();
    return { none, one, two, three, locked };
  });

  for (const action of ['flip-horizontal', 'flip-vertical', 'rotate-cw-90', 'rotate-ccw-90', 'rotate-angle']) {
    expect(result.none[action]).toBe(true);
    expect(result.one[action]).toBe(false);
    expect(result.locked[action]).toBe(true);
  }
  for (const action of ['align-left', 'align-hcenter', 'align-right', 'align-top', 'align-vcenter', 'align-bottom']) {
    expect(result.one[action]).toBe(true);
    expect(result.two[action]).toBe(false);
  }
  for (const action of ['distribute-horizontal', 'distribute-vertical']) {
    expect(result.two[action]).toBe(true);
    expect(result.three[action]).toBe(false);
  }
});