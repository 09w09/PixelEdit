import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(() => {
    const e = window.PixelEditorTest.editor;
    e.newProject({ force: true });
    e.setTransparencyPreview(false);
  });
}

test('白色和黑色页面背景完全不透明，透明预览不会误染色', async ({ page }) => {
  await open(page);
  const data = await page.evaluate(() => {
    const e = window.PixelEditorTest.editor, R = window.PixelEditorDebug.services.renderer;
    const current = e.activePage(), id = current.id, assets = e.state.assets;
    const sample = () => {
      const frame = R.FramebufferRenderer.renderPageComposite(e.state.project, id, assets);
      return { alpha: frame.alpha[0], bit: frame.bits[0], hardware: R.FramebufferRenderer.renderPage(e.state.project, id, assets)[0] };
    };
    e.setTransparencyPreview(true);
    const preview = () => e.transparencyCanvas.getContext('2d').getImageData(0, 0, 1, 1).data[3];
    const white = { ...sample(), overlay: preview(), canvasAlpha: e.ctx.getImageData(0, 0, 1, 1).data[3] };
    e.exec(new (window.PixelEditorDebug.services.commands.UpdatePageCommand)(id, { fill: { mode:'solid',color:1 } }));
    const black = { ...sample(), overlay: preview(), canvasAlpha: e.ctx.getImageData(0, 0, 1, 1).data[3] };
    for (const mode of ['dither','pattern']) {
      e.exec(new (window.PixelEditorDebug.services.commands.UpdatePageCommand)(id, {
        fill: { mode, color: 0 },
      }));
      const frame = R.FramebufferRenderer.renderPageComposite(e.state.project, id, assets);
      if (frame.alpha.some(value => value !== 1)) throw Error(mode+' 背景包含透明像素');
      if (preview() !== 0) throw Error(mode+' 背景被误标记为透明');
    }
    return { white, black };
  });
  expect(data.white).toEqual({ alpha:1, bit:0, hardware:0, overlay:0, canvasAlpha:255 });
  expect(data.black).toEqual({ alpha:1, bit:1, hardware:1, overlay:0, canvasAlpha:255 });
});

test('透明页面基于实际图层合成 Alpha，透明像素与白色像素区别清晰', async ({ page }) => {
  await open(page);
  const data = await page.evaluate(() => {
    const e = window.PixelEditorTest.editor, M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands, R = window.PixelEditorDebug.services.renderer;
    const p = e.activePage();
    e.exec(new C.UpdatePageCommand(p.id, { fill: { mode:'transparent', color:0 } }));
    const raster = M.createNode('raster', { parentId:p.id, x:11, y:10, w:3, h:1,
      pixels:Uint8Array.from([0,1,2]) });
    const beneath = M.createNode('rectangle', { parentId:p.id, x:10, y:10, w:2, h:1,
      fill:{mode:'solid',color:1}, stroke:{width:0,color:1,style:'solid'} });
    e.exec(new C.AddNodesCommand([beneath, raster],p.id));
    p.overlay['20,20'] = 0; // Opaque page-level white painting over alpha.
    e.renderAll();
    e.setTransparencyPreview(true);
    const frame = R.FramebufferRenderer.renderPageComposite(e.state.project, p.id, e.state.assets);
    const at = (x,y) => {
      const i=y*400+x, preview=e.transparencyCanvas.getContext('2d').getImageData(x,y,1,1).data[3];
      const image=e.ctx.getImageData(x,y,1,1).data[3];
      return { alpha:frame.alpha[i], bit:frame.bits[i], preview, image };
    };
    const noSelection=at(0,0);
    e.state.selection.replace([raster.id]);
    e.renderOverlay();
    const selected=at(0,0);
    e.state.selection.clear();
    e.renderOverlay();
    const cleared=at(0,0);
    return {
      blank: at(4,4), lower:at(11,10), white:at(12,10), black:at(13,10),
      pageOverlay:at(20,20), noSelection, selected, cleared,
      outputWhite:R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets)[4*400+4],
      checkerboard:e.canvas.classList.contains('has-transparency'),
    };
  });
  expect(data.blank).toEqual({alpha:0,bit:0,preview:82,image:0});
  expect(data.lower).toEqual({alpha:1,bit:1,preview:0,image:255});
  expect(data.white).toEqual({alpha:1,bit:0,preview:0,image:255});
  expect(data.black).toEqual({alpha:1,bit:1,preview:0,image:255});
  expect(data.pageOverlay).toEqual({alpha:1,bit:0,preview:0,image:255});
  expect(data.noSelection).toEqual(data.selected);
  expect(data.selected).toEqual(data.cleared);
  expect(data.outputWhite).toBe(0);
  expect(data.checkerboard).toBe(true);
});

test('页面属性面板能切换透明背景，撤销重做后实时重新渲染', async ({page}) => {
  await open(page);
  await page.evaluate(() => {
    const e=window.PixelEditorTest.editor;
    e.state.selection.clear();
    e.pageSelectedId=e.activePage().id;
    e.properties.render();
    e.setTransparencyPreview(true);
  });
  await expect(page.locator('#propFill')).toHaveValue('solid');
  await expect(page.locator('#propBgSolid')).toBeVisible();
  await page.locator('#propFill').selectOption('transparent');
  await expect(page.locator('#propFill')).toHaveValue('transparent');
  await expect(page.locator('#propBgSolid')).toHaveCount(0);
  const now = await page.evaluate(() => {
    const e=window.PixelEditorTest.editor;
    return { mode:e.activePage().fill.mode, alpha:e.ctx.getImageData(0,0,1,1).data[3],
      overlay:e.transparencyCanvas.getContext('2d').getImageData(0,0,1,1).data[3] };
  });
  expect(now).toEqual({ mode:'transparent',alpha:0,overlay:82 });
  await page.evaluate(() => { const e=window.PixelEditorTest.editor; e.bus.undo();e.renderAll(); });
  expect(await page.evaluate(() => window.PixelEditorTest.editor.activePage().fill.mode)).toBe('solid');
  expect(await page.evaluate(() => window.PixelEditorTest.editor.ctx.getImageData(0,0,1,1).data[3])).toBe(255);
  await page.evaluate(() => {const e=window.PixelEditorTest.editor;e.bus.redo();e.renderAll();});
  expect(await page.evaluate(() => window.PixelEditorTest.editor.activePage().fill.mode)).toBe('transparent');
});

test('PNG 输出真实 Alpha，1-bit 输出仅透明像素合成到白底', async ({ page }) => {
  await open(page);
  const output=await page.evaluate(() => {
    const e=window.PixelEditorTest.editor, M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,R=window.PixelEditorDebug.services.renderer;
    const white=e.exportPng().getContext('2d').getImageData(0,0,1,1).data;
    const p=e.activePage();
    e.exec(new C.UpdatePageCommand(p.id,{fill:{mode:'transparent',color:0}}));
    const r=M.createNode('raster',{parentId:p.id,x:20,y:20,w:3,h:1,pixels:Uint8Array.from([0,1,2])});
    e.exec(new C.AddNodesCommand([r],p.id));
    const png=e.exportPng().getContext('2d');
    const sample=(x,y)=>[...png.getImageData(x,y,1,1).data];
    const hw=R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets);
    const hardware=[hw[20*400+20],hw[20*400+21],hw[20*400+22]];
    return{white:[...white],transparent:sample(20,20),opaqueWhite:sample(21,20),opaqueBlack:sample(22,20),hardware};
  });
  expect(output.white).toEqual([255,255,255,255]);
  expect(output.transparent[3]).toBe(0);
  expect(output.opaqueWhite).toEqual([255,255,255,255]);
  expect(output.opaqueBlack).toEqual([0,0,0,255]);
  expect(output.hardware).toEqual([0,0,1]);
});

test('透明背景在序列化、复制页面、切换页面中保持一致', async ({ page }) => {
  await open(page);
  const state=await page.evaluate(() => {
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,P=window.PixelEditorDebug.services.persistence;
    const id=e.activePage().id;
    e.exec(new C.UpdatePageCommand(id,{fill:{mode:'transparent',color:0}}));
    const raw=P.ProjectSerializer.serialize(e.state.project,e.state.assets);
    const copy=P.ProjectSerializer.deserialize(raw);
    e.exec(new C.DuplicatePageCommand(id));
    const duplicated=e.activePage().fill.mode;
    e.exec(new C.CreatePageCommand('不透明页'));
    const fresh=e.activePage().fill.mode;
    e.selectPage(id);
    const restoredMode=e.activePage().fill.mode;
    return {mode:copy.project.pages[0].fill.mode,duplicated,fresh,restoredMode};
  });
  expect(state).toEqual({mode:'transparent',duplicated:'transparent',fresh:'solid',restoredMode:'transparent'});
});

test('无效背景类型被拒绝，背景数据严格保持规范形式', async ({page}) => {
  await open(page);
  const result=await page.evaluate(() => {
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const P=window.PixelEditorDebug.services.persistence;
    const project=M.createProject();
    const valid=P.ProjectSerializer.serialize(project,new M.AssetStore());
    const modes=['transparent','solid','dither','pattern'].map(mode => {
      project.pages[0].fill={mode,color:0};
      try {P.ProjectSerializer.validate(project);return true} catch{return false}
    });
    project.pages[0].fill={mode:'unsupported',color:0};
    let rejected=false;
    try { P.ProjectSerializer.validate(project) }catch{rejected=true}
    return {modes,rejected,original:JSON.parse(valid).pages[0].fill.mode,
      current:e.activePage().fill.mode};
  });
  expect(result).toEqual({modes:[true,true,true,true],rejected:true,original:'solid',current:'solid'});
});

test('真实截图：白色背景开启透明预览不变色，透明背景才显示覆盖', async ({page}) => {
  await open(page);
  await page.evaluate(() => {const e=window.PixelEditorTest.editor;e.setZoom(2);e.renderAll();});
  const stage=page.locator('#stage');
  const white=digest(await stage.screenshot());
  await page.locator('#transparencyPreviewBtn').click();
  expect(digest(await stage.screenshot())).toBe(white);
  await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,C=window.PixelEditorDebug.services.commands;
    e.exec(new C.UpdatePageCommand(e.activePage().id,{fill:{mode:'transparent',color:0}}));
  });
  const transparentPreview=digest(await stage.screenshot());
  expect(transparentPreview).not.toBe(white);
  await page.locator('#transparencyPreviewBtn').click();
  const transparentPlain=digest(await stage.screenshot());
  expect(transparentPlain).not.toBe(transparentPreview);
});
