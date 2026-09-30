import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('new projects serialize as V16 without workspace layout', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const P = window.PixelEditor.persistence;
    editor.newProject({ force: true });
    const raw = P.ProjectSerializer.serialize(editor.state.project, editor.state.assets);
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version,
      hasWorkspaceLayout: Object.hasOwn(parsed, 'workspaceLayout'),
      title: document.title,
      apiVersion: window.PixelEditorTest.version,
    };
  });
  expect(result.version).toBe(16);
  expect(result.hasWorkspaceLayout).toBe(false);
  expect(result.apiVersion).toBe(16);
  expect(result.title).toContain('V16');
});

test('serializer rejects V15 and accepts exact V16', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const P = window.PixelEditor.persistence;
    const M = window.PixelEditor.model;
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const good = JSON.parse(P.ProjectSerializer.serialize(editor.state.project, editor.state.assets));
    const bad = structuredClone(good);
    bad.version = 15;
    let badMessage = '';
    try { P.ProjectSerializer.deserialize(JSON.stringify(bad)); } catch (error) { badMessage = error.message; }
    const restored = P.ProjectSerializer.deserialize(JSON.stringify(good));
    return {
      badMessage,
      restoredVersion: restored.project.version,
      hierarchyValid: new M.TreeModel(restored.project.pages[0]).validateHierarchy(),
    };
  });
  expect(result.badMessage).toContain('V16');
  expect(result.restoredVersion).toBe(16);
  expect(result.hierarchyValid).toBe(true);
});

test('V16 local preferences clamp malformed values and ignore V15 keys', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const prefs = window.PixelEditor.preferences;
    localStorage.setItem('pixel-editor-v15-preferences', JSON.stringify({ workspace: { leftWidth: 499 } }));
    localStorage.setItem(prefs.PREFERENCE_KEY, '{broken');
    const malformed = prefs.loadEditorPreferences(localStorage);
    localStorage.setItem(prefs.PREFERENCE_KEY, JSON.stringify({
      workspace: { leftWidth: -50, rightWidth: 9999, leftSplit: -1, rightSplit: 2 },
      tools: { line: { width: 3, color: 0, style: 'dot' } },
      transparencyPreview: true,
    }));
    const clamped = prefs.loadEditorPreferences(localStorage);
    return { malformed, clamped, key: prefs.PREFERENCE_KEY };
  });
  expect(result.key).toBe('pixeledit:v16:preferences');
  expect(result.malformed.workspace).toEqual({ leftWidth: 260, rightWidth: 320, leftSplit: 0.5, rightSplit: 0.5 });
  expect(result.clamped.workspace.leftWidth).toBe(170);
  expect(result.clamped.workspace.rightWidth).toBe(520);
  expect(result.clamped.workspace.leftSplit).toBeGreaterThan(0);
  expect(result.clamped.workspace.leftSplit).toBeLessThan(1);
  expect(result.clamped.workspace.rightSplit).toBeGreaterThan(0);
  expect(result.clamped.workspace.rightSplit).toBeLessThan(1);
  expect(result.clamped.tools.line).toEqual({ width: 3, color: 0, style: 'dot' });
  expect(result.clamped.transparencyPreview).toBe(true);
});

test('workspace preference updates persist locally without dirtying project', async ({ page }) => {
  await openEditor(page);
  const first = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    editor.state.dirty = false;
    editor.updateWorkspaceLayout({ leftWidth: 333, rightSplit: 0.6 });
    return {
      dirty: editor.state.dirty,
      leftWidth: editor.editorPreferences.workspace.leftWidth,
      rightSplit: editor.editorPreferences.workspace.rightSplit,
      stored: JSON.parse(localStorage.getItem('pixeledit:v16:preferences')),
      projectHasWorkspace: Object.hasOwn(editor.state.project, 'workspaceLayout'),
    };
  });
  expect(first.dirty).toBe(false);
  expect(first.leftWidth).toBe(333);
  expect(first.rightSplit).toBeCloseTo(0.6, 5);
  expect(first.stored.workspace.leftWidth).toBe(333);
  expect(first.projectHasWorkspace).toBe(false);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  const restored = await page.evaluate(() => ({
    leftWidth: window.PixelEditorTest.editor.editorPreferences.workspace.leftWidth,
    rightSplit: window.PixelEditorTest.editor.editorPreferences.workspace.rightSplit,
  }));
  expect(restored.leftWidth).toBe(333);
  expect(restored.rightSplit).toBeCloseTo(0.6, 5);
});
