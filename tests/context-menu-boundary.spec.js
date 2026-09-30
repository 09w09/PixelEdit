import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function dispatchContext(target) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 14 });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

test('native context menu is prevented everywhere while custom menu appears only for canvas and layers', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', { parentId: p.id, x: 5, y: 5, w: 20, h: 20 });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.pageLayers.render();
    const dispatch = target => {
      editor.closeContextMenu();
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 14 });
      target.dispatchEvent(event);
      const menu = document.querySelector('#contextMenu');
      return { prevented: event.defaultPrevented, open: menu?.classList.contains('open') || false, source: menu?.dataset.source || '' };
    };
    const input = document.createElement('input'); document.body.appendChild(input);
    const textarea = document.createElement('textarea'); document.body.appendChild(textarea);
    const targets = {
      body: document.body,
      globalToolbar: document.querySelector('#globalToolbar'),
      toolOptions: document.querySelector('#toolOptionsBar'),
      toolDock: document.querySelector('#leftSidebar'),
      properties: document.querySelector('#propertiesDock'),
      history: document.querySelector('#historyDock'),
      status: document.querySelector('.statusbar'),
      input,
      textarea,
      canvas: document.querySelector('#canvas'),
      layer: document.querySelector(`.layer-row[data-node-id="${node.id}"]`),
    };
    return Object.fromEntries(Object.entries(targets).filter(([, target]) => target).map(([key, target]) => [key, dispatch(target)]));
  });
  for (const [key, value] of Object.entries(result)) expect(value.prevented, key).toBe(true);
  for (const key of ['body', 'globalToolbar', 'toolOptions', 'toolDock', 'properties', 'history', 'status', 'input', 'textarea']) {
    if (result[key]) expect(result[key].open, key).toBe(false);
  }
  expect(result.canvas.open).toBe(true);
  expect(result.canvas.source).toBe('canvas');
  expect(result.layer.open).toBe(true);
  expect(result.layer.source).toBe('layers');
});

test('nested descendants are classified by ancestor and still suppress native menu', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const B = window.PixelEditor.contextMenuBoundary;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', { parentId: p.id, x: 5, y: 5, w: 20, h: 20 });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.pageLayers.render();
    const svgChild = document.querySelector('#undoBtn svg *') || document.querySelector('#undoBtn svg');
    const layerChild = document.querySelector(`.layer-row[data-node-id="${node.id}"] *`) || document.querySelector(`.layer-row[data-node-id="${node.id}"]`);
    const probe = target => {
      editor.closeContextMenu();
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 7, clientY: 7 });
      target.dispatchEvent(event);
      return { prevented: event.defaultPrevented, region: B?.classifyContextRegion?.(target), open: document.querySelector('#contextMenu')?.classList.contains('open') || false };
    };
    return { svg: probe(svgChild), layer: probe(layerChild) };
  });
  expect(result.svg.prevented).toBe(true);
  expect(result.svg.region).toBe('none');
  expect(result.svg.open).toBe(false);
  expect(result.layer.prevented).toBe(true);
  expect(result.layer.region).toBe('layers');
  expect(result.layer.open).toBe(true);
});
