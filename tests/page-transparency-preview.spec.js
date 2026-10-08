import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

const digest = buffer => createHash('sha256').update(buffer).digest('hex');

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(() => window.PixelEditorTest.editor.newProject({ force: true }));
}

test('整个页面的透明预览覆盖所有可见图层，忽略选中状态并保持导出像素不变', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const R = window.PixelEditorDebug.services.renderer;
    const p = editor.activePage();
    const solid = M.createNode('rectangle', { parentId: p.id, x: 10, y: 10, w: 3, h: 1,
      fill: { mode: 'solid', color: 0 }, stroke: { width: 0, color: 1, style: 'solid' } });
    const raster = M.createNode('raster', { parentId: p.id, x: 10, y: 10, w: 4, h: 1,
      pixels: Uint8Array.from([0, 1, 2, 0]) });
    const hidden = M.createNode('rectangle', { parentId: p.id, x: 30, y: 30, w: 2, h: 2,
      fill: { mode: 'solid', color: 1 }, visible: false });
    editor.exec(new C.AddNodesCommand([solid, raster, hidden], p.id));
    editor.state.selection.clear();
    editor.renderAll();
    const pixelBefore = [...R.FramebufferRenderer.renderPage(editor.state.project, p.id, editor.state.assets)];
    const before = editor.transparencyCanvas.getContext('2d').getImageData(10, 10, 4, 1).data;
    editor.setTransparencyPreview(true);
    const ctx = editor.transparencyCanvas.getContext('2d');
    const a = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
    const alpha = { coveredByLower: a(10,10), opaqueWhite: a(11,10), opaqueBlack: a(12,10),
      uncovered: a(13,10), blank: a(0,0), hidden: a(30,30) };
    const coverage = R.FramebufferRenderer.renderContentCoverage(editor.state.project, p.id, editor.state.assets);
    editor.state.selection.replace([raster.id]); editor.renderOverlay();
    const selectedAlpha = a(13,10);
    editor.state.selection.clear(); editor.renderOverlay();
    const deselectedAlpha = a(13,10);
    const pixelAfter = [...R.FramebufferRenderer.renderPage(editor.state.project, p.id, editor.state.assets)];
    editor.setTransparencyPreview(false);
    return { initialAlpha: before[3], alpha, mask: [coverage[10*400+10],coverage[10*400+11],coverage[10*400+12],coverage[10*400+13]],
      selectedAlpha, deselectedAlpha, afterClose: a(13,10),
      framebufferUnchanged: pixelBefore.every((v,i)=>v===pixelAfter[i]) };
  });
  expect(result.initialAlpha).toBe(0);
  expect(result.mask).toEqual([1,1,1,0]);
  expect(result.alpha).toEqual({ coveredByLower:0, opaqueWhite:0, opaqueBlack:0,
    uncovered:82, blank:82, hidden:82 });
  expect(result.selectedAlpha).toBe(82);
  expect(result.deselectedAlpha).toBe(82);
  expect(result.afterClose).toBe(0);
  expect(result.framebufferUnchanged).toBe(true);
});

test('叠加画布在开关前后改变真实截图，关闭后恢复一致', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const p = editor.activePage();
    editor.exec(new C.AddNodesCommand([M.createNode('rectangle', {
      parentId: p.id, x: 30, y: 40, w: 40, h: 30,
      fill: { mode: 'solid', color: 1 }, stroke: { width: 0, color: 1, style: 'solid' },
    })],p.id));
    editor.state.selection.clear();
    editor.setZoom(2);
    editor.renderAll();
    editor.setTransparencyPreview(false);
  });
  const btn = page.locator('#transparencyPreviewBtn');
  const canvas = page.locator('#stage');
  const before = digest(await canvas.screenshot());
  await btn.click();
  const after = digest(await canvas.screenshot());
  expect(await btn.getAttribute('aria-pressed')).toBe('true');
  expect(after).not.toBe(before);
  await btn.click();
  expect(await btn.getAttribute('aria-pressed')).toBe('false');
  expect(digest(await canvas.screenshot())).toBe(before);
});

test('图层编辑、隐藏和页面切换时，全页透明覆盖实时刷新', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const p = editor.activePage();
    editor.setTransparencyPreview(true);
    const a = (x,y) => editor.transparencyCanvas.getContext('2d').getImageData(x,y,1,1).data[3];
    const empty = a(8,8);
    const rectangle = M.createNode('rectangle', { parentId:p.id,x:8,y:8,w:3,h:3,
      fill:{mode:'solid',color:1}, stroke:{width:0,color:1,style:'solid'} });
    editor.exec(new C.AddNodesCommand([rectangle],p.id));
    editor.renderAll();
    const afterCreate = a(8,8);
    editor.exec(new C.UpdateNodesCommand([rectangle.id], { visible:false },p.id));
    editor.renderAll();
    const afterHide = a(8,8);
    editor.exec(new C.CreatePageCommand('第二页'));
    editor.renderAll();
    const otherPage = a(8,8);
    return {empty,afterCreate,afterHide,otherPage};
  });
  expect(result).toEqual({empty:82,afterCreate:0,afterHide:82,otherPage:82});
});
