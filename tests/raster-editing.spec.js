import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('raster nodes persist packed one-bit pixels without image source properties', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const M = window.PixelEditor.model;
    const L = window.PixelEditor.rasterLayer;
    const input = Uint8Array.from([1, 0, 1, 0, 1, 0]);
    const node = M.createNode('raster', { x: 3, y: 4, w: 3, h: 2, pixels: input });
    const decoded = L?.decodeRasterPixels?.(node.raster.data, node.w, node.h);
    return {
      type: node.type,
      encoding: node.raster?.encoding,
      decoded: decoded ? [...decoded] : null,
      hasImageOptions: Object.hasOwn(node, 'image'),
      hasAssetId: Object.hasOwn(node, 'assetId'),
    };
  });
  expect(result).toEqual({
    type: 'raster', encoding: 'bitset-base64-v1', decoded: [1, 0, 1, 0, 1, 0], hasImageOptions: false, hasAssetId: false,
  });
});

test('raster resize expands white and crops/translates pixels without resampling', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const M = window.PixelEditor.model;
    const L = window.PixelEditor.rasterLayer;
    const node = M.createNode('raster', { x: 10, y: 10, w: 2, h: 2, pixels: Uint8Array.from([1, 0, 0, 1]) });
    const expanded = L?.resizeRaster?.(node, { x: 9, y: 9, w: 4, h: 4 });
    const expandedPixels = expanded && L.decodeRasterPixels(expanded.raster.data, expanded.w, expanded.h);
    const cropped = L?.resizeRaster?.(node, { x: 10, y: 10, w: 1, h: 1 });
    const croppedPixels = cropped && L.decodeRasterPixels(cropped.raster.data, cropped.w, cropped.h);
    const black = [];
    if (expandedPixels) for (let y = 0; y < expanded.h; y++) for (let x = 0; x < expanded.w; x++) if (expandedPixels[y * expanded.w + x]) black.push([x, y]);
    return { black, cropped: croppedPixels ? [...croppedPixels] : null };
  });
  expect(result.black).toEqual([[1, 1], [2, 2]]);
  expect(result.cropped).toEqual([1]);
});

test('source images reject painting while raster layers accept exact pencil and eraser edits', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const L = window.PixelEditor.rasterLayer;
    editor.newProject({ force: true });
    const activePage = editor.activePage();
    const assetId = editor.state.assets.add('image', '', { name: 'source.png', mime: 'image/png' });
    editor.state.assets.setRuntime(assetId, { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) });
    const image = M.createNode('image', { parentId: activePage.id, x: 0, y: 0, w: 2, h: 2, assetId, sourceWidth: 2, sourceHeight: 2 });
    editor.exec(new C.AddNodesCommand([image], activePage.id));
    editor.state.selection.replace([image.id]);
    const imageTarget = editor.paintTarget();

    const raster = M.createNode('raster', { parentId: activePage.id, x: 5, y: 5, w: 3, h: 3 });
    editor.exec(new C.AddNodesCommand([raster], activePage.id));
    editor.state.selection.replace([raster.id]);
    const rasterTarget = editor.paintTarget();
    const painted = L?.paintRaster?.(raster, [{ x: 1, y: 1 }], 1);
    const erased = painted && L.paintRaster({ ...raster, raster: painted }, [{ x: 1, y: 1 }], 0);
    return {
      imageTarget: imageTarget?.kind || null,
      rasterTarget: rasterTarget?.kind || null,
      paintedCenter: painted ? L.decodeRasterPixels(painted.data, 3, 3)[4] : null,
      erasedCenter: erased ? L.decodeRasterPixels(erased.data, 3, 3)[4] : null,
    };
  });
  expect(result).toEqual({ imageTarget: null, rasterTarget: 'node', paintedCenter: 1, erasedCenter: 0 });
});

test('rasterize converts source image and vector/text/shape subtrees into fixed raster nodes', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    window.confirm = () => true;
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const L = window.PixelEditor.rasterLayer;
    editor.newProject({ force: true });
    const activePage = editor.activePage();

    const assetId = editor.state.assets.add('image', '', { name: 'grid.png', mime: 'image/png' });
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    editor.state.assets.setRuntime(assetId, { width: 2, height: 2, data: rgba });
    const image = M.createNode('image', { parentId: activePage.id, x: 2, y: 2, w: 2, h: 2, assetId, sourceWidth: 2, sourceHeight: 2 });
    editor.exec(new C.AddNodesCommand([image], activePage.id));
    editor.state.selection.replace([image.id]);
    const imageOk = await editor.rasterizeSelected();
    const imageRaster = M.nodeById(activePage, image.id);
    const imagePixels = imageRaster?.type === 'raster' ? [...L.decodeRasterPixels(imageRaster.raster.data, imageRaster.w, imageRaster.h)] : null;

    const parent = M.createNode('rectangle', { parentId: activePage.id, x: 20, y: 20, w: 20, h: 12, fill: { mode: 'solid' } });
    const child = M.createNode('text', { parentId: parent.id, x: 22, y: 22, w: 14, h: 8, text: 'A', fontSize: 7 });
    editor.exec(new C.AddNodesCommand([parent, child], activePage.id));
    editor.state.selection.replace([parent.id]);
    const subtreeOk = await editor.rasterizeSelected();
    const subtree = M.nodeById(activePage, parent.id);
    const childStillExists = Boolean(M.nodeById(activePage, child.id));

    return { imageOk, imageType: imageRaster?.type, imagePixels, subtreeOk, subtreeType: subtree?.type, childStillExists };
  });
  expect(result.imageOk).toBe(true);
  expect(result.imageType).toBe('raster');
  expect(result.imagePixels).toEqual([1, 0, 0, 1]);
  expect(result.subtreeOk).toBe(true);
  expect(result.subtreeType).toBe('raster');
  expect(result.childStillExists).toBe(false);
});

test('raster nodes round-trip through pix serialization without image assets', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const P = window.PixelEditor.persistence;
    const L = window.PixelEditor.rasterLayer;
    editor.newProject({ force: true });
    const activePage = editor.activePage();
    const raster = M.createNode('raster', { parentId: activePage.id, x: 7, y: 8, w: 3, h: 2, pixels: Uint8Array.from([1, 1, 0, 0, 1, 0]) });
    editor.exec(new C.AddNodesCommand([raster], activePage.id));
    const raw = P.ProjectSerializer.serialize(editor.state.project, editor.state.assets);
    const parsed = JSON.parse(raw);
    const restored = P.ProjectSerializer.deserialize(raw);
    const node = restored.project.pages[0].nodes.find(n => n.type === 'raster');
    return {
      assets: parsed.assets.length,
      type: node?.type,
      pixels: node ? [...L.decodeRasterPixels(node.raster.data, node.w, node.h)] : null,
    };
  });
  expect(result).toEqual({ assets: 0, type: 'raster', pixels: [1, 1, 0, 0, 1, 0] });
});
