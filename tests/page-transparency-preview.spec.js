import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(() => {
    const e=window.PixelEditorTest.editor;
    e.newProject({force:true});e.setBackgroundPreview(false);
  });
}

test('白底工程预览只隐藏背景，真实合成 Alpha 始终不变', async ({page})=>{
  await open(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,R=window.PixelEditorDebug.services.renderer;
    const p=e.activePage();
    const raster=M.createNode('raster',{parentId:p.id,x:10,y:10,w:3,h:1,pixels:Uint8Array.from([0,1,2])});
    e.exec(new C.AddNodesCommand([raster],p.id));
    const hardware=R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets);
    const real=R.FramebufferRenderer.renderPageComposite(e.state.project,p.id,e.state.assets);
    e.setBackgroundPreview(true);
    const sample=(x,y)=>e.ctx.getImageData(x,y,1,1).data[3];
    const transparent=sample(10,10),white=sample(11,10),black=sample(12,10);
    e.state.selection.replace([raster.id]);e.renderOverlay();
    const selected=sample(10,10);
    e.state.selection.clear();e.renderOverlay();
    const deselected=sample(10,10);
    e.setBackgroundPreview(false);
    const restored=sample(10,10);
    const afterHardware=R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets);
    return{transparent,white,black,selected,deselected,restored,
      realAlpha:real.alpha[10*400+10],hardwareUnchanged:hardware.every((v,i)=>v===afterHardware[i])};
  });
  expect(result).toEqual({transparent:0,white:255,black:255,selected:0,
    deselected:0,restored:255,realAlpha:1,hardwareUnchanged:true});
});

test('透明背景原本就能透出棋盘格，开关不制造额外覆盖',async({page})=>{
  await open(page);
  await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,C=window.PixelEditorDebug.services.commands;
    e.exec(new C.UpdatePageCommand(e.activePage().id,{fill:{mode:'transparent',color:0}}));
  });
  const stage=page.locator('#stage'),before=digest(await stage.screenshot());
  await page.locator('#backgroundPreviewBtn').click();
  expect(await page.locator('#backgroundPreviewBtn').getAttribute('aria-pressed')).toBe('true');
  expect(digest(await stage.screenshot())).toBe(before);
});

test('图层编辑、隐藏及页面切换后背景预览持续有效',async({page})=>{
  await open(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands;
    const p=e.activePage();
    e.setBackgroundPreview(true);
    const a=()=>e.ctx.getImageData(8,8,1,1).data[3];
    const empty=a();
    const r=M.createNode('rectangle',{parentId:p.id,x:8,y:8,w:3,h:3,
      fill:{mode:'solid',color:1},stroke:{width:0,color:1,style:'solid'}});
    e.exec(new C.AddNodesCommand([r],p.id));const painted=a();
    e.exec(new C.UpdateNodesCommand([r.id],{visible:false},p.id));const hidden=a();
    e.exec(new C.CreatePageCommand('第二页'));const freshPage=a();
    e.selectPage(p.id);const restored=a();
    e.setBackgroundPreview(false);const original=a();
    return{empty,painted,hidden,freshPage,restored,original,pressed:e.editorPreferences.hidePageBackground};
  });
  expect(result).toEqual({empty:0,painted:255,hidden:0,freshPage:0,restored:0,
    original:255,pressed:false});
});
