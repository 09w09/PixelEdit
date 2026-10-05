import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('every supported visual node type rasterizes into non-empty fixed tri-state pixels', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    window.confirm = () => true;
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const T = window.PixelEditorDebug.services.tristateRaster;
    const results = {};

    const makeProps = type => {
      const stroke = { width: 1, color: 1, style: 'solid' };
      if (type === 'rectangle') return { x: 10, y: 10, w: 20, h: 12, stroke, fill: { mode: 'solid' } };
      if (type === 'circle') return { x: 10, y: 10, w: 20, h: 20, stroke, fill: { mode: 'solid' } };
      if (type === 'line') return { x1: 10, y1: 10, x2: 30, y2: 20, stroke: { width: 2, color: 1, style: 'solid' } };
      if (type === 'polygon') return { points: [{ x: 10, y: 25 }, { x: 20, y: 10 }, { x: 30, y: 25 }], stroke, fill: { mode: 'solid' } };
      return { x: 10, y: 10, w: 50, h: 25, text: 'A', fontSize: 18, wrap: false };
    };

    for (const type of ['rectangle', 'circle', 'line', 'polygon', 'text']) {
      editor.newProject({ force: true });
      const active = editor.activePage();
      const node = M.createNode(type, { parentId: active.id, ...makeProps(type) });
      editor.exec(new C.AddNodesCommand([node], active.id));
      editor.state.selection.replace([node.id]);
      const ok = await editor.rasterizeSelected();
      const raster = M.nodeById(active, node.id);
      const pixels = raster?.type === 'raster' ? T.decodeTriStatePixels(raster.raster.data, raster.w, raster.h) : null;
      results[type] = { ok, type: raster?.type, black: pixels ? [...pixels].filter(value => value === T.RASTER_BLACK).length : 0 };
    }
    return results;
  });

  for (const type of ['rectangle', 'circle', 'line', 'polygon', 'text']) {
    expect(result[type].ok).toBe(true);
    expect(result[type].type).toBe('raster');
    expect(result[type].black).toBeGreaterThan(0);
  }
});

test('already-flat raster refuses redundant rasterization and raster properties omit source-image controls', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    window.confirm = () => true;
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const raster = M.createNode('raster', { parentId: active.id, x: 2, y: 3, w: 4, h: 4, pixels: Uint8Array.from([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2]) });
    editor.exec(new C.AddNodesCommand([raster], active.id));
    editor.state.selection.replace([raster.id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    const before = editor.state.project.pages[0].nodes.length;
    const ok = await editor.rasterizeSelected();
    return {
      ok,
      countStable: editor.state.project.pages[0].nodes.length === before,
      hasImageFit: Boolean(document.querySelector('#propImageFit')),
      text: document.querySelector('#properties')?.textContent || '',
    };
  });
  expect(result.ok).toBe(false);
  expect(result.countStable).toBe(true);
  expect(result.hasImageFit).toBe(false);
  expect(result.text).toContain('黑、白、透明三态');
});

test('live northwest raster resize preserves black pixels by translation and participates in undo redo', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const T = window.PixelEditorDebug.services.tristateRaster;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const raster = M.createNode('raster', { parentId: active.id, x: 10, y: 10, w: 2, h: 2, pixels: Uint8Array.from([2, 0, 0, 2]) });
    editor.exec(new C.AddNodesCommand([raster], active.id));
    editor.state.selection.replace([raster.id]);
    const handle = { type: 'resize', corner: 'nw', node: raster, startBounds: { x: 10, y: 10, w: 2, h: 2 } };
    editor.beginLiveHandle(handle, { x: 10, y: 10 });
    const gesture = editor.customGesture;
    editor.updateLiveResize(gesture, { x: 9, y: 9 });
    const live = M.nodeById(editor.activePage(), raster.id);
    const livePixels = T.decodeTriStatePixels(live.raster.data, live.w, live.h);
    const liveBlack = [];
    for (let y = 0; y < live.h; y++) for (let x = 0; x < live.w; x++) if (livePixels[y * live.w + x] === T.RASTER_BLACK) liveBlack.push([x, y]);
    const committed = editor.commitLiveHandle(gesture);
    const afterCommit = structuredClone(M.nodeById(editor.activePage(), raster.id));
    const undo = editor.bus.undo();
    const afterUndo = structuredClone(M.nodeById(editor.activePage(), raster.id));
    const redo = editor.bus.redo();
    const afterRedo = structuredClone(M.nodeById(editor.activePage(), raster.id));
    return {
      liveGeom: { x: live.x, y: live.y, w: live.w, h: live.h },
      liveBlack,
      committed,
      afterCommit: { x: afterCommit.x, y: afterCommit.y, w: afterCommit.w, h: afterCommit.h },
      undo,
      afterUndo: { x: afterUndo.x, y: afterUndo.y, w: afterUndo.w, h: afterUndo.h, pixels: [...T.decodeTriStatePixels(afterUndo.raster.data, afterUndo.w, afterUndo.h)] },
      redo,
      afterRedo: { x: afterRedo.x, y: afterRedo.y, w: afterRedo.w, h: afterRedo.h, pixels: [...T.decodeTriStatePixels(afterRedo.raster.data, afterRedo.w, afterRedo.h)] },
    };
  });
  expect(result.liveGeom).toEqual({ x: 9, y: 9, w: 3, h: 3 });
  expect(result.liveBlack).toEqual([[1, 1], [2, 2]]);
  expect(result.committed).toBe(true);
  expect(result.afterCommit).toEqual({ x: 9, y: 9, w: 3, h: 3 });
  expect(result.undo).toBe(true);
  expect(result.afterUndo).toEqual({ x: 10, y: 10, w: 2, h: 2, pixels: [2, 0, 0, 2] });
  expect(result.redo).toBe(true);
  expect(result.afterRedo).toEqual({ x: 9, y: 9, w: 3, h: 3, pixels: [0, 0, 0, 0, 2, 0, 0, 0, 2] });
});
