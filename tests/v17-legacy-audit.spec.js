import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('V17 page background properties read and write fill.color only', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const pageModel = editor.activePage();
    pageModel.fill = { mode: 'solid', color: 1 };
    editor.state.selection.clear();
    editor.pageSelectedId = pageModel.id;
    editor.properties.render();
    const before = document.querySelector('#propBgSolid')?.value;
    const control = document.querySelector('#propBgSolid');
    control.value = '0';
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      before,
      after: structuredClone(editor.activePage().fill),
      hasValue: Object.hasOwn(editor.activePage().fill || {}, 'value'),
    };
  });

  expect(result.before).toBe('1');
  expect(result.after).toEqual({ mode: 'solid', color: 0 });
  expect(result.hasValue).toBe(false);
});

test('binary image preview does not replace PropertyProvider methods at runtime', async () => {
  const source = await readFile(new URL('../src/rendering/binary-image-preview.js', import.meta.url), 'utf8');
  expect(source).not.toContain('provider.renderPreviews =');
  expect(source).not.toContain('provider.renderPreviews.bind');
});

test('image property preview uses binaryImage directly without executing legacy dither preview', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const PE = window.PixelEditor;
    editor.newProject({ force: true });
    const state = editor.state;
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
    const assetId = state.assets.add('image', '', { name: 'preview.png', mime: 'image/png' });
    state.assets.setRuntime(assetId, { width: 2, height: 1, data: rgba });
    const node = PE.model.createNode('image', {
      parentId: editor.activePage().id,
      x: 0, y: 0, w: 2, h: 1,
      assetId,
      sourceWidth: 2, sourceHeight: 1,
      image: {
        fit: 'stretch', interpolation: 'nearest', cropX: 0, cropY: 0, cropW: 2, cropH: 1,
        bwMode: 'dither', threshold: 128, invert: true, ditherAlgorithm: 'bayer', bayerMatrix: 4,
      },
    });
    editor.activePage().nodes.push(node);
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;

    const original = PE.renderer.ditherImageData;
    let legacyCalls = 0;
    PE.renderer.ditherImageData = () => {
      legacyCalls += 1;
      throw new Error('legacy preview path executed');
    };
    let error = '';
    try {
      editor.properties.render();
    } catch (caught) {
      error = String(caught?.message || caught);
    } finally {
      PE.renderer.ditherImageData = original;
    }
    const preview = document.querySelector('#imageDitherPreview');
    return { legacyCalls, error, previewExists: Boolean(preview) };
  });

  expect(result.previewExists).toBe(true);
  expect(result.legacyCalls).toBe(0);
  expect(result.error).toBe('');
});

test('visible runtime branding and schema are V17 only', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    editor.renderAll();
    const invalid = JSON.stringify({ ...structuredClone(editor.state.project), version: 16, assets: [] });
    let oldProjectMessage = '';
    try { window.PixelEditor.persistence.ProjectSerializer.deserialize(invalid); }
    catch (error) { oldProjectMessage = String(error?.message || error); }
    return {
      runtimeVersion: window.PixelEditor.version,
      testVersion: window.PixelEditorTest.version,
      dataset: document.documentElement.dataset.pixelEditor,
      status: document.querySelector('#statusText')?.textContent,
      title: document.title,
      oldProjectMessage,
    };
  });

  expect(result.runtimeVersion).toBe(17);
  expect(result.testVersion).toBe(17);
  expect(result.dataset).toBe('v17');
  expect(result.status).toContain('V17');
  expect(result.title).toContain('V17');
  expect(result.oldProjectMessage).toMatch(/V17/);
});
