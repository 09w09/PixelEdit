import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('index is a pure V17 shell without inline V15 core definitions', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  expect(html).not.toContain('PE.version=15');
  expect(html).not.toContain('version:15');
  expect(html).not.toContain('class Workspace');
  expect(html).not.toContain('class CommandBus');
  expect(html).not.toContain('/* model/');
  expect(html).not.toContain('/* commands/');
  expect(html).not.toContain('/* ui/Workspace.js */');
  expect(html).toContain('<script type="module" src="./src/main.js"></script>');
});

test('main no longer upgrades a V15 model through installV17SchemaRuntime', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  expect(main).not.toContain('installV17SchemaRuntime');
  expect(main).toContain("import './core/index.js';");
});

test('application boots directly as canonical V17', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => ({
    namespaceVersion: window.PixelEditor?.version,
    testVersion: window.PixelEditorTest?.version,
    datasetVersion: document.documentElement.dataset.pixelEditor,
  }));
  expect(result).toEqual({ namespaceVersion: 17, testVersion: 17, datasetVersion: 'v17' });
});

test('canonical project/page schema is V17 without legacy workspaceLayout or fill.value', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const project = editor.state.project;
    const pageModel = project.pages[0];
    return {
      version: project.version,
      projectHasWorkspaceLayout: Object.hasOwn(project, 'workspaceLayout'),
      pageFill: pageModel.fill,
      pageFillHasValue: Object.hasOwn(pageModel.fill || {}, 'value'),
      nodeTypes: ['line', 'rectangle', 'circle', 'polygon', 'text', 'image', 'raster'].map(type => {
        const node = window.PixelEditor.model.createNode(type, { parentId: pageModel.id, w: 4, h: 4 });
        return {
          type: node.type,
          hasTransform: Boolean(node.transform),
        };
      }),
    };
  });
  expect(result.version).toBe(17);
  expect(result.projectHasWorkspaceLayout).toBe(false);
  expect(result.pageFillHasValue).toBe(false);
  expect(result.pageFill).toMatchObject({ mode: 'solid', color: expect.any(Number) });
  expect(result.nodeTypes.map(item => item.type)).toEqual(['line', 'rectangle', 'circle', 'polygon', 'text', 'image', 'raster']);
  expect(result.nodeTypes.every(item => item.hasTransform)).toBe(true);
});

test('preferences do not replace persistence classes or register workspace capabilities', async () => {
  const source = await readFile(new URL('../src/preferences/editor-preferences.js', import.meta.url), 'utf8');
  expect(source).not.toContain('P.ProjectFiles = class');
  expect(source).not.toContain('P.Autosave = class');
  expect(source).not.toContain('ProjectFilesV17');
  expect(source).not.toContain('AutosaveV17');
  expect(source).not.toContain('workspaceCapabilities');
});

test('workspace uses the canonical persistence constructors', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    return {
      filesMatch: editor.files?.constructor === window.PixelEditor.persistence.ProjectFiles,
      autosaveMatches: editor.autosave?.constructor === window.PixelEditor.persistence.Autosave,
      hasSaveAs: typeof editor.files?.saveAs === 'function',
      hasAutosaveRun: typeof editor.autosave?.run === 'function',
    };
  });
  expect(result).toEqual({ filesMatch: true, autosaveMatches: true, hasSaveAs: true, hasAutosaveRun: true });
});
