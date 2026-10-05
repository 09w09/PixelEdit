import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('clipboard production entrypoints use one canonical implementation', async () => {
  const elementClipboard = await readFile(new URL('../src/clipboard/element-clipboard.js', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../src/app/workspace.js', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  expect(elementClipboard).not.toContain('I.Clipboard =');
  expect(elementClipboard).not.toContain('workspaceCapabilities');
  expect(elementClipboard).not.toContain('version: 16');
  expect(workspace).toContain("import { ElementClipboard } from '../clipboard/element-clipboard.js';");
  expect(workspace).not.toContain("../interaction/clipboard.js");
  expect(main).not.toContain('installElementClipboardRuntime');
  expect(main).not.toContain("./core/index.js");
});

test('Ctrl+A selects every ordinary node including hidden and locked nodes', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const nodes = [
      M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 10, h: 10 }),
      M.createNode('circle', { parentId: p.id, x: 30, y: 10, w: 10, h: 10, visible: false }),
      M.createNode('text', { parentId: p.id, x: 50, y: 10, w: 30, h: 20, locked: true, text: 'locked' }),
    ];
    editor.exec(new C.AddNodesCommand(nodes, p.id));
    editor.state.selection.clear();
    editor.pageSelectedId = p.id;
  });
  await page.keyboard.press('Control+A');
  const result = await page.evaluate(() => ({
    ids: [...window.PixelEditorTest.editor.state.selection.ids],
    pageSelectedId: window.PixelEditorTest.editor.pageSelectedId,
    nodeCount: window.PixelEditorTest.editor.activePage().nodes.length,
  }));
  expect(result.ids).toHaveLength(result.nodeCount);
  expect(new Set(result.ids).size).toBe(result.nodeCount);
  expect(result.pageSelectedId).toBeNull();
});

test('structured copy stores selected roots once and pastes 0/+8/+16 with fresh hierarchy IDs', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const source = editor.activePage();
    const parent = M.createNode('rectangle', { parentId: source.id, x: 10, y: 20, w: 20, h: 20 });
    const child = M.createNode('circle', { parentId: parent.id, x: 14, y: 24, w: 8, h: 8 });
    editor.exec(new C.AddNodesCommand([parent, child], source.id));
    editor.state.selection.replace([parent.id, child.id]);
    const beforeCount = source.nodes.length;
    const payload = editor.copySelection();
    const afterCopyCount = source.nodes.length;
    const copyRoots = [...payload.roots];
    const copyNodeIds = payload.nodes.map(node => node.id);

    const first = editor.pasteClipboard();
    const firstRoots = [...editor.state.selection.ids];
    const firstRoot = M.nodeById(source, firstRoots[0]);
    const firstChild = new M.TreeModel(source).childrenOf(firstRoot.id)[0];

    const second = editor.pasteClipboard();
    const secondRoot = M.nodeById(source, editor.state.selection.primaryId);
    const third = editor.pasteClipboard();
    const thirdRoot = M.nodeById(source, editor.state.selection.primaryId);

    return {
      formatVersion: payload.formatVersion,
      legacyVersion: Object.hasOwn(payload, 'version'),
      beforeCount, afterCopyCount,
      copyRoots, copyNodeIds,
      first, second, third,
      firstRoot: { id: firstRoot.id, parentId: firstRoot.parentId, x: firstRoot.x, y: firstRoot.y },
      firstChild: { id: firstChild.id, parentId: firstChild.parentId, x: firstChild.x, y: firstChild.y },
      secondRoot: { x: secondRoot.x, y: secondRoot.y },
      thirdRoot: { x: thirdRoot.x, y: thirdRoot.y },
      hierarchyValid: new M.TreeModel(source).validateHierarchy(),
    };
  });

  expect(result.formatVersion).toBe(1);
  expect(result.legacyVersion).toBe(false);
  expect(result.afterCopyCount).toBe(result.beforeCount);
  expect(result.copyRoots).toHaveLength(1);
  expect(result.copyNodeIds).toHaveLength(2);
  expect(new Set(result.copyNodeIds).size).toBe(2);
  expect(result.first).toBe(true);
  expect(result.second).toBe(true);
  expect(result.third).toBe(true);
  expect(result.firstRoot.x).toBe(10);
  expect(result.firstRoot.y).toBe(20);
  expect(result.firstChild.x).toBe(14);
  expect(result.firstChild.y).toBe(24);
  expect(result.firstChild.parentId).toBe(result.firstRoot.id);
  expect(result.firstRoot.id).not.toBe(result.copyRoots[0]);
  expect(result.secondRoot).toEqual({ x: 18, y: 28 });
  expect(result.thirdRoot).toEqual({ x: 26, y: 36 });
  expect(result.hierarchyValid).toBe(true);
});

test('clipboard survives page changes and carries image/font resources needed by copied nodes', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const source = editor.activePage();
    const imageAssetId = editor.state.assets.add('image', 'data:image/png;base64,AA==', { name: 'copy.png', mime: 'image/png' });
    editor.state.assets.setRuntime(imageAssetId, { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) });
    const fontAssetId = editor.state.assets.add('font', 'data:font/woff2;base64,AA==', { name: 'copy.woff2', mime: 'font/woff2', sha256: 'copy-font' });
    const family = 'Clipboard_font';
    editor.state.project.fonts.push({ name: 'copy.woff2', family, fixedSize: null, assetId: fontAssetId, sha256: 'copy-font' });
    const image = M.createNode('image', { parentId: source.id, x: 7, y: 9, w: 1, h: 1, assetId: imageAssetId, sourceWidth: 1, sourceHeight: 1, sourceName: 'copy.png' });
    const text = M.createNode('text', { parentId: source.id, x: 20, y: 9, w: 40, h: 20, text: 'A', fontFamily: family });
    editor.exec(new C.AddNodesCommand([image, text], source.id));
    editor.state.selection.replace([image.id, text.id]);
    const payload = editor.copySelection();

    editor.exec(new C.CreatePageCommand('第二页'));
    const target = editor.activePage();
    const pasted = editor.pasteClipboard();
    const pastedNodes = editor.state.selection.ids.map(id => M.nodeById(target, id));
    return {
      pasted,
      targetId: target.id,
      selectedCount: editor.state.selection.ids.length,
      rootsOnTarget: pastedNodes.every(node => node.parentId === target.id),
      imageValid: pastedNodes.some(node => node.type === 'image' && editor.state.assets.has(node.assetId) && Boolean(editor.state.assets.getRuntime(node.assetId))),
      fontValid: pastedNodes.some(node => node.type === 'text' && node.fontFamily === family) && editor.state.project.fonts.some(font => font.family === family && editor.state.assets.has(font.assetId)),
      assetRecords: payload.assetRecords?.length || 0,
      fontRecords: payload.fontRecords?.length || 0,
      pasteIndex: editor.clipboard.pasteIndex,
    };
  });

  expect(result.pasted).toBe(true);
  expect(result.selectedCount).toBe(2);
  expect(result.rootsOnTarget).toBe(true);
  expect(result.imageValid).toBe(true);
  expect(result.fontValid).toBe(true);
  expect(result.assetRecords).toBeGreaterThanOrEqual(2);
  expect(result.fontRecords).toBe(1);
  expect(result.pasteIndex).toBe(1);
});

test('copy context command creates nothing until paste and one paste is atomic in undo/redo', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 10, h: 10 });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    const beforeCopy = p.nodes.length;
    const copied = editor.executeContextCommand('copy');
    const afterCopy = p.nodes.length;
    const cursorBeforePaste = editor.bus.cursor;
    const pasted = editor.executeContextCommand('paste');
    const afterPaste = editor.activePage().nodes.length;
    const cursorAfterPaste = editor.bus.cursor;
    const undo = editor.bus.undo(); editor.renderAll();
    const afterUndo = editor.activePage().nodes.length;
    const redo = editor.bus.redo(); editor.renderAll();
    const afterRedo = editor.activePage().nodes.length;
    return { beforeCopy, copied, afterCopy, pasted, afterPaste, cursorBeforePaste, cursorAfterPaste, undo, afterUndo, redo, afterRedo };
  });

  expect(result.copied).toBe(true);
  expect(result.afterCopy).toBe(result.beforeCopy);
  expect(result.pasted).toBe(true);
  expect(result.afterPaste).toBe(result.beforeCopy + 1);
  expect(result.cursorAfterPaste - result.cursorBeforePaste).toBe(1);
  expect(result.undo).toBe(true);
  expect(result.afterUndo).toBe(result.beforeCopy);
  expect(result.redo).toBe(true);
  expect(result.afterRedo).toBe(result.beforeCopy + 1);
});

test('canvas and layer right-click preserve/replace selection identically and expose the same command registry', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const a = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 10, h: 10 });
    const b = M.createNode('rectangle', { parentId: p.id, x: 40, y: 10, w: 10, h: 10 });
    editor.exec(new C.AddNodesCommand([a, b], p.id));
    editor.state.selection.replace([a.id, b.id]);
    editor.openContextMenu({ source: 'canvas', nodeId: a.id, clientX: 5, clientY: 5 });
    const canvasPreserved = [...editor.state.selection.ids];
    const canvasCommands = [...document.querySelectorAll('#contextMenu [data-context-command]')].map(button => button.dataset.contextCommand);
    editor.openContextMenu({ source: 'canvas', nodeId: b.id, clientX: 5, clientY: 5 });
    const stillPreserved = [...editor.state.selection.ids];
    editor.state.selection.replace([a.id]);
    editor.openContextMenu({ source: 'canvas', nodeId: b.id, clientX: 5, clientY: 5 });
    const canvasReplaced = [...editor.state.selection.ids];

    editor.state.selection.replace([a.id, b.id]);
    editor.pageLayers.render();
    const row = document.querySelector(`.layer-row[data-node-id="${a.id}"]`);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }));
    const layerPreserved = [...editor.state.selection.ids];
    const layerCommands = [...document.querySelectorAll('#contextMenu [data-context-command]')].map(button => button.dataset.contextCommand);
    return { canvasPreserved, stillPreserved, canvasReplaced, layerPreserved, canvasCommands, layerCommands, source: document.querySelector('#contextMenu')?.dataset.source };
  });

  expect(result.canvasPreserved).toHaveLength(2);
  expect(result.stillPreserved).toHaveLength(2);
  expect(result.canvasReplaced).toHaveLength(1);
  expect(result.layerPreserved).toHaveLength(2);
  expect(result.canvasCommands).toEqual(result.layerCommands);
  expect(result.canvasCommands).toEqual(expect.arrayContaining(['copy', 'paste', 'delete', 'flip-horizontal', 'flip-vertical', 'rotate-cw-90', 'rotate-ccw-90', 'rotate-angle', 'rasterize']));
  expect(result.source).toBe('layers');
});

test('shared context delete and transform skip locked selected nodes', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const open = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 10, h: 10 });
    const locked = M.createNode('rectangle', { parentId: p.id, x: 40, y: 10, w: 10, h: 10, locked: true });
    editor.exec(new C.AddNodesCommand([open, locked], p.id));
    editor.state.selection.replace([open.id, locked.id]);
    const transformed = editor.executeContextCommand('rotate-cw-90');
    const afterTransform = {
      open: structuredClone(M.nodeById(editor.activePage(), open.id).transform),
      locked: structuredClone(M.nodeById(editor.activePage(), locked.id).transform),
    };
    const deleted = editor.executeContextCommand('delete');
    return {
      transformed, afterTransform, deleted,
      openExists: Boolean(M.nodeById(editor.activePage(), open.id)),
      lockedExists: Boolean(M.nodeById(editor.activePage(), locked.id)),
    };
  });

  expect(result.transformed).toBe(true);
  expect(result.afterTransform.open.rotation).toBe(90);
  expect(result.afterTransform.locked.rotation).toBe(0);
  expect(result.deleted).toBe(true);
  expect(result.openExists).toBe(false);
  expect(result.lockedExists).toBe(true);
});
