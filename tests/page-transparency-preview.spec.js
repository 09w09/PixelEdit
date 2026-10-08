import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(() => window.PixelEditorTest.editor.newProject({force:true}));
}

test('透明预览显示最终页面 Alpha，不根据图层选择推断透明', async ({page}) => {
  await open(page);
  const result=await page.evaluate(() => {
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,R=window.PixelEditorDebug.services.renderer;
    const p=e.activePage();
    const sample=()=>e.transparencyCanvas.getContext('2d').getImageData(0,0,1,1).data[3];
    e.setTransparencyPreview(true);
    const white=sample();
    e.exec(new C.UpdatePageCommand(p.id,{fill:{mode:'transparent',color:0}}));
    const transparent=sample();
    const raster=M.createNode('raster',{parentId:p.id,x:0,y:0,w:1,h:1,pixels:Uint8Array.from([2])});
    e.exec(new C.AddNodesCommand([raster],p.id));
    const opaqueBlack=sample();
    e.state.selection.clear();e.renderOverlay();
    const noSelection=sample();
    e.state.selection.replace([raster.id]);e.renderOverlay();
    const selected=sample();
    const before=R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets);
    e.setTransparencyPreview(false);
    const off=sample();
    const after=R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets);
    return {white,transparent,opaqueBlack,noSelection,selected,off,
      framebufferUnchanged:before.every((v,i)=>v===after[i])};
  });
  expect(result).toEqual({white:0,transparent:82,opaqueBlack:0,noSelection:0,selected:0,off:0,
    framebufferUnchanged:true});
});

test('开启透明背景后切换预览会改变页面实际截图，关闭后复原',async ({page})=>{
  await open(page);
  await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,C=window.PixelEditorDebug.services.commands;
    e.exec(new C.UpdatePageCommand(e.activePage().id,{fill:{mode:'transparent',color:0}}));
    e.setZoom(2);
    e.state.selection.clear();
    e.setTransparencyPreview(false);
  });
  const stage=page.locator('#stage');
  const before=digest(await stage.screenshot());
  await page.locator('#transparencyPreviewBtn').click();
  const after=digest(await stage.screenshot());
  expect(after).not.toBe(before);
  await page.locator('#transparencyPreviewBtn').click();
  expect(digest(await stage.screenshot())).toBe(before);
});

test('隐藏图层与切换回不透明页时，预览不再错误标记白色背景',async ({page})=>{
  await open(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands;
    const p=e.activePage();
    const at=()=>e.transparencyCanvas.getContext('2d').getImageData(8,8,1,1).data[3];
    e.exec(new C.UpdatePageCommand(p.id,{fill:{mode:'transparent',color:0}}));
    e.setTransparencyPreview(true);
    const empty=at();
    const rectangle=M.createNode('rectangle',{parentId:p.id,x:8,y:8,w:3,h:3,
      fill:{mode:'solid',color:1},stroke:{width:0,color:1,style:'solid'}});
    e.exec(new C.AddNodesCommand([rectangle],p.id));const painted=at();
    e.exec(new C.UpdateNodesCommand([rectangle.id],{visible:false},p.id));
    const hidden=at();
    e.exec(new C.CreatePageCommand('白底页面'));const whitePage=at();
    e.selectPage(p.id);const restoredTransparent=at();
    return{empty,painted,hidden,whitePage,restoredTransparent};
  });
  expect(result).toEqual({empty:82,painted:0,hidden:82,whitePage:0,restoredTransparent:82});
});
