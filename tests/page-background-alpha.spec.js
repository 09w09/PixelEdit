import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(() => {
    const e = window.PixelEditorTest.editor;
    e.newProject({ force: true });
    e.setTransparencyContours(false);
  });
}

test('白色背景保持完全不透明，只在空心图形内部产生透明区域', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const e = window.PixelEditorTest.editor, M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands, R = window.PixelEditorDebug.services.renderer;
    const p = e.activePage();
    const shape = M.createNode('rectangle', {
      parentId: p.id, x:40, y:40, w:20, h:20,
      fill:{ mode:'transparent', color:0 }, stroke:{ width:1, color:1, style:'solid' },
    });
    e.exec(new C.AddNodesCommand([shape], p.id));
    e.state.selection.clear();
    const before = R.FramebufferRenderer.renderPageComposite(e.state.project, p.id, e.state.assets);
    const raw = JSON.stringify(e.state.project);
    const pngBefore = e.exportPng().getContext('2d').getImageData(41,41,1,1).data;
    e.setTransparencyContours(true);
    const sample=(x,y)=>Array.from(e.ctx.getImageData(x,y,1,1).data);
    const actual = R.FramebufferRenderer.renderPageComposite(e.state.project, p.id, e.state.assets);
    const screenshotPixels = {
      outside:sample(0,0), interior:sample(41,41), center:sample(50,50), ink:sample(40,40),
    };
    const pngAfter = e.exportPng().getContext('2d').getImageData(41,41,1,1).data;
    const originalPreserved = raw === JSON.stringify(e.state.project)
      && before.alpha.every((a,i)=>a===actual.alpha[i] && before.bits[i]===actual.bits[i]);
    e.setTransparencyContours(false);
    return { screenshotPixels, restored:sample(41,41), alpha:actual.alpha[41*400+41],
      originalPreserved, pngUnchanged:Array.from(pngBefore).every((a,i)=>a===pngAfter[i]),
      checkerboard:e.canvas.classList.contains('has-transparency') };
  });
  expect(result.screenshotPixels.outside).toEqual([255,255,255,255]);
  expect(result.screenshotPixels.interior).toEqual([195,225,250,255]);
  expect(result.screenshotPixels.center).toEqual([195,225,250,255]);
  expect(result.screenshotPixels.ink).toEqual([0,0,0,255]);
  expect(result.restored).toEqual([255,255,255,255]);
  expect(result.alpha).toBe(1);
  expect(result.originalPreserved).toBe(true);
  expect(result.pngUnchanged).toBe(true);
  expect(result.checkerboard).toBe(false);
});

test('黑色、白色、抖动、图案背景颜色与 Alpha 均不被替换', async ({ page }) => {
  await boot(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,C=window.PixelEditorDebug.services.commands;
    return [
      {mode:'solid',color:0},{mode:'solid',color:1},
      {mode:'dither',color:0},{mode:'pattern',color:0},
    ].map(fill=>{
      e.exec(new C.UpdatePageCommand(e.activePage().id,{fill}));
      const before=Array.from(e.ctx.getImageData(0,0,1,1).data);
      e.setTransparencyContours(true);
      const after=Array.from(e.ctx.getImageData(0,0,1,1).data);
      e.setTransparencyContours(false);
      return{mode:fill.mode,before,after};
    });
  });
  for(const row of result){
    expect(row.before[3]).toBe(255);
    expect(row.after).toEqual(row.before);
  }
});

test('白色底图上栅格透明洞可见，下层遮挡会消除透明区域',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,R=window.PixelEditorDebug.services.renderer;
    const p=e.activePage();
    const raster=M.createNode('raster',{parentId:p.id,x:30,y:30,w:4,h:4,
      pixels:Uint8Array.from([
        2,2,2,2,
        2,0,0,2,
        2,0,0,2,
        2,2,2,2,
      ])});
    e.exec(new C.AddNodesCommand([raster],p.id));
    e.setTransparencyContours(true);
    const at=(x,y)=>Array.from(e.ctx.getImageData(x,y,1,1).data);
    const hole=at(31,31),ink=at(30,30),outside=at(25,25);
    e.setTransparencyContours(false);
    const opaqueWhite=at(31,31);
    const lower=M.createNode('rectangle',{parentId:p.id,x:31,y:31,w:2,h:2,
      fill:{mode:'solid',color:0},stroke:{width:0,color:0,style:'solid'}});
    // A lower layer fills the same transparent hole; both are white and opaque.
    p.nodes.unshift(lower);
    e.renderAll();e.setTransparencyContours(true);
    const filled=at(31,31);
    const actual=R.FramebufferRenderer.renderPageComposite(e.state.project,p.id,e.state.assets);
    return{hole,ink,outside,opaqueWhite,filled,alpha:actual.alpha[31*400+31]};
  });
  expect(result.hole).toEqual([195,225,250,255]);
  expect(result.ink).toEqual([0,0,0,255]);
  expect(result.outside).toEqual([255,255,255,255]);
  expect(result.opaqueWhite).toEqual([255,255,255,255]);
  expect(result.filled).toEqual([255,255,255,255]);
  expect(result.alpha).toBe(1);
});

test('透明底图的 PNG Alpha 保持原样，预览边界不进入导出', async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,R=window.PixelEditorDebug.services.renderer;
    const p=e.activePage();
    e.exec(new C.UpdatePageCommand(p.id,{fill:{mode:'transparent',color:0}}));
    e.exec(new C.AddNodesCommand([M.createNode('raster',{parentId:p.id,x:20,y:20,w:3,h:1,
      pixels:Uint8Array.from([0,1,2])})],p.id));
    const before=e.exportPng().getContext('2d');
    const sample=(ctx,x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
    const exportedBefore=[sample(before,0,0),sample(before,20,20),sample(before,21,20),sample(before,22,20)];
    const hwBefore=R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets);
    e.setTransparencyContours(true);
    const after=e.exportPng().getContext('2d');
    const exportedAfter=[sample(after,0,0),sample(after,20,20),sample(after,21,20),sample(after,22,20)];
    const hwAfter=R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets);
    return{exportedBefore,exportedAfter,hardware:[hwAfter[20*400+20],hwAfter[20*400+21],hwAfter[20*400+22]],
      unchanged:hwBefore.every((v,i)=>v===hwAfter[i])};
  });
  expect(result.exportedBefore[0][3]).toBe(0);
  expect(result.exportedBefore[1][3]).toBe(0);
  expect(result.exportedBefore[2]).toEqual([255,255,255,255]);
  expect(result.exportedBefore[3]).toEqual([0,0,0,255]);
  expect(result.exportedAfter).toEqual(result.exportedBefore);
  expect(result.hardware).toEqual([0,0,1]);
  expect(result.unchanged).toBe(true);
});

test('完整页面截图只在图层范围内着色，开关关闭后逐字节恢复',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,p=e.activePage();
    e.exec(new C.AddNodesCommand([M.createNode('rectangle',{parentId:p.id,x:50,y:50,w:80,h:60,
      fill:{mode:'transparent',color:0},stroke:{width:1,color:1,style:'solid'}})],p.id));
    e.state.selection.clear();e.setZoom(2);e.renderAll();
  });
  const stage=page.locator('#stage'),before=hash(await stage.screenshot());
  const button=page.locator('#transparencyContoursBtn');
  await button.click();
  expect(await button.getAttribute('aria-pressed')).toBe('true');
  const after=hash(await stage.screenshot());
  expect(after).not.toBe(before);
  const outside=await page.evaluate(()=>Array.from(window.PixelEditorTest.editor.ctx.getImageData(0,0,1,1).data));
  expect(outside).toEqual([255,255,255,255]);
  await button.click();
  expect(hash(await stage.screenshot())).toBe(before);
});
