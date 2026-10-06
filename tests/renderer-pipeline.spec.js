import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('renderer has one explicit pipeline owner and canonical node renderers', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => ({
    hasPipeline: Boolean(window.PixelEditorDebug.services?.renderer?.pipeline),
    types: [...(window.PixelEditorDebug.services?.renderer?.pipeline?.nodeTypes || [])].sort(),
    facadeOwned: window.PixelEditorDebug.services?.renderer?.FramebufferRenderer === window.PixelEditorDebug.services?.renderer?.pipeline?.facade,
  }));
  expect(result.hasPipeline).toBe(true);
  expect(result.types).toEqual(['circle', 'image', 'line', 'polygon', 'raster', 'rectangle', 'text']);
  expect(result.facadeOwned).toBe(true);
});

test('renderer compatibility modules no longer clone projects, masquerade nodes as images, or replace global plotPixel', async () => {
  const paths = [
    '../src/rendering/stroke-style.js',
    '../src/rendering/hierarchy-clipping.js',
    '../src/rendering/binary-image.js',
    '../src/transforms/transform-model.js',
    '../src/media/raster-layer.js',
  ];
  for (const relative of paths) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    expect(source, relative).not.toContain('structuredClone(project)');
    expect(source, relative).not.toMatch(/\.type\s*=\s*['"]image['"]/);
    expect(source, relative).not.toContain('R.plotPixel =');
  }
});

test('renderPage never clones the full project', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const { renderer: R, model: M } = window.PixelEditorDebug.services;
    editor.newProject({ force: true });
    const project = editor.state.project;
    const pageModel = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: pageModel.id,
      x: 20, y: 20, w: 40, h: 30,
      fill: { mode: 'solid', color: 1 },
      transform: { rotation: 23, flipX: false, flipY: false },
    });
    pageModel.nodes.push(node);
    const original = window.structuredClone;
    let projectCloneAttempts = 0;
    window.structuredClone = value => {
      if (value === project || (value?.version === 17 && Array.isArray(value?.pages))) {
        projectCloneAttempts += 1;
        throw new Error('renderPage attempted to clone project');
      }
      return original(value);
    };
    let rendered = false;
    let message = '';
    try {
      R.FramebufferRenderer.renderPage(project, pageModel.id, editor.state.assets);
      rendered = true;
    } catch (error) {
      message = String(error?.message || error);
    } finally {
      window.structuredClone = original;
    }
    return { rendered, projectCloneAttempts, message };
  });
  expect(result).toEqual({ rendered: true, projectCloneAttempts: 0, message: '' });
});

test('nested transformed child is clipped by transformed parent visual bounds', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const { model: M, renderer: R } = window.PixelEditorDebug.services;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const parent = M.createNode('rectangle', {
      parentId: p.id, x: 90, y: 70, w: 30, h: 30,
      fill: { mode: 'transparent', color: 1 }, stroke: { width: 0, color: 'transparent', style: 'solid' },
      transform: { rotation: 45, flipX: false, flipY: false },
    });
    const child = M.createNode('rectangle', {
      parentId: parent.id, x: 105, y: 70, w: 35, h: 16,
      fill: { mode: 'solid', color: 1 }, stroke: { width: 0, color: 'transparent', style: 'solid' },
      transform: { rotation: -20, flipX: false, flipY: false },
    });
    p.nodes.push(parent, child);
    const context = { project: editor.state.project, pageId: p.id, assets: editor.state.assets };
    const parentBounds = R.FramebufferRenderer.visualBounds(parent.id, context);
    const frame = R.FramebufferRenderer.renderSubtree(editor.state.project, p.id, parent.id, editor.state.assets, 0);
    const black = [];
    for (let y = 0; y < 300; y += 1) for (let x = 0; x < 400; x += 1) if (frame[y * 400 + x]) black.push({ x, y });
    const outside = black.filter(point => point.x < parentBounds.x || point.y < parentBounds.y || point.x >= parentBounds.x + parentBounds.w || point.y >= parentBounds.y + parentBounds.h);
    return { parentBounds, blackCount: black.length, outsideCount: outside.length };
  });
  expect(result.blackCount).toBeGreaterThan(0);
  expect(result.outsideCount).toBe(0);
  expect(result.parentBounds.w).toBeGreaterThan(30);
  expect(result.parentBounds.h).toBeGreaterThan(30);
});
