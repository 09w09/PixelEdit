import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function createRectangle(page) {
  return page.evaluate(() => window.PixelEditorTest.createNode('rectangle', {
    x: 40, y: 40, w: 80, h: 60,
    fill: { mode: 'solid', color: 1 },
    stroke: { width: 1, color: 1, style: 'solid' },
  }));
}

test('100 continuous numeric inputs preserve focus, coalesce history, and avoid full-panel render storms', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await openEditor(page);
  const id = await createRectangle(page);
  const x = page.locator('#propX');
  await x.focus();

  const metrics = await page.evaluate(async nodeId => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const counts = { properties: 0, canvas: 0, overlay: 0, layers: 0, history: 0 };
    const originals = {
      properties: editor.properties.render.bind(editor.properties),
      canvas: editor.renderCanvas.bind(editor),
      overlay: editor.renderOverlay.bind(editor),
      layers: editor.pageLayers.render.bind(editor.pageLayers),
      history: editor.history.render.bind(editor.history),
    };
    editor.properties.render = (...args) => { counts.properties += 1; return originals.properties(...args); };
    editor.renderCanvas = (...args) => { counts.canvas += 1; return originals.canvas(...args); };
    editor.renderOverlay = (...args) => { counts.overlay += 1; return originals.overlay(...args); };
    editor.pageLayers.render = (...args) => { counts.layers += 1; return originals.layers(...args); };
    editor.history.render = (...args) => { counts.history += 1; return originals.history(...args); };

    const input = document.getElementById('propX');
    const baselineCursor = editor.bus.cursor;
    const start = performance.now();
    for (let index = 0; index < 100; index += 1) {
      input.value = String(41 + index);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const synchronousMs = performance.now() - start;
    const immediate = {
      x: M.nodeById(editor.activePage(), nodeId).x,
      activeId: document.activeElement?.id || null,
      cursorDelta: editor.bus.cursor - baselineCursor,
    };

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      synchronousMs,
      immediate,
      counts,
      finalX: M.nodeById(editor.activePage(), nodeId).x,
      activeId: document.activeElement?.id || null,
      cursorDelta: editor.bus.cursor - baselineCursor,
    };
  }, id);

  expect(metrics.immediate).toEqual({ x: 140, activeId: 'propX', cursorDelta: 1 });
  expect(metrics.finalX).toBe(140);
  expect(metrics.activeId).toBe('propX');
  expect(metrics.cursorDelta).toBe(1);
  expect(metrics.counts.properties).toBe(0);
  expect(metrics.counts.layers).toBe(0);
  expect(metrics.counts.history).toBe(0);
  expect(metrics.counts.canvas).toBeLessThanOrEqual(2);
  expect(metrics.counts.overlay).toBeLessThanOrEqual(2);
  expect(metrics.synchronousMs).toBeLessThan(1500);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
