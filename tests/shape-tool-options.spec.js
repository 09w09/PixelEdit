import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function expectedStrokeControls(snapshot) {
  expect(snapshot.width).toBe(true);
  expect(snapshot.color).toBe(true);
  expect(snapshot.style).toBe(true);
}

test('line exposes only stroke defaults while closed shapes also expose fill defaults', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const snapshot = tool => {
      editor.setTool(tool);
      const fillMode = document.querySelector('#toolOptionFillMode');
      const fillColor = document.querySelector('#toolOptionFillColor');
      return {
        width: Boolean(document.querySelector('#toolOptionWidth')),
        color: Boolean(document.querySelector('#toolOptionColor')),
        style: Boolean(document.querySelector('#toolOptionStyle')),
        fillMode: Boolean(fillMode),
        fillColor: Boolean(fillColor),
        fillColorDisabled: fillColor?.disabled ?? null,
        fillModeValue: fillMode?.value ?? null,
        fillColorValue: fillColor?.value ?? null,
      };
    };
    return {
      line: snapshot('line'),
      rectangle: snapshot('rectangle'),
      circle: snapshot('circle'),
      polygon: snapshot('polygon'),
    };
  });

  expectedStrokeControls(result.line);
  expect(result.line).toMatchObject({ fillMode: false, fillColor: false });
  for (const tool of ['rectangle', 'circle', 'polygon']) {
    expectedStrokeControls(result[tool]);
    expect(result[tool]).toMatchObject({
      fillMode: true,
      fillColor: true,
      fillColorDisabled: true,
      fillModeValue: 'transparent',
      fillColorValue: '1',
    });
  }
});

test('closed-shape fill color is enabled only for solid and persists as canonical fill defaults', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    editor.setTool('rectangle');
    const mode = document.querySelector('#toolOptionFillMode');
    const color = document.querySelector('#toolOptionFillColor');
    const initial = { mode: mode?.value, color: color?.value, disabled: color?.disabled };
    if (mode) {
      mode.value = 'solid';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const afterSolid = {
      mode: document.querySelector('#toolOptionFillMode')?.value,
      color: document.querySelector('#toolOptionFillColor')?.value,
      disabled: document.querySelector('#toolOptionFillColor')?.disabled,
      defaults: structuredClone(editor.getToolDefaults('rectangle')),
    };
    const white = document.querySelector('#toolOptionFillColor');
    if (white) {
      white.value = '0';
      white.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return {
      initial,
      afterSolid,
      afterWhite: structuredClone(editor.getToolDefaults('rectangle')),
      stored: JSON.parse(localStorage.getItem('pixeledit:v17:preferences')).tools.rectangle,
    };
  });

  expect(result.initial).toEqual({ mode: 'transparent', color: '1', disabled: true });
  expect(result.afterSolid.disabled).toBe(false);
  expect(result.afterSolid.defaults.fill).toEqual({ mode: 'solid', color: 1 });
  expect(result.afterWhite.fill).toEqual({ mode: 'solid', color: 0 });
  expect(result.stored.fill).toEqual({ mode: 'solid', color: 0 });
});

test('new shapes snapshot current stroke and fill defaults without mutating existing shapes later', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    editor.newProject({ force: true });
    editor.setToolDefault('rectangle', 'width', 4);
    editor.setToolDefault('rectangle', 'color', 0);
    editor.setToolDefault('rectangle', 'style', 'dash-dot');
    editor.setToolDefault('rectangle', 'fill', { mode: 'solid', color: 0 });
    editor.setTool('rectangle');
    editor.beginLiveDraw('rectangle', { x: 10, y: 10 });
    editor.updateLiveDraw(editor.customGesture, { x: 20, y: 20 });
    const id = editor.customGesture.nodeId;
    const before = structuredClone(M.nodeById(editor.activePage(), id));

    editor.setToolDefault('rectangle', 'width', 1);
    editor.setToolDefault('rectangle', 'color', 1);
    editor.setToolDefault('rectangle', 'style', 'solid');
    editor.setToolDefault('rectangle', 'fill', { mode: 'transparent', color: 1 });
    const after = structuredClone(M.nodeById(editor.activePage(), id));
    editor.cancelCustomGesture();
    return {
      before: { stroke: before.stroke, fill: before.fill },
      after: { stroke: after.stroke, fill: after.fill },
      defaults: editor.getToolDefaults('rectangle'),
    };
  });

  expect(result.before).toEqual({
    stroke: { width: 4, color: 0, style: 'dash-dot' },
    fill: { mode: 'solid', color: 0 },
  });
  expect(result.after).toEqual(result.before);
  expect(result.defaults).toEqual({
    width: 1,
    color: 1,
    style: 'solid',
    fill: { mode: 'transparent', color: 1 },
  });
});
