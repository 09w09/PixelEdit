import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('tri-state packing preserves transparent, white and black distinctly', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const T = window.PixelEditorDebug.services.tristateRaster;
    const input = Uint8Array.from([0, 1, 2, 0, 2, 1, 0, 2]);
    const encoded = T?.encodeTriStatePixels?.(input);
    const decoded = encoded ? T.decodeTriStatePixels(encoded, 4, 2) : null;
    return {
      constants: T ? [T.RASTER_TRANSPARENT, T.RASTER_WHITE, T.RASTER_BLACK, T.RASTER_ENCODING] : null,
      decoded: decoded ? [...decoded] : null,
      composite: T ? [0, 1, 2].map(value => T.rasterPixelToComposite(value)) : null,
    };
  });
  expect(result.constants).toEqual([0, 1, 2, 'tristate-packed-v1']);
  expect(result.decoded).toEqual([0, 1, 2, 0, 2, 1, 0, 2]);
  expect(result.composite).toEqual([
    { covered: false, color: 0 },
    { covered: true, color: 0 },
    { covered: true, color: 1 },
  ]);
});

test('raster creation, paint, erase and resize preserve all three states', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const M = window.PixelEditorDebug.services.model;
    const T = window.PixelEditorDebug.services.tristateRaster;
    const raster = M.createNode('raster', { x: 10, y: 10, w: 2, h: 2, pixels: Uint8Array.from([2, 1, 0, 2]) });
    const initial = T ? [...T.decodeTriStatePixels(raster.raster.data, 2, 2)] : null;
    const white = T?.paintTriStateRaster?.(raster, [{ x: 0, y: 0 }], T.RASTER_WHITE);
    const afterWhite = white ? [...T.decodeTriStatePixels(white.data, 2, 2)] : null;
    const erased = white && T.paintTriStateRaster({ ...raster, raster: white }, [{ x: 1, y: 1 }], T.RASTER_TRANSPARENT);
    const afterErase = erased ? [...T.decodeTriStatePixels(erased.data, 2, 2)] : null;
    const expanded = erased && T.resizeTriStateRaster({ ...raster, raster: erased }, { x: 9, y: 9, w: 4, h: 4 });
    const expandedPixels = expanded ? [...T.decodeTriStatePixels(expanded.raster.data, 4, 4)] : null;
    return { encoding: raster.raster.encoding, initial, afterWhite, afterErase, expandedPixels };
  });
  expect(result.encoding).toBe('tristate-packed-v1');
  expect(result.initial).toEqual([2, 1, 0, 2]);
  expect(result.afterWhite).toEqual([1, 1, 0, 2]);
  expect(result.afterErase).toEqual([1, 1, 0, 0]);
  expect(result.expandedPixels).toEqual([
    0, 0, 0, 0,
    0, 1, 1, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
});

test('raster transparent pixels reveal lower layers while white pixels cover black', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const R = window.PixelEditorDebug.services.renderer;
    editor.newProject({ force: true });
    const p = editor.activePage();
    p.fill = { mode: 'solid', value: 0 };
    const black = M.createNode('rectangle', {
      parentId: p.id, x: 10, y: 10, w: 3, h: 1,
      stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'solid' },
    });
    const raster = M.createNode('raster', {
      parentId: p.id, x: 10, y: 10, w: 3, h: 1,
      pixels: Uint8Array.from([0, 1, 2]),
    });
    p.nodes.push(black, raster);
    const fb = R.FramebufferRenderer.renderPage(editor.state.project, p.id, editor.state.assets);
    return [fb[10 * 400 + 10], fb[10 * 400 + 11], fb[10 * 400 + 12]];
  });
  expect(result).toEqual([1, 0, 1]);
});

test('栅格透明像素显示透明区域，页面背景和导出不变',async({page})=>{
  await openEditor(page);
  const result=await page.evaluate(()=>{
    const e=window.PixelEditorTest.editor,M=window.PixelEditorDebug.services.model;
    const C=window.PixelEditorDebug.services.commands,R=window.PixelEditorDebug.services.renderer;
    e.newProject({force:true});const p=e.activePage();
    const raster=M.createNode('raster',{parentId:p.id,x:20,y:20,w:4,h:4,
      pixels:Uint8Array.from([2,2,2,2,2,0,0,2,2,0,0,2,2,2,2,2])});
    e.exec(new C.AddNodesCommand([raster],p.id));
    const before=R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets);
    e.setTransparencyContours(true);
    const sample=(x,y)=>Array.from(e.ctx.getImageData(x,y,1,1).data);
    const edge=sample(21,21),ink=sample(20,20),outside=sample(0,0);
    e.state.selection.replace([raster.id]);e.renderOverlay();
    const selected=sample(21,21);
    e.state.selection.clear();e.renderOverlay();
    const deselected=sample(21,21);
    e.setTransparencyContours(false);
    const restored=sample(21,21),after=R.FramebufferRenderer.renderPage(e.state.project,p.id,e.state.assets);
    return{edge,ink,outside,selected,deselected,restored,unchanged:before.every((v,i)=>v===after[i])};
  });
  expect(result).toEqual({
    edge:[195,225,250,255],ink:[0,0,0,255],outside:[255,255,255,255],
    selected:[195,225,250,255],deselected:[195,225,250,255],
    restored:[255,255,255,255],unchanged:true,
  });
});

test('page eraser stays opaque white and tri-state raster round-trip is byte exact', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const P = window.PixelEditorDebug.services.persistence;
    const T = window.PixelEditorDebug.services.tristateRaster;
    editor.newProject({ force: true });
    const p = editor.activePage();
    p.overlay['5,5'] = 1;
    editor.state.selection.clear();
    editor.pageSelectedId = p.id;
    editor.setTool('eraser');
    editor.beginPaint({ x: 5, y: 5 });
    const gesture = editor.customGesture;
    if (gesture) { editor.customGesture = null; editor.commitPaint(gesture); }
    const raster = M.createNode('raster', { parentId: p.id, x: 1, y: 1, w: 3, h: 1, pixels: Uint8Array.from([0, 1, 2]) });
    editor.exec(new C.AddNodesCommand([raster], p.id));
    const beforeData = raster.raster.data;
    const raw = P.ProjectSerializer.serialize(editor.state.project, editor.state.assets);
    const restored = P.ProjectSerializer.deserialize(raw);
    const restoredRaster = restored.project.pages[0].nodes.find(node => node.type === 'raster');
    return {
      pageOverlayValue: editor.activePage().overlay['5,5'],
      encoding: restoredRaster?.raster?.encoding,
      byteExact: beforeData === restoredRaster?.raster?.data,
      decoded: restoredRaster && T ? [...T.decodeTriStatePixels(restoredRaster.raster.data, 3, 1)] : null,
    };
  });
  expect(result.pageOverlayValue).toBe(0);
  expect(result.encoding).toBe('tristate-packed-v1');
  expect(result.byteExact).toBe(true);
  expect(result.decoded).toEqual([0, 1, 2]);
});
