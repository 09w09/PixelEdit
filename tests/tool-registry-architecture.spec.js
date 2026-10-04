import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const TOOL_IDS = ['pointer', 'select', 'pencil', 'eraser', 'bucket', 'line', 'rectangle', 'circle', 'polygon', 'image', 'text'];
const PATCH_FILES = [
  '../src/tools/tool-state.js',
  '../src/tools/tool-options-bar.js',
  '../src/tools/fill-tool-options.js',
  '../src/tools/canvas-cursor.js',
  '../src/raster/paint-brush.js',
  '../src/raster/flood-fill.js',
  '../src/media/raster-layer.js',
  '../src/media/edit-boundaries.js',
];

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('ToolRegistry and ToolController own every supported tool without Workspace prototype routing patches', async ({ page }) => {
  const workspaceSource = await readFile(new URL('../src/app/workspace.js', import.meta.url), 'utf8');
  for (const relative of PATCH_FILES) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8').catch(() => '');
    expect(source, `${relative} must not patch Workspace routing`).not.toMatch(/Workspace\.prototype\.(?:setTool|onPointerDown|onPointerMove|onPointerUp|beginPaint)\s*=/);
    expect(source, `${relative} must not wrap tool options render`).not.toContain('ToolOptionsBar.prototype.render =');
  }
  expect((workspaceSource.match(/\bsetTool\s*\([^)]*\)\s*\{/g) || []).length).toBe(1);

  await openEditor(page);
  const state = await page.evaluate(ids => {
    const editor = window.PixelEditorTest.editor;
    const tools = window.PixelEditor.tools;
    return {
      registry: Boolean(tools?.registry),
      controller: Boolean(editor.toolController),
      registered: ids.map(id => Boolean(tools?.registry?.get?.(id))),
      controllerMethods: ['setTool', 'pointerDown', 'pointerMove', 'pointerUp', 'keyDown', 'renderOptions', 'cursor']
        .map(name => typeof editor.toolController?.[name] === 'function'),
    };
  }, TOOL_IDS);

  expect(state.registry).toBe(true);
  expect(state.controller).toBe(true);
  expect(state.registered).toEqual(TOOL_IDS.map(() => true));
  expect(state.controllerMethods).toEqual([true, true, true, true, true, true, true]);
});

test('every tool switch terminates the active CommandBus edit session before the new tool becomes active', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(ids => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const input = document.querySelector('#fileImage');
    if (input) input.click = () => {};
    const output = [];

    for (const tool of ids) {
      editor.newProject({ force: true });
      const page = editor.activePage();
      const node = M.createNode('rectangle', { parentId: page.id, x: 10, y: 10, w: 20, h: 20 });
      editor.exec(new C.AddNodesCommand([node], page.id));
      const baseline = editor.bus.cursor;
      editor.bus.beginSession({ operation: 'property', targets: [node.id], channel: 'x', label: '修改 X' });
      editor.bus.updateSession(new C.UpdateNodesCommand([node.id], { x: 20 }, page.id, '修改 X', { historyChannel: 'x' }));
      const previewCursor = editor.bus.cursor;
      editor.setTool(tool);
      const afterSwitch = { session: Boolean(editor.bus.session), cursor: editor.bus.cursor, active: editor.tool };
      editor.exec(new C.UpdateNodesCommand([node.id], { x: 30 }, page.id, '修改 X', { historyChannel: 'x' }));
      output.push({ tool, baseline, previewCursor, afterSwitch, finalCursor: editor.bus.cursor });
    }
    return output;
  }, TOOL_IDS);

  for (const item of result) {
    expect(item.previewCursor, `${item.tool}: preview owns one provisional history entry`).toBe(item.baseline + 1);
    expect(item.afterSwitch.session, `${item.tool}: session ends at tool boundary`).toBe(false);
    expect(item.afterSwitch.cursor, `${item.tool}: switch commits without adding a second session entry`).toBe(item.baseline + 1);
    expect(item.finalCursor, `${item.tool}: later edit cannot merge across tool boundary`).toBe(item.baseline + 2);
  }
});

test('bucket is registered as a normal tool and no longer installed by mutating the toolbar/workspace prototype', async () => {
  const source = await readFile(new URL('../src/raster/flood-fill.js', import.meta.url), 'utf8');
  expect(source).not.toContain('Workspace.prototype.mount');
  expect(source).not.toContain('Workspace.prototype.setTool');
  expect(source).not.toContain('Workspace.prototype.onPointerDown');
  expect(source).not.toContain('ensureBucketButton()');
});
