import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

const selectionTitles = [
  '左对齐', '水平居中对齐', '右对齐',
  '顶对齐', '垂直居中对齐', '底对齐',
  '水平分布', '垂直分布',
  '水平翻转', '垂直翻转',
  '顺时针旋转 90°', '逆时针旋转 90°',
];

test('global and active-tool controls are split into two toolbar rows', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const globalBar = document.querySelector('#globalToolbar');
    const toolBar = document.querySelector('#toolOptionsBar');
    const propertiesTitle = document.querySelector('#rightTopPane .dock-title')?.textContent?.trim();
    const buttons = [...(toolBar?.querySelectorAll('button[data-tool-action]') || [])];
    return {
      globalExists: Boolean(globalBar),
      toolExists: Boolean(toolBar),
      globalHasAlign: Boolean(globalBar?.querySelector('[data-align],[data-distribute],[data-tool-action]')),
      propertiesTitle,
      toolButtonTitles: buttons.map(button => button.getAttribute('title')),
      toolButtonsHaveOnlySvg: buttons.every(button => Boolean(button.querySelector('svg')) && button.textContent.trim() === ''),
      toolButtonsHaveAria: buttons.every(button => button.getAttribute('aria-label') === button.getAttribute('title')),
      undo: {
        title: document.querySelector('#undoBtn')?.getAttribute('title'),
        hasSvg: Boolean(document.querySelector('#undoBtn svg')),
        text: document.querySelector('#undoBtn')?.textContent?.trim(),
      },
      redo: {
        title: document.querySelector('#redoBtn')?.getAttribute('title'),
        hasSvg: Boolean(document.querySelector('#redoBtn svg')),
        text: document.querySelector('#redoBtn')?.textContent?.trim(),
      },
    };
  });
  expect(result.globalExists).toBe(true);
  expect(result.toolExists).toBe(true);
  expect(result.globalHasAlign).toBe(false);
  expect(result.propertiesTitle).toBe('元素属性');
  for (const title of selectionTitles) expect(result.toolButtonTitles).toContain(title);
  expect(result.toolButtonsHaveOnlySvg).toBe(true);
  expect(result.toolButtonsHaveAria).toBe(true);
  expect(result.undo).toEqual({ title: '撤销', hasSvg: true, text: '' });
  expect(result.redo).toEqual({ title: '重做', hasSvg: true, text: '' });
});

test('second row exposes only the active tool creation defaults', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const snapshot = tool => {
      editor.setTool(tool);
      return {
        width: Boolean(document.querySelector('#toolOptionWidth')),
        color: Boolean(document.querySelector('#toolOptionColor')),
        style: Boolean(document.querySelector('#toolOptionStyle')),
        selectionActionCount: document.querySelectorAll('#toolOptionsBar [data-tool-action]').length,
      };
    };
    return {
      pointer: snapshot('pointer'),
      select: snapshot('select'),
      pencil: snapshot('pencil'),
      eraser: snapshot('eraser'),
      line: snapshot('line'),
      rectangle: snapshot('rectangle'),
      circle: snapshot('circle'),
      polygon: snapshot('polygon'),
      text: snapshot('text'),
    };
  });
  expect(result.pointer.selectionActionCount).toBeGreaterThanOrEqual(12);
  expect(result.select.selectionActionCount).toBeGreaterThanOrEqual(12);
  expect(result.pencil).toEqual({ width: true, color: true, style: false, selectionActionCount: 0 });
  expect(result.eraser).toEqual({ width: true, color: false, style: false, selectionActionCount: 0 });
  for (const tool of ['line', 'rectangle', 'circle', 'polygon']) {
    expect(result[tool]).toEqual({ width: true, color: true, style: true, selectionActionCount: 0 });
  }
  expect(result.text).toEqual({ width: false, color: false, style: false, selectionActionCount: 0 });
});

test('per-tool defaults persist locally and never mutate existing nodes', async ({ page }) => {
  await openEditor(page);
  const first = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const existing = M.createNode('line', {
      parentId: active.id, x1: 2, y1: 2, x2: 20, y2: 2,
      stroke: { width: 1, color: 1, style: 'solid' },
    });
    editor.exec(new C.AddNodesCommand([existing], active.id));
    editor.setTool('line');
    const width = document.querySelector('#toolOptionWidth');
    const color = document.querySelector('#toolOptionColor');
    const style = document.querySelector('#toolOptionStyle');
    width.value = '4'; width.dispatchEvent(new Event('change', { bubbles: true }));
    color.value = '0'; color.dispatchEvent(new Event('change', { bubbles: true }));
    style.value = 'dash-dot'; style.dispatchEvent(new Event('change', { bubbles: true }));
    editor.setTool('pencil');
    editor.setTool('line');
    return {
      defaults: editor.getToolDefaults('line'),
      existingStroke: M.nodeById(active, existing.id).stroke,
      stored: JSON.parse(localStorage.getItem('pixeledit:v17:preferences')).tools.line,
      controls: {
        width: document.querySelector('#toolOptionWidth').value,
        color: document.querySelector('#toolOptionColor').value,
        style: document.querySelector('#toolOptionStyle').value,
      },
    };
  });
  expect(first.defaults).toEqual({ width: 4, color: 0, style: 'dash-dot' });
  expect(first.existingStroke).toEqual({ width: 1, color: 1, style: 'solid' });
  expect(first.stored).toEqual({ width: 4, color: 0, style: 'dash-dot' });
  expect(first.controls).toEqual({ width: '4', color: '0', style: 'dash-dot' });

  await page.reload();
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  const restored = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.setTool('line');
    return {
      defaults: editor.getToolDefaults('line'),
      width: document.querySelector('#toolOptionWidth').value,
      color: document.querySelector('#toolOptionColor').value,
      style: document.querySelector('#toolOptionStyle').value,
    };
  });
  expect(restored).toEqual({
    defaults: { width: 4, color: 0, style: 'dash-dot' },
    width: '4', color: '0', style: 'dash-dot',
  });
});

test('row-one transparency toggle is a persisted editor preference', async ({ page }) => {
  await openEditor(page);
  const state = await page.evaluate(() => {
    const button = document.querySelector('#transparencyPreviewBtn');
    const before = button?.getAttribute('aria-pressed');
    button?.click();
    const after = button?.getAttribute('aria-pressed');
    const stored = JSON.parse(localStorage.getItem('pixeledit:v17:preferences'));
    return { before, after, stored: stored.transparencyPreview, title: button?.getAttribute('title') };
  });
  expect(state.before).toBe('false');
  expect(state.after).toBe('true');
  expect(state.stored).toBe(true);
  expect(state.title).toMatch(/透明/);
});
