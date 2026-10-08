import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
async function boot(page){
  await page.setViewportSize({width:1800,height:1100});
  await page.goto('/');
  await page.waitForFunction(()=>Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands;
    e.newProject({force:true});e.setTransparencyContours(false);
    e.exec(new C.AddNodesCommand([M.createNode('rectangle',{
      parentId:e.activePage().id,x:60,y:60,w:45,h:45,
      fill:{mode:'transparent',color:0},stroke:{width:1,color:1,style:'solid'},
    })],e.activePage().id));
    e.state.selection.clear();
  });
}

test('缩放 1–30x 后透明边界仅在图层范围内显示，画布保持不透明', async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor;
    e.setTransparencyContours(true);
    return [1,2,3,4,8,16,30,1].map(zoom=>{
      e.setZoom(zoom);
      const a=document.querySelector('#stage').getBoundingClientRect();
      const b=e.canvas.getBoundingClientRect(),c=e.overlay.getBoundingClientRect();
      const sample=(x,y)=>Array.from(e.ctx.getImageData(x,y,1,1).data);
      return {zoom,sizes:[a.width,a.height],aligned:[b,c].every(r=>
        Math.abs(r.x-a.x)<.1&&Math.abs(r.y-a.y)<.1&&Math.abs(r.width-a.width)<.1&&Math.abs(r.height-a.height)<.1),
        outside:sample(0,0),edge:sample(61,61),center:sample(80,80),
        checker:e.canvas.classList.contains('has-transparency')};
    });
  });
  for(const item of result){
    expect(item.sizes).toEqual([400*item.zoom,300*item.zoom]);
    expect(item.aligned).toBe(true);
    expect(item.outside).toEqual([255,255,255,255]);
    expect(item.edge).toEqual([65,135,216,255]);
    expect(item.center).toEqual([255,255,255,255]);
    expect(item.checker).toBe(false);
  }
});

test('200% 画面左上角与右下角始终白色，切换轮廓开关后截图可恢复', async({page})=>{
  await boot(page);
  await page.evaluate(()=>{const e=window.PixelEditorTest.editor;e.setZoom(2);e.renderAll();});
  const stage=page.locator('#stage'),baseline=hash(await stage.screenshot());
  const btn=page.locator('#transparencyContoursBtn');
  await btn.click();
  expect(hash(await stage.screenshot())).not.toBe(baseline);
  const corners=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,at=(x,y)=>Array.from(e.ctx.getImageData(x,y,1,1).data);
    return{topLeft:at(0,0),bottomRight:at(399,299),alpha:e.ctx.getImageData(61,61,1,1).data[3]};
  });
  expect(corners).toEqual({
    topLeft:[255,255,255,255],bottomRight:[255,255,255,255],alpha:255,
  });
  await btn.click();
  expect(hash(await stage.screenshot())).toBe(baseline);
});

test('反复缩放不修改导出像素',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,R=window.PixelEditorDebug.services.renderer;
    const before=R.FramebufferRenderer.renderPage(e.state.project,e.activePage().id,e.state.assets);
    e.setTransparencyContours(true);
    for(const scale of [1,2,4,3,1]){e.setZoom(scale);e.renderAll();}
    const after=R.FramebufferRenderer.renderPage(e.state.project,e.activePage().id,e.state.assets);
    return before.every((v,i)=>v===after[i]);
  });
  expect(result).toBe(true);
});
