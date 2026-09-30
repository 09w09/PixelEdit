import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('V16 shape nodes use stroke objects and never lineWidth', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const M = window.PixelEditor.model;
    const P = window.PixelEditor.persistence;
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const activePage = editor.activePage();
    const types = ['line', 'rectangle', 'circle', 'polygon'];
    const nodes = types.map(type => M.createNode(type, {
      parentId: activePage.id,
      stroke: { width: 3, color: 0, style: 'dash-dot' },
    }));
    for (const node of nodes) activePage.nodes.push(node);
    const serialized = JSON.parse(P.ProjectSerializer.serialize(editor.state.project, editor.state.assets));
    let legacyError = '';
    const bad = structuredClone(editor.state.project);
    bad.pages[0].nodes[0].lineWidth = 2;
    try { P.ProjectSerializer.serialize(bad, editor.state.assets); } catch (error) { legacyError = String(error?.message || error); }
    return {
      nodes: nodes.map(node => ({
        type: node.type,
        stroke: node.stroke,
        hasLineWidth: Object.hasOwn(node, 'lineWidth'),
      })),
      serializedHasLineWidth: serialized.pages[0].nodes.some(node => Object.hasOwn(node, 'lineWidth')),
      legacyError,
    };
  });

  for (const node of result.nodes) {
    expect(node.stroke).toEqual({ width: 3, color: 0, style: 'dash-dot' });
    expect(node.hasLineWidth).toBe(false);
  }
  expect(result.serializedHasLineWidth).toBe(false);
  expect(result.legacyError).toContain('lineWidth');
});

test('all five stroke styles have deterministic pixel patterns', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const PE = window.PixelEditor;
    const M = PE.model;
    const R = PE.renderer;
    const nodeFor = style => M.createNode('line', {
      x1: 10, y1: 20, x2: 29, y2: 20,
      stroke: { width: 1, color: 1, style },
    });
    const styles = ['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot'];
    return Object.fromEntries(styles.map(style => {
      const node = nodeFor(style);
      const pixels = PE.strokeStyle.styledStrokePixels(node, R, PE.pixelStrokeRuntime);
      return [style, pixels.map(pixel => `${pixel.x},${pixel.y}`)];
    }));
  });

  expect(result.solid).toHaveLength(20);
  expect(result['short-dash']).toHaveLength(14);
  expect(result['long-dash']).toHaveLength(16);
  expect(result.dot).toHaveLength(7);
  expect(result['dash-dot']).toHaveLength(12);
  expect(new Set(Object.values(result).map(points => points.join('|'))).size).toBe(5);
});

test('active shape tool snapshots defaults into newly created stroke', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    editor.setToolDefault('rectangle', 'width', 5);
    editor.setToolDefault('rectangle', 'color', 0);
    editor.setToolDefault('rectangle', 'style', 'long-dash');
    editor.setTool('rectangle');
    editor.beginLiveDraw('rectangle', { x: 15, y: 18 });
    const node = window.PixelEditor.model.nodeById(editor.activePage(), editor.customGesture.nodeId);
    const snapshot = structuredClone(node.stroke);
    editor.setToolDefault('rectangle', 'width', 2);
    const unchanged = structuredClone(node.stroke);
    editor.cancelCustomGesture();
    return { snapshot, unchanged };
  });

  expect(result.snapshot).toEqual({ width: 5, color: 0, style: 'long-dash' });
  expect(result.unchanged).toEqual(result.snapshot);
});

test('element properties edit stroke width color and style independently of tool defaults', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const activePage = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: activePage.id,
      x: 10, y: 10, w: 30, h: 20,
      stroke: { width: 2, color: 1, style: 'solid' },
      fill: { mode: 'transparent' },
    });
    editor.exec(new C.AddNodesCommand([node], activePage.id));
    editor.state.selection.replace([node.id]);
    editor.properties.render();
    const width = document.querySelector('#propStrokeWidth');
    const color = document.querySelector('#propStrokeColor');
    const style = document.querySelector('#propStrokeStyle');
    const initial = { width: width?.value, color: color?.value, style: style?.value };
    width.value = '6'; width.dispatchEvent(new Event('change', { bubbles: true }));
    color.value = '0'; color.dispatchEvent(new Event('change', { bubbles: true }));
    style.value = 'short-dash'; style.dispatchEvent(new Event('change', { bubbles: true }));
    const current = M.nodeById(activePage, node.id);
    return {
      initial,
      stroke: structuredClone(current.stroke),
      toolDefaults: editor.getToolDefaults('rectangle'),
      hasLegacyWidth: Object.hasOwn(current, 'lineWidth'),
    };
  });

  expect(result.initial).toEqual({ width: '2', color: '1', style: 'solid' });
  expect(result.stroke).toEqual({ width: 6, color: 0, style: 'short-dash' });
  expect(result.toolDefaults).not.toEqual(result.stroke);
  expect(result.hasLegacyWidth).toBe(false);
});
