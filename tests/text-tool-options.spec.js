import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function seedImportedFont(page, { family = 'Imported_fixed_18', fixedSize = 18 } = {}) {
  return page.evaluate(({ family, fixedSize }) => {
    const editor = window.PixelEditorTest.editor;
    const assetId = editor.state.assets.add('font', 'data:font/woff2;base64,AA==', {
      name: fixedSize ? `Demo_${fixedSize}px.woff2` : 'Demo.woff2', mime: 'font/woff2', sha256: `${family}-sha`,
    });
    editor.state.project.fonts.push({ name: fixedSize ? `Demo_${fixedSize}px.woff2` : 'Demo.woff2', family, fixedSize, assetId, sha256: `${family}-sha` });
    editor.renderAll();
    return { family, fixedSize };
  }, { family, fixedSize });
}

test('text tool exposes font and size defaults and new text snapshots them', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    editor.setTool('text');
    editor.setToolDefault('text', 'fontFamily', 'Microsoft YaHei, sans-serif');
    editor.setToolDefault('text', 'fontSize', 27);
    editor.setTool('text');
    const font = document.querySelector('#toolOptionFont');
    const size = document.querySelector('#toolOptionFontSize');
    editor.beginLiveDraw('text', { x: 10, y: 12 });
    const node = window.PixelEditorDebug.services.model.nodeById(editor.activePage(), editor.customGesture?.nodeId);
    const snapshot = node ? { family: node.fontFamily, size: node.fontSize } : null;
    editor.setToolDefault('text', 'fontFamily', 'sans-serif');
    editor.setToolDefault('text', 'fontSize', 33);
    const unchanged = node ? { family: node.fontFamily, size: node.fontSize } : null;
    editor.cancelCustomGesture();
    return {
      fontExists: Boolean(font), sizeExists: Boolean(size),
      fontValue: font?.value, sizeValue: Number(size?.value), snapshot, unchanged,
    };
  });
  expect(result.fontExists).toBe(true);
  expect(result.sizeExists).toBe(true);
  expect(result.fontValue).toBe('Microsoft YaHei, sans-serif');
  expect(result.sizeValue).toBe(27);
  expect(result.snapshot).toEqual({ family: 'Microsoft YaHei, sans-serif', size: 27 });
  expect(result.unchanged).toEqual(result.snapshot);
});

test('fixed-size imported font disables size and scalable fallback restores last size', async ({ page }) => {
  await openEditor(page);
  const seeded = await seedImportedFont(page);
  const result = await page.evaluate(({ family }) => {
    const editor = window.PixelEditorTest.editor;
    editor.setToolDefault('text', 'lastScalableFontSize', 31);
    editor.setToolDefault('text', 'fontSize', 31);
    editor.setToolDefault('text', 'fontFamily', family);
    editor.setTool('text');
    const fixed = {
      family: document.querySelector('#toolOptionFont')?.value,
      size: Number(document.querySelector('#toolOptionFontSize')?.value),
      disabled: document.querySelector('#toolOptionFontSize')?.disabled,
    };
    const familySelect = document.querySelector('#toolOptionFont');
    familySelect.value = 'sans-serif';
    familySelect.dispatchEvent(new Event('change', { bubbles: true }));
    const scalable = {
      family: editor.getToolDefaults('text').fontFamily,
      size: editor.getToolDefaults('text').fontSize,
      last: editor.getToolDefaults('text').lastScalableFontSize,
      disabled: document.querySelector('#toolOptionFontSize')?.disabled,
    };
    return { fixed, scalable };
  }, seeded);
  expect(result.fixed).toEqual({ family: seeded.family, size: 18, disabled: true });
  expect(result.scalable).toEqual({ family: 'sans-serif', size: 31, last: 31, disabled: false });
});

test('font actions render in text tool options and are absent from element properties', async ({ page }) => {
  await openEditor(page);
  const seeded = await seedImportedFont(page, { family: 'Imported_scalable', fixedSize: null });
  const result = await page.evaluate(({ family }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const p = editor.activePage();
    const node = M.createNode('text', { parentId: p.id, x: 5, y: 5, w: 80, h: 30, text: 'A', fontFamily: family, fontSize: 22 });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    editor.setToolDefault('text', 'fontFamily', family);
    editor.setTool('text');
    const importBtn = document.querySelector('#toolOptionsBar #importFontBtn');
    const removeBtn = document.querySelector('#toolOptionsBar #removeFontBtn');
    return {
      importCopy: importBtn?.textContent?.trim(),
      bothExist: Boolean(importBtn && removeBtn),
      sameRow: Boolean(importBtn && removeBtn && importBtn.parentElement === removeBtn.parentElement),
      rowClass: importBtn?.parentElement?.className || '',
      propertyImport: Boolean(document.querySelector('#properties #importFontBtn')),
      propertyRemove: Boolean(document.querySelector('#properties #removeFontBtn')),
    };
  }, seeded);
  expect(result.importCopy).toBe('导入字体');
  expect(result.bothExist).toBe(true);
  expect(result.sameRow).toBe(true);
  expect(result.rowClass).toContain('font-actions');
  expect(result.propertyImport).toBe(false);
  expect(result.propertyRemove).toBe(false);
});

test('removing font selected by text tool falls back without mutating unrelated text', async ({ page }) => {
  await openEditor(page);
  const seeded = await seedImportedFont(page);
  const result = await page.evaluate(({ family }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const p = editor.activePage();
    const unrelated = M.createNode('text', { parentId: p.id, x: 2, y: 2, w: 80, h: 24, text: 'B', fontFamily: 'sans-serif', fontSize: 19 });
    editor.exec(new C.AddNodesCommand([unrelated], p.id));
    editor.setToolDefault('text', 'lastScalableFontSize', 29);
    editor.setToolDefault('text', 'fontSize', 18);
    editor.setToolDefault('text', 'fontFamily', family);
    editor.setTool('text');
    const ok = editor.removeImportedFont(family);
    editor.setTool('text');
    const prefs = editor.getToolDefaults('text');
    const current = M.nodeById(p, unrelated.id);
    return {
      ok,
      prefs,
      sizeDisabled: document.querySelector('#toolOptionFontSize')?.disabled,
      unrelated: { family: current.fontFamily, size: current.fontSize, text: current.text },
    };
  }, seeded);
  expect(result.ok).toBe(true);
  expect(result.prefs.fontFamily).toBe('sans-serif');
  expect(result.prefs.fontSize).toBe(29);
  expect(result.prefs.lastScalableFontSize).toBe(29);
  expect(result.sizeDisabled).toBe(false);
  expect(result.unrelated).toEqual({ family: 'sans-serif', size: 19, text: 'B' });
});
