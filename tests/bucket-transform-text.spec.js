import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('bucket is an editing tool with transparent, solid, dither and pattern defaults', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    editor.setTool('bucket');
    const button = document.querySelector('[data-tool="bucket"]');
    const mode = document.querySelector('#toolOptionFillMode');
    const modes = mode ? [...mode.options].map(option => option.value) : [];
    editor.setToolDefault('bucket', 'fill', { mode: 'dither', color: 1 });
    editor.setToolDefault('bucket', 'dither', {
      type: 'blueNoise', density: 37, matrix: 8, align: 'object', offsetX: 2, offsetY: -3,
    });
    editor.setTool('bucket');
    const dither = {
      type: document.querySelector('#toolOptionDitherType')?.value,
      density: Number(document.querySelector('#toolOptionDitherDensity')?.value),
      matrix: Number(document.querySelector('#toolOptionDitherMatrix')?.value),
      align: document.querySelector('#toolOptionDitherAlign')?.value,
      offsetX: Number(document.querySelector('#toolOptionDitherOffsetX')?.value),
      offsetY: Number(document.querySelector('#toolOptionDitherOffsetY')?.value),
    };
    editor.setToolDefault('bucket', 'fill', { mode: 'pattern', color: 1 });
    editor.setToolDefault('bucket', 'pattern', {
      type: 'diagSlash', lineWidth: 2, gap: 3, align: 'global', offsetX: 4, offsetY: 5,
    });
    editor.setTool('bucket');
    const pattern = {
      type: document.querySelector('#toolOptionPatternType')?.value,
      lineWidth: Number(document.querySelector('#toolOptionPatternLineWidth')?.value),
      gap: Number(document.querySelector('#toolOptionPatternGap')?.value),
      align: document.querySelector('#toolOptionPatternAlign')?.value,
      offsetX: Number(document.querySelector('#toolOptionPatternOffsetX')?.value),
      offsetY: Number(document.querySelector('#toolOptionPatternOffsetY')?.value),
    };
    return {
      tool: editor.tool,
      exists: Boolean(button),
      section: button?.closest('.tool-section')?.querySelector('.tool-section-title')?.textContent?.trim(),
      modes,
      dither,
      pattern,
    };
  });

  expect(result.tool).toBe('bucket');
  expect(result.exists).toBe(true);
  expect(result.section).toBe('编辑');
  expect(result.modes).toEqual(['transparent', 'solid', 'dither', 'pattern']);
  expect(result.dither).toEqual({ type: 'blueNoise', density: 37, matrix: 8, align: 'object', offsetX: 2, offsetY: -3 });
  expect(result.pattern).toEqual({ type: 'diagSlash', lineWidth: 2, gap: 3, align: 'global', offsetX: 4, offsetY: 5 });
});

test('bucket flood fill respects raster boundaries, patterns, transparency and history', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const PE = window.PixelEditor;
    const M = PE.model;
    const C = PE.commands;
    const T = PE.tristateRaster;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const w = 7;
    const h = 5;
    const pixels = new Uint8Array(w * h);
    pixels.fill(T.RASTER_WHITE);
    for (let y = 0; y < h; y += 1) pixels[y * w + 3] = T.RASTER_BLACK;
    const raster = M.createNode('raster', { parentId: p.id, x: 20, y: 30, w, h, pixels });
    editor.exec(new C.AddNodesCommand([raster], p.id));
    editor.state.selection.replace([raster.id]);
    const currentPixels = () => [...T.pixelsFromRasterNode(M.nodeById(editor.activePage(), raster.id))];

    editor.setToolDefault('bucket', 'fill', { mode: 'pattern', color: 1 });
    editor.setToolDefault('bucket', 'pattern', {
      type: 'horizontal', lineWidth: 1, gap: 1, align: 'object', offsetX: 0, offsetY: 0,
    });
    editor.setTool('bucket');
    const patternChanged = editor.bucketFillAt({ x: 21, y: 31 });
    const patterned = currentPixels();

    editor.bus.undo();
    const undone = currentPixels();
    editor.bus.redo();
    const redone = currentPixels();

    editor.bus.undo();
    editor.state.selection.replace([raster.id]);
    editor.pageSelectedId = null;
    editor.setToolDefault('bucket', 'fill', { mode: 'transparent', color: 1 });
    editor.setTool('bucket');
    const transparentChanged = editor.bucketFillAt({ x: 21, y: 31 });
    const transparent = currentPixels();
    return { patternChanged, transparentChanged, patterned, undone, redone, transparent, w, h };
  });

  expect(result.patternChanged).toBe(true);
  expect(result.transparentChanged).toBe(true);
  for (let y = 0; y < result.h; y += 1) {
    for (let x = 0; x < result.w; x += 1) {
      const index = y * result.w + x;
      if (x < 3) {
        expect(result.patterned[index]).toBe(y % 2 === 0 ? 2 : 1);
        expect(result.transparent[index]).toBe(0);
      } else if (x === 3) {
        expect(result.patterned[index]).toBe(2);
        expect(result.transparent[index]).toBe(2);
      } else {
        expect(result.patterned[index]).toBe(1);
        expect(result.transparent[index]).toBe(1);
      }
      expect(result.undone[index]).toBe(x === 3 ? 2 : 1);
      expect(result.redone[index]).toBe(result.patterned[index]);
    }
  }
});

test('rotated transform properties stay integer and resize cursor follows transformed handle direction', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const PE = window.PixelEditor;
    const M = PE.model;
    const C = PE.commands;
    const G = PE.selectionGeometry;
    const S = PE.selectionOverlay;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const rect = M.createNode('rectangle', {
      parentId: p.id, x: 80, y: 70, w: 40, h: 40,
      transform: { rotation: 45, flipX: false, flipY: false },
    });
    editor.exec(new C.AddNodesCommand([rect], p.id));
    editor.state.selection.replace([rect.id]);
    editor.pageSelectedId = null;
    editor.setTool('pointer');
    editor.renderAll();
    const values = ['propX', 'propY', 'propW', 'propH'].map(id => document.querySelector(`#${id}`)?.value ?? '');
    const pivot = S.sourcePivotBounds(editor, rect);
    const geometry = G.selectionGeometry(rect, pivot);
    const handle = geometry.handles.se;
    const bounds = editor.canvas.getBoundingClientRect();
    const event = new PointerEvent('pointermove', {
      bubbles: true,
      clientX: bounds.left + handle.x * bounds.width / 400,
      clientY: bounds.top + handle.y * bounds.height / 300,
    });
    editor.canvas.dispatchEvent(event);
    const cursor = editor.canvas.style.cursor;
    return {
      values,
      cursor,
      translations: [rect.transform.translateX || 0, rect.transform.translateY || 0],
    };
  });

  expect(result.values).toHaveLength(4);
  for (const value of result.values) expect(Number.isInteger(Number(value))).toBe(true);
  expect(result.cursor).toBe('ns-resize');
  for (const value of result.translations) expect(Number.isInteger(value)).toBe(true);
});

test('text tool defaults expose horizontal and vertical alignment and new text snapshots them', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    editor.setTool('text');
    const initial = {
      h: document.querySelector('#toolOptionAlignH')?.value,
      v: document.querySelector('#toolOptionAlignV')?.value,
    };
    const h = document.querySelector('#toolOptionAlignH');
    h.value = 'center';
    h.dispatchEvent(new Event('change', { bubbles: true }));
    const v = document.querySelector('#toolOptionAlignV');
    v.value = 'middle';
    v.dispatchEvent(new Event('change', { bubbles: true }));
    editor.beginLiveDraw('text', { x: 11, y: 13 });
    const node = window.PixelEditor.model.nodeById(editor.activePage(), editor.customGesture?.nodeId);
    const snapshot = node ? { alignH: node.alignH, alignV: node.alignV } : null;
    const defaults = editor.getToolDefaults('text');
    editor.cancelCustomGesture();
    return { initial, snapshot, defaults: { alignH: defaults.alignH, alignV: defaults.alignV } };
  });

  expect(result.initial).toEqual({ h: 'left', v: 'top' });
  expect(result.snapshot).toEqual({ alignH: 'center', alignV: 'middle' });
  expect(result.defaults).toEqual({ alignH: 'center', alignV: 'middle' });
});
