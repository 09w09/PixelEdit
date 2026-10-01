import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('normal visual nodes carry editable transform state', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const M = window.PixelEditor.model;
    return ['rectangle', 'circle', 'line', 'polygon', 'text', 'image', 'raster'].map(type => {
      const props = type === 'line' ? { x1: 0, y1: 0, x2: 10, y2: 0 } : type === 'polygon' ? { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] } : { x: 0, y: 0, w: 10, h: 6 };
      const node = M.createNode(type, { ...props, transform: { rotation: 23, flipX: true, flipY: false } });
      return { type, transform: node.transform };
    });
  });
  for (const item of result) expect(item.transform).toEqual({
    rotation: 23,
    flipX: true,
    flipY: false,
    translateX: 0,
    translateY: 0,
  });
});

test('rotated visual bounds and render output share the same canonical transform', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const R = window.PixelEditor.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const rect = M.createNode('rectangle', {
      parentId: p.id, x: 100, y: 100, w: 20, h: 10,
      stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'solid' },
      transform: { rotation: 90, flipX: false, flipY: false },
    });
    p.nodes.push(rect);
    const bounds = R.FramebufferRenderer.visualBounds(rect.id, { project: editor.state.project, pageId: p.id, assets: editor.state.assets });
    const fb = R.FramebufferRenderer.renderPage(editor.state.project, p.id, editor.state.assets);
    const black = [];
    for (let y = 90; y < 125; y++) for (let x = 90; x < 130; x++) if (fb[y * 400 + x]) black.push([x, y]);
    return { bounds, blackMinX: Math.min(...black.map(v => v[0])), blackMaxX: Math.max(...black.map(v => v[0])), blackMinY: Math.min(...black.map(v => v[1])), blackMaxY: Math.max(...black.map(v => v[1])) };
  });
  expect(result.bounds.w).toBeCloseTo(10, 5);
  expect(result.bounds.h).toBeCloseTo(20, 5);
  expect(result.blackMaxX - result.blackMinX + 1).toBeLessThanOrEqual(11);
  expect(result.blackMaxY - result.blackMinY + 1).toBeGreaterThanOrEqual(19);
});

test('arbitrary rotation updates hit testing beyond the untransformed box', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const I = window.PixelEditor.interaction;
    const R = window.PixelEditor.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const rect = M.createNode('rectangle', {
      parentId: p.id, x: 100, y: 100, w: 30, h: 8,
      stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'solid' },
      transform: { rotation: 45, flipX: false, flipY: false },
    });
    p.nodes.push(rect);
    const bounds = R.FramebufferRenderer.visualBounds(rect.id, { project: editor.state.project, pageId: p.id, assets: editor.state.assets });
    const hit = new I.HitTest(editor.state.project, p.id, editor.state.assets);
    const sample = { x: Math.floor(bounds.x + bounds.w / 2), y: Math.floor(bounds.y + 1) };
    const top = hit.topmostAt(sample.x, sample.y);
    return { bounds, sample, hitId: top?.id || null };
  });
  expect(result.bounds.w).toBeGreaterThan(20);
  expect(result.bounds.h).toBeGreaterThan(20);
  expect(result.hitId).toBeTruthy();
});

test('transform is serialized as artwork state and remains editable', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const P = window.PixelEditor.persistence;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('circle', {
      parentId: p.id,
      x: 20, y: 30, w: 12, h: 8,
      transform: { rotation: -37, flipX: true, flipY: true, translateX: 12.5, translateY: -7.25 },
    });
    p.nodes.push(node);
    const raw = P.ProjectSerializer.serialize(editor.state.project, editor.state.assets);
    const restored = P.ProjectSerializer.deserialize(raw).project.pages[0].nodes[0];
    return restored.transform;
  });
  expect(result).toEqual({
    rotation: -37,
    flipX: true,
    flipY: true,
    translateX: 12.5,
    translateY: -7.25,
  });
});
