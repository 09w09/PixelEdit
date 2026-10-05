import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('V17 runtime owns version, filenames, preference namespace, and creation defaults', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    return {
      projectVersion: editor.state.project.version,
      runtimeVersion: window.PixelEditorDebug.services.version,
      testVersion: window.PixelEditorTest.version,
      preferenceKey: window.PixelEditorDebug.services.preferences?.PREFERENCE_KEY,
      autosaveKey: window.PixelEditorDebug.services.preferences?.AUTOSAVE_KEY,
      defaultFilename: window.PixelEditorDebug.services.preferences?.DEFAULT_FILENAME,
      text: editor.getToolDefaults('text'),
      rectangle: editor.getToolDefaults('rectangle'),
      pageFill: structuredClone(editor.activePage().fill),
    };
  });

  expect(result.projectVersion).toBe(17);
  expect(result.runtimeVersion).toBe(17);
  expect(result.testVersion).toBe(17);
  expect(result.preferenceKey).toBe('pixeledit:v17:preferences');
  expect(result.autosaveKey).toBe('pixel-editor-v17-autosave');
  expect(result.defaultFilename).toBe('pixel-project-v17.pix');
  expect(result.text).toMatchObject({ fontFamily: 'sans-serif', fontSize: 16, lastScalableFontSize: 16 });
  expect(result.rectangle).toMatchObject({
    width: 1,
    color: 1,
    style: 'solid',
    fill: { mode: 'transparent', color: 1 },
  });
  expect(result.pageFill).toEqual({ mode: 'solid', color: 0 });
  expect(result.pageFill).not.toHaveProperty('value');
});

test('V17 serializer rejects V16 input instead of migrating it', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const P = window.PixelEditorDebug.services.persistence;
    editor.newProject({ force: true });
    const raw = JSON.stringify({ ...structuredClone(editor.state.project), version: 16, assets: [] });
    try {
      P.ProjectSerializer.deserialize(raw);
      return { threw: false, message: '' };
    } catch (error) {
      return { threw: true, message: String(error?.message || error) };
    }
  });
  expect(result.threw).toBe(true);
  expect(result.message).toMatch(/V17/);
});

test('V17 schema rejects deprecated lineWidth and fill.value fields', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const serializer = window.PixelEditorDebug.services.persistence.ProjectSerializer;
    editor.newProject({ force: true });
    const base = structuredClone(editor.state.project);
    const pageId = base.pages[0].id;
    const shape = M.createNode('rectangle', {
      parentId: pageId,
      x: 10,
      y: 10,
      w: 20,
      h: 20,
      stroke: { width: 2, color: 1, style: 'solid' },
      fill: { mode: 'solid', color: 0 },
    });

    const deprecatedStroke = structuredClone(base);
    deprecatedStroke.pages[0].nodes.push({ ...shape, lineWidth: 3 });
    const deprecatedFill = structuredClone(base);
    deprecatedFill.pages[0].nodes.push({ ...shape, fill: { mode: 'solid', color: 1, value: 1 } });

    const check = project => {
      try {
        serializer.validate(project);
        return { threw: false, message: '' };
      } catch (error) {
        return { threw: true, message: String(error?.message || error) };
      }
    };
    return {
      validatorPresent: typeof serializer?.validate === 'function',
      stroke: check(deprecatedStroke),
      fill: check(deprecatedFill),
    };
  });

  expect(result.validatorPresent).toBe(true);
  expect(result.stroke.threw).toBe(true);
  expect(result.stroke.message).toMatch(/lineWidth|V17/);
  expect(result.fill.threw).toBe(true);
  expect(result.fill.message).toMatch(/fill\.value|V17|填充/);
});

test('V17 page background may not be transparent and shape fill is canonical', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const serializer = window.PixelEditorDebug.services.persistence.ProjectSerializer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('circle', {
      parentId: p.id,
      x: 5,
      y: 5,
      w: 12,
      h: 12,
      stroke: { width: 1, color: 0, style: 'dot' },
      fill: { mode: 'solid', color: 0 },
    });
    const invalidBackground = structuredClone(editor.state.project);
    invalidBackground.pages[0].fill = { mode: 'transparent', color: 0 };
    let backgroundRejected = false;
    try { serializer.validate(invalidBackground); } catch { backgroundRejected = true; }
    return {
      node: {
        stroke: structuredClone(node.stroke),
        fill: structuredClone(node.fill),
        hasLineWidth: Object.hasOwn(node, 'lineWidth'),
        hasFillValue: Object.hasOwn(node.fill || {}, 'value'),
      },
      backgroundRejected,
    };
  });

  expect(result.node.stroke).toEqual({ width: 1, color: 0, style: 'dot' });
  expect(result.node.fill).toEqual({ mode: 'solid', color: 0 });
  expect(result.node.hasLineWidth).toBe(false);
  expect(result.node.hasFillValue).toBe(false);
  expect(result.backgroundRejected).toBe(true);
});
