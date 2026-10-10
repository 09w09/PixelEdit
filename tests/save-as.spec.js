import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('Save overwrites the active file; Save As and Ctrl+Shift+S pick a different file', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    window.PixelEditorTest.createNode('rectangle', { x: 4, y: 4, w: 20, h: 20 });
    // Keep each write log on the handle returned by the picker.
    const makeHandle = name => {
      const h = { name, writes: [] };
      h.createWritable = async () => {
        let content;
        return { write: async raw => { content = raw; }, close: async () => { h.writes.push(content); } };
      };
      return h;
    };
    window.__saveAsMock = { handles: [makeHandle('first.pix'), makeHandle('second.pix'), makeHandle('third.pix')], pickerCalls: 0 };
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => window.__saveAsMock.handles[window.__saveAsMock.pickerCalls++],
    });
  });

  await page.locator('#saveBtn').click();
  await expect.poll(() => page.evaluate(() => window.__saveAsMock.handles[0].writes.length)).toBe(1);
  expect(await page.evaluate(() => window.PixelEditorTest.editor.state.dirty)).toBe(false);

  await page.evaluate(() => window.PixelEditorTest.createNode('circle', { x: 40, y: 4, w: 15, h: 15 }));
  await page.locator('#saveBtn').click();
  await expect.poll(() => page.evaluate(() => window.__saveAsMock.handles[0].writes.length)).toBe(2);
  expect(await page.evaluate(() => window.__saveAsMock.pickerCalls)).toBe(1);

  await page.locator('#saveAsBtn').click();
  await expect.poll(() => page.evaluate(() => window.__saveAsMock.handles[1].writes.length)).toBe(1);

  await page.evaluate(() => window.PixelEditorTest.createNode('rectangle', { x: 65, y: 4, w: 10, h: 10 }));
  await page.locator('#saveBtn').click();
  await expect.poll(() => page.evaluate(() => window.__saveAsMock.handles[1].writes.length)).toBe(2);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const mock = window.__saveAsMock;
    const Serializer = window.PixelEditorDebug.services.persistence.ProjectSerializer;
    const before = Serializer.deserialize(mock.handles[0].writes.at(-1));
    const after = Serializer.deserialize(mock.handles[1].writes.at(-1));
    return {
      filename: editor.state.projectFileName,
      boundToSecond: editor.state.projectFileHandle === mock.handles[1],
      pickerCalls: mock.pickerCalls,
      firstWrites: mock.handles[0].writes.length,
      secondWrites: mock.handles[1].writes.length,
      oldNodes: before.project.pages[0].nodes.length,
      newNodes: after.project.pages[0].nodes.length,
      dirty: editor.state.dirty,
    };
  });
  expect(result).toEqual({
    filename: 'second.pix',
    boundToSecond: true,
    pickerCalls: 2,
    firstWrites: 2,
    secondWrites: 2,
    oldNodes: 2,
    newNodes: 3,
    dirty: false,
  });

  await page.evaluate(() => window.PixelEditorTest.createNode('rectangle', { x: 90, y: 4 }));
  await page.keyboard.press('Control+Shift+S');
  await expect.poll(() => page.evaluate(() => window.__saveAsMock.handles[2].writes.length)).toBe(1);
  expect(await page.evaluate(() => ({
    name: window.PixelEditorTest.editor.state.projectFileName,
    dirty: window.PixelEditorTest.editor.state.dirty,
    pickerCalls: window.__saveAsMock.pickerCalls,
  }))).toEqual({ name: 'third.pix', dirty: false, pickerCalls: 3 });
});

test('cancelled picker and failed writes preserve the original handle and dirty changes', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    window.PixelEditorTest.createNode('rectangle', { x: 3, y: 5 });
    const original = {
      name: 'original.pix',
      writes: [],
      async createWritable() {
        let raw;
        return { write: async value => { raw = value; }, close: async () => { original.writes.push(raw); } };
      },
    };
    editor.state.projectFileHandle = original;
    editor.state.projectFileName = original.name;
    await editor.saveProject();
    window.PixelEditorTest.createNode('circle', { x: 7, y: 11 });
    const before = window.PixelEditorTest.serialize();
    let aborted = false;
    let alerted = '';
    window.alert = message => { alerted = message; };
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => { throw new DOMException('cancelled', 'AbortError'); },
    });
    const canceled = await editor.saveProjectAs();
    const unchangedOnCancel = editor.state.dirty && editor.state.projectFileHandle === original
      && editor.state.projectFileName === 'original.pix' && window.PixelEditorTest.serialize() === before;
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'broken.pix',
        async createWritable() {
          return {
            write: async () => { throw new Error('disk full'); },
            close: async () => {},
            abort: async () => { aborted = true; },
          };
        },
      }),
    });
    const failed = await editor.saveProjectAs();
    return {
      canceled, failed, unchangedOnCancel, aborted,
      stillDirty: editor.state.dirty,
      stillBound: editor.state.projectFileHandle === original,
      stillNamed: editor.state.projectFileName === original.name,
      stillIntact: window.PixelEditorTest.serialize() === before,
      oldWrites: original.writes.length,
      alerted,
    };
  });
  expect(result).toMatchObject({
    canceled: false, failed: false, unchangedOnCancel: true, aborted: true,
    stillDirty: true, stillBound: true, stillNamed: true, stillIntact: true, oldWrites: 1,
  });
  expect(result.alerted).toContain('disk full');
});

test('layer Save As downloads a real PNG for non-image shapes', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const nodeId = window.PixelEditorTest.createNode('rectangle', { x: 20, y: 25, w: 28, h: 18 });
    editor.state.selection.replace([nodeId]);
    editor.openContextMenu({ source: 'layers', nodeId, clientX: 10, clientY: 10 });
  });
  const item = page.locator('#contextMenu [data-context-command="save-image"]');
  await expect(item).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await item.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(0);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(0);
  expect(bytes.readUInt32BE(16)).toBeLessThanOrEqual(400);
  expect(bytes.readUInt32BE(20)).toBeLessThanOrEqual(300);
});
