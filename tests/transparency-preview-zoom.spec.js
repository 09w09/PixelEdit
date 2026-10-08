import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
async function boot(page){
  await page.setViewportSize({width:1800,height:1100});
  await page.goto('/');
  await page.waitForFunction(()=>Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor;e.newProject({force:true});e.setBackgroundPreview(false);
  });
}

test('背景隐藏视图所有缩放倍率都与主画布和 SVG 控件对齐',async({page})=>{
  await boot(page);
  const results=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor;
    e.setBackgroundPreview(true);
    return [1,2,3,4,8,16,30,1].map(zoom=>{
      e.setZoom(zoom);
      const stage=document.querySelector('#stage'),canvas=e.canvas,svg=e.overlay;
      const a=stage.getBoundingClientRect(),b=canvas.getBoundingClientRect(),c=svg.getBoundingClientRect();
      return {zoom,aligned:[b,c].every(r=>Math.abs(r.left-a.left)<.1&&Math.abs(r.top-a.top)<.1
        &&Math.abs(r.width-a.width)<.1&&Math.abs(r.height-a.height)<.1),
        dimensions:[a.width,a.height],alpha:e.ctx.getImageData(399,299,1,1).data[3],
        checkerboard:canvas.classList.contains('has-transparency'),
        noOldCanvas:document.querySelector('#transparencyOverlayCanvas')===null};
    });
  });
  for(const row of results){
    expect(row.aligned,`${row.zoom}x 缩放时所有视觉层应对齐`).toBe(true);
    expect(row.dimensions).toEqual([row.zoom*400,row.zoom*300]);
    expect(row.alpha).toBe(0);
    expect(row.checkerboard).toBe(true);
    expect(row.noOldCanvas).toBe(true);
  }
});

test('200% 缩放时右下角可见棋盘格，关闭后截图与原来一致',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{const e=window.PixelEditorTest.editor;e.setZoom(2);e.renderAll()});
  const stage=page.locator('#stage');
  const original=hash(await stage.screenshot());
  const button=page.locator('#backgroundPreviewBtn');
  await button.click();
  const withHiddenBg=hash(await stage.screenshot());
  expect(withHiddenBg).not.toBe(original);
  const bottom=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor;
    return {alpha:e.ctx.getImageData(399,299,1,1).data[3],background:getComputedStyle(e.canvas).backgroundImage};
  });
  expect(bottom.alpha).toBe(0);
  expect(bottom.background).toContain('conic-gradient');
  await button.click();
  expect(hash(await stage.screenshot())).toBe(original);
});

test('隐藏背景时反复切换缩放倍率不改变导出像素',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,R=window.PixelEditorDebug.services.renderer;
    const before=R.FramebufferRenderer.renderPage(e.state.project,e.activePage().id,e.state.assets);
    e.setBackgroundPreview(true);
    const dimensions=[1,2,4,3,1].map(zoom=>{
      e.setZoom(zoom);e.renderAll();
      const a=e.canvas.getBoundingClientRect(),b=e.overlay.getBoundingClientRect();
      return{same:a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height,
        previewAlpha:e.ctx.getImageData(399,299,1,1).data[3]};
    });
    const after=R.FramebufferRenderer.renderPage(e.state.project,e.activePage().id,e.state.assets);
    return {dimensions,unchanged:before.every((v,i)=>v===after[i])};
  });
  expect(result.unchanged).toBe(true);
  for(const item of result.dimensions)expect(item).toEqual({same:true,previewAlpha:0});
});
