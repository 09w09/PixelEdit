import { expect, test } from '@playwright/test';

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('unsaved project is preserved when opening another project is rejected', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const P = window.PixelEditorDebug.services.persistence;
    editor.newProject({ force: true });
    window.PixelEditorTest.createNode('rectangle', { x: 3, y: 5, w: 10, h: 10 });
    const before = window.PixelEditorTest.serialize();
    window.confirm = () => false;
    const candidate = P.ProjectSerializer.deserialize(P.ProjectSerializer.serialize(M.createProject(), new M.AssetStore()));
    const changed = await editor.loadProjectCandidate({ ...candidate, name: 'other.pix' });
    return { changed, intact: window.PixelEditorTest.serialize() === before, dirty: editor.state.dirty };
  });
  expect(result).toEqual({ changed: false, intact: true, dirty: true });
});

test('corrupted image project fails atomically and does not destroy the current project', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    editor.newProject({ force: true });
    window.PixelEditorTest.createNode('rectangle', { x: 3, y: 3 });
    const before = window.PixelEditorTest.serialize();
    const project = M.createProject(), assets = new M.AssetStore();
    const assetId = assets.add('image', 'data:image/png;base64,AA==', { name: 'broken.png', mime: 'image/png' });
    project.pages[0].nodes.push(M.createNode('image', { parentId: project.pages[0].id, assetId }));
    window.confirm = () => true;
    let message = '';
    try { await editor.loadProjectCandidate({ project, assets, name: 'broken.pix' }); }
    catch (error) { message = error.message; }
    return { intact: window.PixelEditorTest.serialize() === before, failed: message.includes('无法恢复工程资源') };
  });
  expect(result).toEqual({ intact: true, failed: true });
});

test('SVG clipboards duplicate without attempting to clone browser Image objects', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="black"/></svg>';
    const node = await editor.importSvgText(svg, 'vector.svg');
    editor.state.selection.replace([node.id]);
    const payload = editor.copySelection();
    const pasted = editor.pasteClipboard();
    const selected = editor.state.selection.primaryId;
    return {
      copied: Boolean(payload?.assetRecords?.length),
      pasted,
      runtime: Boolean(editor.state.assets.getRuntime(node.assetId)),
      distinct: node.id !== selected,
    };
  });
  expect(result).toEqual({ copied: true, pasted: true, runtime: true, distinct: true });
});

test('imported project rejects forged node types and identifiers', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const P = window.PixelEditorDebug.services.persistence;
    const base = JSON.parse(P.ProjectSerializer.serialize(M.createProject(), new M.AssetStore()));
    const malicious = M.createNode('rectangle', { parentId: base.pages[0].id });
    malicious.type = '<img src=x onerror=alert(1)>';
    base.pages[0].nodes.push(malicious);
    let typeRejected = false, idRejected = false;
    try { P.ProjectSerializer.deserialize(JSON.stringify(base)); }
    catch { typeRejected = true; }
    base.pages[0].nodes[0].type = 'rectangle';
    base.pages[0].nodes[0].id = '" onmouseover="alert(1)';
    try { P.ProjectSerializer.deserialize(JSON.stringify(base)); }
    catch { idRejected = true; }
    return { typeRejected, idRejected, unchanged: editor.activePage().nodes.length === 0 };
  });
  expect(result).toEqual({ typeRejected: true, idRejected: true, unchanged: true });
});

test('malicious external SVG references and oversized input are rejected', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const editor = window.PixelEditorTest.editor;
    let svgRejected = false, sizeRejected = false;
    try { await editor.importSvgText('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="https://example.com/a.png"/></svg>'); }
    catch { svgRejected = true; }
    try { await editor.importSvgText('<svg xmlns="http://www.w3.org/2000/svg" width="999999" height="999999"></svg>'); }
    catch { sizeRejected = true; }
    return { svgRejected, sizeRejected };
  });
  expect(result).toEqual({ svgRejected: true, sizeRejected: true });
});

test('quota errors are visible and autosave does not silently report success', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const P = window.PixelEditorDebug.services.persistence;
    const autosave = new P.Autosave(editor.state, { setItem() { throw new Error('quota full'); } });
    let error = '';
    try { autosave.run(); } catch (caught) { error = caught.message; }
    return { error, recorded: autosave.lastError?.message };
  });
  expect(result.error).toContain('自动保存失败');
  expect(result.recorded).toContain('quota full');
});

test('undo to saved checkpoint restores clean state', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    window.PixelEditorTest.createNode('rectangle', { x: 2, y: 2 });
    editor.bus.markSaved();
    window.PixelEditorTest.createNode('circle', { x: 10, y: 10 });
    const afterEdit = editor.state.dirty;
    editor.bus.undo();
    const afterUndo = editor.state.dirty;
    editor.bus.redo();
    return { afterEdit, afterUndo, afterRedo: editor.state.dirty };
  });
  expect(result).toEqual({ afterEdit: true, afterUndo: false, afterRedo: true });
});
