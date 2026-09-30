import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

const styles = ['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot'];
const shapeTypes = ['line', 'rectangle', 'circle', 'polygon'];

test('V16 shape nodes use stroke only and never serialize lineWidth', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const P = window.PixelEditor.persistence;
    editor.newProject({ force: true });
    const pageModel = editor.activePage();
    const common = { parentId: pageModel.id, stroke: { width: 3, color: 0, style: 'dash-dot' } };
    const nodes = [
      M.createNode('line', { ...common, x1: 4, y1: 4, x2: 20, y2: 4 }),
      M.createNode('rectangle', { ...common, x: 30, y: 4, w: 20, h: 14 }),
      M.createNode('circle', { ...common, x: 60, y: 4, w: 20, h: 20 }),
      M.createNode('polygon', { ...common, points: [{ x: 90, y: 20 }, { x: 100, y: 4 }, { x: 110, y: 20 }] }),
    ];
    for (const node of nodes) pageModel.nodes.push(node);
    const raw = P.ProjectSerializer.serialize(editor.state.project, editor.state.assets);
    return {
      nodes: nodes.map(node => ({ type: node.type, stroke: node.stroke, hasLineWidth: Object.hasOwn(node, 'lineWidth') })),
      serializedHasLineWidth: raw.includes('"lineWidth"'),
    };
  });
  expect(result.nodes.map(item => item.type)).toEqual(shapeTypes);
  for (const node of result.nodes) {
    expect(node.stroke).toEqual({ width: 3, color: 0, style: 'dash-dot' });
    expect(node.hasLineWidth).toBe(false);
  }
  expect(result.serializedHasLineWidth).toBe(false);
});

test('all five stroke styles render deterministically for all shape primitives', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(({ styles }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const R = window.PixelEditor.renderer;
    const out = {};
    const make = (type, style) => {
      const pageModel = editor.activePage();
      const stroke = { width: 2, color: 1, style };
      if (type === 'line') return M.createNode(type, { parentId: pageModel.id, x1: 40, y1: 40, x2: 90, y2: 40, stroke });
      if (type === 'rectangle') return M.createNode(type, { parentId: pageModel.id, x: 40, y: 40, w: 50, h: 30, stroke, fill: { mode: 'transparent' } });
      if (type === 'circle') return M.createNode(type, { parentId: pageModel.id, x: 40, y: 40, w: 50, h: 30, stroke, fill: { mode: 'transparent' } });
      return M.createNode(type, { parentId: pageModel.id, points: [{ x: 40, y: 70 }, { x: 65, y: 40 }, { x: 90, y: 70 }], stroke, fill: { mode: 'transparent' } });
    };
    for (const type of ['line', 'rectangle', 'circle', 'polygon']) {
      out[type] = {};
      for (const style of styles) {
        editor.newProject({ force: true });
        const node = make(type, style);
        editor.activePage().nodes.push(node);
        const fb = R.FramebufferRenderer.renderPage(editor.state.project, editor.activePage().id, editor.state.assets);
        out[type][style] = fb.reduce((sum, pixel) => sum + pixel, 0);
      }
    }
    return out;
  }, { styles });

  for (const type of shapeTypes) {
    expect(result[type].solid).toBeGreaterThan(0);
    for (const style of styles.slice(1)) {
      expect(result[type][style]).toBeGreaterThan(0);
      expect(result[type][style]).toBeLessThan(result[type].solid);
    }
  }
});

test('white dash pixels cover lower black content while dash gaps preserve it', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const R = window.PixelEditor.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const base = M.createNode('rectangle', {
      parentId: p.id, x: 5, y: 5, w: 40, h: 12,
      stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'solid' },
    });
    const dashed = M.createNode('line', {
      parentId: p.id, x1: 10, y1: 10, x2: 30, y2: 10,
      stroke: { width: 1, color: 0, style: 'short-dash' },
    });
    p.nodes.push(base, dashed);
    const fb = R.FramebufferRenderer.renderPage(editor.state.project, p.id, editor.state.assets);
    const at = x => fb[10 * 400 + x];
    return { on0: at(10), on3: at(13), gap0: at(14), gap1: at(15), nextOn: at(16) };
  });
  expect(result).toEqual({ on0: 0, on3: 0, gap0: 1, gap1: 1, nextOn: 0 });
});

test('element properties edit stroke independently from remembered tool defaults', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    editor.setToolDefault('line', 'width', 4);
    editor.setToolDefault('line', 'color', 0);
    editor.setToolDefault('line', 'style', 'dot');
    const p = editor.activePage();
    const line = M.createNode('line', {
      parentId: p.id, x1: 5, y1: 5, x2: 30, y2: 5,
      stroke: { width: 2, color: 1, style: 'solid' },
    });
    editor.exec(new C.AddNodesCommand([line], p.id));
    editor.state.selection.replace([line.id]);
    editor.properties.render();
    const width = document.querySelector('#propStrokeWidth');
    const color = document.querySelector('#propStrokeColor');
    const style = document.querySelector('#propStrokeStyle');
    width.value = '3'; width.dispatchEvent(new Event('change', { bubbles: true }));
    color.value = '0'; color.dispatchEvent(new Event('change', { bubbles: true }));
    style.value = 'dash-dot'; style.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      nodeStroke: M.nodeById(p, line.id).stroke,
      toolDefaults: editor.getToolDefaults('line'),
    };
  });
  expect(result.nodeStroke).toEqual({ width: 3, color: 0, style: 'dash-dot' });
  expect(result.toolDefaults).toEqual({ width: 4, color: 0, style: 'dot' });
});
