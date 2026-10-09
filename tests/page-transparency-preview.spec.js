import { test, expect } from '@playwright/test';

async function boot(page){
  await page.goto('/');
  await page.waitForFunction(()=>Boolean(window.PixelEditorTest?.editor));
  await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor;
    e.newProject({force:true});
    e.setTransparencyContours(false);
  });
}

test('全部图层统一预览，选中状态不改变轮廓结果',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,p=e.activePage();
    const first=M.createNode('rectangle',{parentId:p.id,x:20,y:20,w:12,h:12,fill:{mode:'transparent',color:0},
      stroke:{width:1,color:1,style:'solid'}});
    const second=M.createNode('rectangle',{parentId:p.id,x:90,y:80,w:12,h:12,fill:{mode:'transparent',color:0},
      stroke:{width:1,color:1,style:'solid'}});
    e.exec(new C.AddNodesCommand([first,second],p.id));
    e.setTransparencyContours(true);
    const pixel=(x,y)=>Array.from(e.ctx.getImageData(x,y,1,1).data);
    const before=[pixel(21,21),pixel(91,81),pixel(0,0)];
    e.state.selection.replace([first.id]);e.renderOverlay();
    const selected=[pixel(21,21),pixel(91,81),pixel(0,0)];
    e.state.selection.clear();e.renderOverlay();
    const after=[pixel(21,21),pixel(91,81),pixel(0,0)];
    return{before,selected,after};
  });
  expect(result.before).toEqual([[195,225,250,255],[195,225,250,255],[255,255,255,255]]);
  expect(result.selected).toEqual(result.before);
  expect(result.after).toEqual(result.before);
});

test('没有图层的页面不被整页染色，隐藏图层不会贡献透明轮廓',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,p=e.activePage();
    e.setTransparencyContours(true);
    const pixel=(x,y)=>Array.from(e.ctx.getImageData(x,y,1,1).data);
    const blank=pixel(30,30);
    const node=M.createNode('rectangle',{parentId:p.id,x:20,y:20,w:12,h:12,fill:{mode:'transparent',color:0},
      stroke:{width:1,color:1,style:'solid'}});
    e.exec(new C.AddNodesCommand([node],p.id));
    const shown=pixel(21,21);
    e.exec(new C.UpdateNodesCommand([node.id],{visible:false},p.id));
    const hidden=pixel(21,21);
    e.exec(new C.CreatePageCommand('另一个页面'));
    const other=pixel(21,21);
    e.selectPage(p.id);
    const restored=pixel(21,21);
    return{blank,shown,hidden,other,restored,background:e.activePage().fill.mode};
  });
  expect(result).toEqual({
    blank:[255,255,255,255],shown:[195,225,250,255],hidden:[255,255,255,255],
    other:[255,255,255,255],restored:[255,255,255,255],background:'solid',
  });
});

test('切换预览不增加历史记录、不改变工程序列化或背景设置',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,P=window.PixelEditorDebug.services.persistence;
    const before=P.ProjectSerializer.serialize(e.state.project,e.state.assets);
    const size=e.bus.entries.length,dirty=e.state.dirty;
    e.setTransparencyContours(true);
    const enabled=e.editorPreferences.showTransparencyContours;
    e.setTransparencyContours(false);
    const after=P.ProjectSerializer.serialize(e.state.project,e.state.assets);
    return{same:before===after,history:e.bus.entries.length===size,dirtySame:dirty===e.state.dirty,
      enabled,background:e.activePage().fill.mode,noPreferenceInProject:!after.includes('showTransparencyContours')};
  });
  expect(result).toEqual({same:true,history:true,dirtySame:true,enabled:true,
    background:'solid',noPreferenceInProject:true});
});
