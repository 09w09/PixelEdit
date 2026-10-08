import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    editor.setBackgroundPreview(false);
  });
}

test('默认白底也能临时隐藏背景，但不改变真正的像素和保存状态', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const e = window.PixelEditorTest.editor;
    const R = window.PixelEditorDebug.services.renderer;
    const before = Array.from(e.ctx.getImageData(0,0,1,1).data);
    const real = R.FramebufferRenderer.renderPageComposite(e.state.project, e.activePage().id, e.state.assets);
    const original = JSON.stringify(e.state.project);
    const clean = e.state.dirty;
    e.setBackgroundPreview(true);
    const preview = Array.from(e.ctx.getImageData(0,0,1,1).data);
    const checkerboard = e.canvas.classList.contains('has-transparency');
    const preserved = JSON.stringify(e.state.project) === original && e.state.dirty === clean;
    const exported = Array.from(e.exportPng().getContext('2d').getImageData(0,0,1,1).data);
    e.setBackgroundPreview(false);
    const restored = Array.from(e.ctx.getImageData(0,0,1,1).data);
    return { before, preview, checkerboard, preserved, exported, restored, realAlpha: real.alpha[0] };
  });
  expect(result).toEqual({
    before: [255,255,255,255], preview: [0,0,0,0], checkerboard: true,
    preserved: true, exported: [255,255,255,255],
    restored: [255,255,255,255], realAlpha: 1,
  });
});

test('白、黑、抖动和图案背景预览都保留真实页面背景与 PNG 数据', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const e = window.PixelEditorTest.editor, C = window.PixelEditorDebug.services.commands;
    const R = window.PixelEditorDebug.services.renderer;
    const modes = [{mode:'solid',color:0},{mode:'solid',color:1},{mode:'dither',color:0},{mode:'pattern',color:0}];
    return modes.map(fill => {
      e.exec(new C.UpdatePageCommand(e.activePage().id, {fill}));
      const actual = R.FramebufferRenderer.renderPageComposite(e.state.project,e.activePage().id,e.state.assets);
      const originalPixel = e.ctx.getImageData(0,0,1,1).data[3];
      const exportPixel = e.exportPng().getContext('2d').getImageData(0,0,1,1).data[3];
      e.setBackgroundPreview(true);
      const hiddenAlpha = e.ctx.getImageData(0,0,1,1).data[3];
      e.setBackgroundPreview(false);
      const restoredAlpha = e.ctx.getImageData(0,0,1,1).data[3];
      return {mode:fill.mode,realAlpha:actual.alpha[0],originalPixel,exportPixel,hiddenAlpha,restoredAlpha};
    });
  });
  for (const row of result) expect(row).toMatchObject({
    realAlpha:1,originalPixel:255,exportPixel:255,hiddenAlpha:0,restoredAlpha:255,
  });
});

test('隐藏背景预览仍合成所有可见图层及页面级画笔像素', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const e = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model, C = window.PixelEditorDebug.services.commands;
    const p=e.activePage();
    const beneath=M.createNode('rectangle',{parentId:p.id,x:10,y:10,w:2,h:1,
      fill:{mode:'solid',color:1},stroke:{width:0,color:1,style:'solid'}});
    const raster=M.createNode('raster',{parentId:p.id,x:11,y:10,w:3,h:1,pixels:Uint8Array.from([0,1,2])});
    const hidden=M.createNode('rectangle',{parentId:p.id,x:30,y:30,w:2,h:2,
      fill:{mode:'solid',color:1},visible:false});
    e.exec(new C.AddNodesCommand([beneath,raster,hidden],p.id));
    p.overlay['20,20']=0;
    e.renderAll();
    e.state.selection.clear();
    e.setBackgroundPreview(true);
    const pixel=(x,y)=>Array.from(e.ctx.getImageData(x,y,1,1).data);
    const samples={empty:pixel(0,0),lower:pixel(11,10),white:pixel(12,10),
      black:pixel(13,10),paint:pixel(20,20),hidden:pixel(30,30)};
    const originalFill=e.activePage().fill.mode;
    return {samples,originalFill};
  });
  expect(result.originalFill).toBe('solid');
  expect(result.samples).toEqual({
    empty:[0,0,0,0],lower:[0,0,0,255],white:[255,255,255,255],
    black:[0,0,0,255],paint:[255,255,255,255],hidden:[0,0,0,0],
  });
});

test('透明背景的 PNG 真正带 Alpha，1-bit 始终白底合成', async ({page})=>{
  await open(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,R=window.PixelEditorDebug.services.renderer;
    const p=e.activePage();
    e.exec(new C.UpdatePageCommand(p.id,{fill:{mode:'transparent',color:0}}));
    const raster=M.createNode('raster',{parentId:p.id,x:20,y:20,w:3,h:1,pixels:Uint8Array.from([0,1,2])});
    e.exec(new C.AddNodesCommand([raster],p.id));
    e.setBackgroundPreview(true);
    const png=e.exportPng().getContext('2d');
    const pixel=(x,y)=>Array.from(png.getImageData(x,y,1,1).data);
    const hw=R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets);
    return{blank:pixel(0,0),transparent:pixel(20,20),white:pixel(21,20),black:pixel(22,20),
      hardware:[hw[20*400+20],hw[20*400+21],hw[20*400+22]]};
  });
  expect(result.blank[3]).toBe(0);
  expect(result.transparent[3]).toBe(0);
  expect(result.white).toEqual([255,255,255,255]);
  expect(result.black).toEqual([0,0,0,255]);
  expect(result.hardware).toEqual([0,0,1]);
});

test('背景模式可保存、复制、撤销；预览开关不会进入工程文件',async({page})=>{
  await open(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,C=window.PixelEditorDebug.services.commands;
    const M=window.PixelEditorDebug.services.model,P=window.PixelEditorDebug.services.persistence;
    const id=e.activePage().id;
    e.exec(new C.UpdatePageCommand(id,{fill:{mode:'transparent',color:0}}));
    const before=e.bus.entries.length;
    e.setBackgroundPreview(true);
    const raw=P.ProjectSerializer.serialize(e.state.project,e.state.assets);
    e.exec(new C.DuplicatePageCommand(id));
    const duplicated=e.activePage().fill.mode;
    e.exec(new C.CreatePageCommand('白底'));
    const fresh=e.activePage().fill.mode;
    e.selectPage(id);
    const current=e.activePage().fill.mode;
    return{historyUnchangedAfterToggle:before===2,
      serializedPreviewAbsent:!raw.includes('hidePageBackground'),
      serializedBackground:P.ProjectSerializer.deserialize(raw).project.pages[0].fill.mode,
      duplicated,fresh,current,setting:e.editorPreferences.hidePageBackground};
  });
  expect(result).toEqual({historyUnchangedAfterToggle:true,serializedPreviewAbsent:true,
    serializedBackground:'transparent',duplicated:'transparent',fresh:'solid',current:'transparent',setting:true});
});

test('真实截图：白底页面点击隐藏背景会改变画面，关闭后完整恢复', async ({page})=>{
  await open(page);
  await page.evaluate(()=>{const e=window.PixelEditorTest.editor;e.setZoom(2);e.renderAll()});
  const stage=page.locator('#stage');
  const before=digest(await stage.screenshot());
  const button=page.locator('#backgroundPreviewBtn');
  await button.click();
  expect(await button.getAttribute('aria-pressed')).toBe('true');
  const hidden=digest(await stage.screenshot());
  expect(hidden).not.toBe(before);
  await button.click();
  expect(digest(await stage.screenshot())).toBe(before);
});
