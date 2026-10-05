import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

const OVERLAY_PATCH_FILES = [
  '../src/rendering/selection-overlay.js',
  '../src/rendering/transparency-overlay.js',
  '../src/tools/canvas-cursor.js',
  '../src/transforms/photopea-transform-ui.js',
];

const LAYER_ORDER = ['transparency', 'selection', 'handles', 'interaction', 'tool-cursor'];

test('OverlayPipeline is the single owner of overlay composition', async ({ page }) => {
  for (const relative of OVERLAY_PATCH_FILES) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    expect(source, `${relative} must not patch renderOverlay`).not.toMatch(/Workspace\.prototype\.renderOverlay\s*=/);
    expect(source, `${relative} must not append overlay markup after another renderer`).not.toContain('insertAdjacentHTML');
  }

  const pipelineSource = await readFile(new URL('../src/rendering/overlay-pipeline.js', import.meta.url), 'utf8');
  const workspaceSource = await readFile(new URL('../src/app/workspace.js', import.meta.url), 'utf8');
  expect(pipelineSource).toContain('class OverlayPipeline');
  expect(pipelineSource).not.toMatch(/Workspace\.prototype\.renderOverlay\s*=/);
  expect(pipelineSource).toContain('function renderOverlay(editor');
  expect(pipelineSource).not.toContain('workspaceCapabilities');
  expect(workspaceSource).toContain("renderOverlay() { return PE.overlayPipeline?.render?.(this) || ''; }");
  expect(workspaceSource).not.toContain('workspaceCapabilities');

  await openEditor(page);
  const state = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const pipeline = window.PixelEditor.overlayPipeline;
    return {
      globalPipeline: Boolean(pipeline),
      editorPipeline: editor.overlayPipeline === pipeline,
      layerIds: pipeline?.layers?.map(layer => layer.id) || [],
      hasRender: typeof pipeline?.render === 'function',
    };
  });

  expect(state).toEqual({
    globalPipeline: true,
    editorPipeline: true,
    layerIds: LAYER_ORDER,
    hasRender: true,
  });
});

test('overlay layers render in one deterministic pass without losing existing visual semantics', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const raster = M.createNode('raster', {
      parentId: active.id,
      x: 40,
      y: 50,
      w: 3,
      h: 3,
      pixels: Uint8Array.from([
        0, 2, 2,
        2, 1, 2,
        2, 2, 2,
      ]),
    });
    editor.exec(new C.AddNodesCommand([raster], active.id));
    editor.state.selection.replace([raster.id]);
    editor.editorPreferences = { ...editor.editorPreferences, transparencyPreview: true };
    editor.setTool('pencil');
    editor.setToolDefault('pencil', 'width', 3);
    editor.canvasCursorInside = true;
    editor.canvasCursorPoint = { x: 80, y: 90 };
    editor.overlayState = {
      smartGuides: [{ axis: 'x', coord: 60 }],
      marquee: { x: 5, y: 6, w: 20, h: 15 },
    };
    editor.renderOverlay();
    const svg = editor.overlay;
    return {
      layers: [...svg.querySelectorAll(':scope > [data-overlay-layer]')].map(node => node.getAttribute('data-overlay-layer')),
      transparency: svg.querySelectorAll('[data-transparency-preview="true"]').length,
      selection: svg.querySelectorAll('.selection-box').length,
      handles: svg.querySelectorAll('.selection-handle').length,
      guides: svg.querySelectorAll('.smart-guide').length,
      marquee: svg.querySelectorAll('.marquee-box').length,
      brush: svg.querySelectorAll('[data-canvas-tool-cursor="brush"]').length,
    };
  });

  expect(result.layers).toEqual(LAYER_ORDER);
  expect(result.transparency).toBeGreaterThan(0);
  expect(result.selection).toBe(1);
  expect(result.handles).toBe(8);
  expect(result.guides).toBe(1);
  expect(result.marquee).toBe(1);
  expect(result.brush).toBe(1);
});
