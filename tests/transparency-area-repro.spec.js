import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(() => {
    const e = window.PixelEditorTest.editor;
    e.newProject({ force:true });
    e.setTransparencyContours(false);
    e.state.selection.clear();
  });
}

test('回归用户截图：白底、空心矩形与斜线，填色标记透明内部而不沿黑线描边', async ({page}) => {
  await boot(page);
  await page.evaluate(() => {
    const e = window.PixelEditorTest.editor, M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands, p = e.activePage();
    const rect = M.createNode('rectangle', { parentId:p.id, x:50,y:50,w:240,h:120,
      fill:{mode:'transparent', color:0}, stroke:{width:1,color:1,style:'solid'} });
    const line = M.createNode('line',{ parentId:p.id,x1:90,y1:95,x2:210,y2:155,
      stroke:{width:1,color:1,style:'solid'} });
    e.exec(new C.AddNodesCommand([rect,line],p.id));
    e.state.selection.clear();
    e.setZoom(2);
    e.renderAll();
  });

  const stage=page.locator('#stage');
  const before=digest(await stage.screenshot());
  await page.locator('#transparencyContoursBtn').click();
  const after=digest(await stage.screenshot());
  expect(after).not.toBe(before);

  const pixels = await page.evaluate(() => {
    const e = window.PixelEditorTest.editor;
    const at=(x,y)=>Array.from(e.ctx.getImageData(x,y,1,1).data);
    const data=e.ctx.getImageData(0,0,400,300).data;
    let marked=0, markedOutside=0, alphaZero=0;
    for(let y=0;y<300;y++)for(let x=0;x<400;x++){
      const i=(y*400+x)*4;
      if(data[i+3]===0)alphaZero++;
      if(data[i]===195 && data[i+1]===225 && data[i+2]===250){
        marked++;
        if(x<50 || x>=290 || y<50 || y>=170)markedOutside++;
      }
    }
    return {
      background:at(0,0),outside:at(350,200),
      inside:at(120,75),middle:at(270,155),
      blackStroke:at(50,50),blackLineStart:at(90,95),blackLineMiddle:at(150,125),
      marked,markedOutside,alphaZero,fill:e.activePage().fill.mode,
    };
  });
  expect(pixels).toMatchObject({
    background:[255,255,255,255],outside:[255,255,255,255],
    inside:[195,225,250,255],middle:[195,225,250,255],
    blackStroke:[0,0,0,255],blackLineStart:[0,0,0,255],
    markedOutside:0,alphaZero:0,fill:'solid',
  });
  expect(pixels.marked).toBeGreaterThan(20000);

  await page.locator('#transparencyContoursBtn').click();
  expect(digest(await stage.screenshot())).toBe(before);
});

test('只有线条的页面没有面积型透明区域，不应出现蓝色描边',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,p=e.activePage();
    e.exec(new C.AddNodesCommand([M.createNode('line',{
      parentId:p.id,x1:90,y1:95,x2:210,y2:155,
      stroke:{width:1,color:1,style:'solid'}
    })],p.id));
    e.state.selection.clear();e.renderAll();
  });
  const before=digest(await page.locator('#stage').screenshot());
  await page.locator('#transparencyContoursBtn').click();
  const after=digest(await page.locator('#stage').screenshot());
  expect(after).toBe(before);
});

test('填充黑色和白色的矩形没有内部透明区域',async({page})=>{
  await boot(page);
  const out=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,p=e.activePage();
    const rectBlack=M.createNode('rectangle',{parentId:p.id,x:20,y:20,w:30,h:30,
      fill:{mode:'solid',color:1},stroke:{width:0,color:1,style:'solid'}});
    const rectWhite=M.createNode('rectangle',{parentId:p.id,x:60,y:20,w:30,h:30,
      fill:{mode:'solid',color:0},stroke:{width:0,color:0,style:'solid'}});
    e.exec(new C.AddNodesCommand([rectBlack,rectWhite],p.id));
    e.state.selection.clear();e.setTransparencyContours(true);
    const at=(x,y)=>Array.from(e.ctx.getImageData(x,y,1,1).data);
    return [at(25,25),at(65,25),at(0,0)];
  });
  expect(out).toEqual([[0,0,0,255],[255,255,255,255],[255,255,255,255]]);
});
