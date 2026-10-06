import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function seedFontAndTextScript() {
  const editor = window.PixelEditorTest.editor;
  const M = window.PixelEditorDebug.services.model;
  const C = window.PixelEditorDebug.services.commands;
  editor.newProject({ force: true });
  const assetId = editor.state.assets.add('font', 'data:font/woff2;base64,AA==', {
    name: 'TestFont.woff2', mime: 'font/woff2', sha256: 'test-sha',
  });
  const family = 'Imported_test_font';
  editor.state.project.fonts.push({ name: 'TestFont.woff2', family, fixedSize: 18, assetId, sha256: 'test-sha' });
  const first = editor.activePage();
  const text1 = M.createNode('text', { parentId: first.id, x: 0, y: 0, w: 80, h: 30, text: 'A', fontFamily: family, fontSize: 16, fixedFontSize: 18 });
  editor.exec(new C.AddNodesCommand([text1], first.id));
  editor.exec(new C.CreatePageCommand('第二页'));
  const second = editor.activePage();
  const text2 = M.createNode('text', { parentId: second.id, x: 0, y: 0, w: 80, h: 30, text: 'B', fontFamily: family, fontSize: 14, fixedFontSize: 18 });
  editor.exec(new C.AddNodesCommand([text2], second.id));
  return { family, assetId, firstId: first.id, secondId: second.id, text1Id: text1.id, text2Id: text2.id };
}

test('removing an imported font replaces every page reference and preserves effective size', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(seedFontAndTextScript);
  const removed = await page.evaluate(({ family, firstId, secondId, text1Id, text2Id }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const ok = editor.removeImportedFont?.(family);
    const a = M.nodeById(M.pageById(editor.state.project, firstId), text1Id);
    const b = M.nodeById(M.pageById(editor.state.project, secondId), text2Id);
    return {
      ok,
      fonts: editor.state.project.fonts.length,
      a: { family: a.fontFamily, fontSize: a.fontSize, fixed: a.fixedFontSize },
      b: { family: b.fontFamily, fontSize: b.fontSize, fixed: b.fixedFontSize },
    };
  }, result);
  expect(removed.ok).toBe(true);
  expect(removed.fonts).toBe(0);
  expect(removed.a).toEqual({ family: 'sans-serif', fontSize: 18, fixed: null });
  expect(removed.b).toEqual({ family: 'sans-serif', fontSize: 18, fixed: null });
});

test('font removal participates in undo and redo without losing the asset needed by undo', async ({ page }) => {
  await openEditor(page);
  const seeded = await page.evaluate(seedFontAndTextScript);
  const result = await page.evaluate(({ family, assetId, firstId, text1Id }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    editor.removeImportedFont(family);
    const afterRemove = { family: M.nodeById(M.pageById(editor.state.project, firstId), text1Id).fontFamily, asset: editor.state.assets.has(assetId) };
    const undo = editor.bus.undo();
    editor.renderAll();
    const afterUndo = {
      family: M.nodeById(M.pageById(editor.state.project, firstId), text1Id).fontFamily,
      fonts: editor.state.project.fonts.length,
      asset: editor.state.assets.has(assetId),
    };
    const redo = editor.bus.redo();
    editor.renderAll();
    const afterRedo = { family: M.nodeById(M.pageById(editor.state.project, firstId), text1Id).fontFamily, fonts: editor.state.project.fonts.length };
    return { afterRemove, undo, afterUndo, redo, afterRedo };
  }, seeded);
  expect(result.afterRemove).toEqual({ family: 'sans-serif', asset: true });
  expect(result.undo).toBe(true);
  expect(result.afterUndo).toEqual({ family: seeded.family, fonts: 1, asset: true });
  expect(result.redo).toBe(true);
  expect(result.afterRedo).toEqual({ family: 'sans-serif', fonts: 0 });
});

test('default fonts cannot be removed and imported fonts expose remove only in text tool options', async ({ page }) => {
  await openEditor(page);
  const seeded = await page.evaluate(seedFontAndTextScript);
  const result = await page.evaluate(({ family, secondId, text2Id }) => {
    const editor = window.PixelEditorTest.editor;
    editor.selectPage(secondId);
    editor.state.selection.replace([text2Id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    editor.setToolDefault('text', 'fontFamily', family);
    editor.setTool('text');
    const importedToolButton = Boolean(document.querySelector('#toolOptionsBar #removeFontBtn'));
    const propertyButton = Boolean(document.querySelector('#properties #removeFontBtn'));
    const propertyImport = Boolean(document.querySelector('#properties #importFontBtn'));
    const defaultRejected = editor.removeImportedFont?.('sans-serif') === false;
    editor.setToolDefault('text', 'fontFamily', 'sans-serif');
    editor.setTool('text');
    const defaultToolButton = Boolean(document.querySelector('#toolOptionsBar #removeFontBtn'));
    return { importedToolButton, propertyButton, propertyImport, defaultRejected, defaultToolButton };
  }, seeded);
  expect(result).toEqual({
    importedToolButton: true,
    propertyButton: false,
    propertyImport: false,
    defaultRejected: true,
    defaultToolButton: false,
  });
});

test('serialized project after font removal contains no dangling font asset', async ({ page }) => {
  await openEditor(page);
  const seeded = await page.evaluate(seedFontAndTextScript);
  const result = await page.evaluate(({ family }) => {
    const editor = window.PixelEditorTest.editor;
    editor.removeImportedFont(family);
    const raw = window.PixelEditorDebug.services.persistence.ProjectSerializer.serialize(editor.state.project, editor.state.assets);
    const parsed = JSON.parse(raw);
    return { fonts: parsed.fonts.length, fontAssets: parsed.assets.filter(a => a.type === 'font').length };
  }, seeded);
  expect(result).toEqual({ fonts: 0, fontAssets: 0 });
});
