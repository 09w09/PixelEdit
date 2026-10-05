import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('page lifecycle keeps a valid active page and unique hierarchy', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    editor.exec(new C.CreatePageCommand('第二页'));
    const secondId = editor.activePage().id;
    editor.exec(new C.RenamePageCommand(secondId, '重命名页面'));
    editor.exec(new C.DuplicatePageCommand(secondId));
    const duplicateId = editor.activePage().id;
    editor.exec(new C.ReorderPageCommand(duplicateId, 0));
    const orderAfterMove = editor.state.project.pages.map(item => item.id);
    editor.exec(new C.DeletePageCommand(duplicateId));
    return {
      pageCount: editor.state.project.pages.length,
      names: editor.state.project.pages.map(item => item.name),
      duplicateMovedToFront: orderAfterMove[0] === duplicateId,
      activePageExists: editor.state.project.pages.some(item => item.id === editor.state.project.activePageId),
      uniqueIds: new Set(editor.state.project.pages.map(item => item.id)).size === editor.state.project.pages.length,
    };
  });
  expect(result.pageCount).toBe(2);
  expect(result.names).toContain('重命名页面');
  expect(result.duplicateMovedToFront).toBe(true);
  expect(result.activePageExists).toBe(true);
  expect(result.uniqueIds).toBe(true);
});

test('layer hierarchy rejects cycles and inherited locks prevent child edits', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const activePage = editor.activePage();
    const parent = M.createNode('rectangle', { parentId: activePage.id, name: 'parent', x: 10, y: 10, w: 40, h: 40 });
    const child = M.createNode('circle', { parentId: parent.id, name: 'child', x: 15, y: 15, w: 10, h: 10 });
    editor.exec(new C.AddNodesCommand([parent, child], activePage.id));
    const tree = new M.TreeModel(activePage);
    const cycleAccepted = editor.exec(new C.ReparentCommand([parent.id], child.id, null, activePage.id));
    editor.exec(new C.ToggleLockCommand([parent.id], true, activePage.id));
    const childXBefore = M.nodeById(activePage, child.id).x;
    const childEditAccepted = editor.exec(new C.UpdateNodesCommand([child.id], { x: 99 }, activePage.id));
    return {
      cycleAccepted,
      childEditAccepted,
      childXBefore,
      childXAfter: M.nodeById(activePage, child.id).x,
      childInheritedLocked: new M.TreeModel(activePage).isInheritedLocked(child.id),
      hierarchyValid: tree.validateHierarchy(),
    };
  });
  expect(result.cycleAccepted).toBe(false);
  expect(result.childEditAccepted).toBe(false);
  expect(result.childXAfter).toBe(result.childXBefore);
  expect(result.childInheritedLocked).toBe(true);
  expect(result.hierarchyValid).toBe(true);
});

test('rectangle, circle, line, polygon and text all render into the 1-bit framebuffer', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const R = window.PixelEditorDebug.services.renderer;
    editor.newProject({ force: true });
    const activePage = editor.activePage();
    const nodes = [
      M.createNode('rectangle', { parentId: activePage.id, x: 5, y: 5, w: 30, h: 20, stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'solid', color: 1 } }),
      M.createNode('circle', { parentId: activePage.id, x: 45, y: 5, w: 24, h: 24, stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'solid', color: 1 } }),
      M.createNode('line', { parentId: activePage.id, x1: 80, y1: 5, x2: 110, y2: 30, stroke: { width: 2, color: 1, style: 'solid' } }),
      M.createNode('polygon', { parentId: activePage.id, points: [{ x: 120, y: 30 }, { x: 135, y: 5 }, { x: 150, y: 30 }], stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'solid', color: 1 } }),
      M.createNode('text', { parentId: activePage.id, x: 160, y: 5, w: 80, h: 28, text: 'Pixel', fontSize: 18, fill: { mode: 'solid', color: 1 } }),
    ];
    editor.exec(new C.AddNodesCommand(nodes, activePage.id));
    const framebuffer = R.FramebufferRenderer.renderPage(editor.state.project, activePage.id, editor.state.assets);
    return {
      types: Object.fromEntries(['rectangle', 'circle', 'line', 'polygon', 'text'].map(type => [type, activePage.nodes.filter(node => node.type === type).length])),
      blackPixels: framebuffer.reduce((sum, pixel) => sum + pixel, 0),
      onlyBinary: framebuffer.every(pixel => pixel === 0 || pixel === 1),
    };
  });
  expect(result.types).toEqual({ rectangle: 1, circle: 1, line: 1, polygon: 1, text: 1 });
  expect(result.blackPixels).toBeGreaterThan(500);
  expect(result.onlyBinary).toBe(true);
});

test('dither and pattern primitives preserve deterministic black/white semantics', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const R = window.PixelEditorDebug.services.renderer;
    const ditherZero = [];
    const ditherFull = [];
    const pattern = [];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        ditherZero.push(R.graphicDitherPixel({ type: 'bayer', density: 0, matrix: 4 }, x, y, x, y));
        ditherFull.push(R.graphicDitherPixel({ type: 'bayer', density: 100, matrix: 4 }, x, y, x, y));
        pattern.push(R.patternPixel({ type: 'horizontal', lineWidth: 1, gap: 1 }, x, y, x, y));
      }
    }
    return {
      zeroBlack: ditherZero.reduce((a, b) => a + b, 0),
      fullBlack: ditherFull.reduce((a, b) => a + b, 0),
      patternBlack: pattern.reduce((a, b) => a + b, 0),
    };
  });
  expect(result.zeroBlack).toBe(0);
  expect(result.fullBlack).toBe(64);
  expect(result.patternBlack).toBe(32);
});

test('move, align and distribute commands keep editable geometry consistent', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const activePage = editor.activePage();
    const nodes = [
      M.createNode('rectangle', { parentId: activePage.id, x: 10, y: 10, w: 10, h: 10 }),
      M.createNode('rectangle', { parentId: activePage.id, x: 40, y: 20, w: 10, h: 10 }),
      M.createNode('rectangle', { parentId: activePage.id, x: 100, y: 30, w: 10, h: 10 }),
    ];
    editor.exec(new C.AddNodesCommand(nodes, activePage.id));
    editor.exec(new C.MoveSelectionCommand([nodes[0].id], 5, 7, activePage.id));
    editor.exec(new C.AlignCommand('top', nodes.map(node => node.id), editor.state.assets, activePage.id));
    editor.exec(new C.DistributeCommand('horizontal', nodes.map(node => node.id), editor.state.assets, activePage.id));
    return nodes.map(node => {
      const current = M.nodeById(activePage, node.id);
      return { x: current.x, y: current.y, w: current.w, h: current.h };
    });
  });
  expect(new Set(result.map(item => item.y)).size).toBe(1);
  expect(result[0].x).toBe(15);
  expect(result[0].x).toBeLessThan(result[1].x);
  expect(result[1].x).toBeLessThan(result[2].x);
  const gapA = result[1].x - result[0].x;
  const gapB = result[2].x - result[1].x;
  expect(Math.abs(gapA - gapB)).toBeLessThanOrEqual(1);
});

test('clipboard duplication preserves complete parent-child subtrees with new IDs', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const activePage = editor.activePage();
    const parent = M.createNode('rectangle', { parentId: activePage.id, name: 'parent', x: 10, y: 10, w: 30, h: 30 });
    const child = M.createNode('circle', { parentId: parent.id, name: 'child', x: 15, y: 15, w: 10, h: 10 });
    editor.exec(new C.AddNodesCommand([parent, child], activePage.id));
    editor.state.selection.replace([parent.id]);
    const payload = editor.clipboard.copy(editor.state.project, activePage.id, editor.state.selection);
    editor.exec(new C.PasteCommand(payload, 1, activePage.id));
    const rectangles = activePage.nodes.filter(node => node.type === 'rectangle');
    const circles = activePage.nodes.filter(node => node.type === 'circle');
    const tree = new M.TreeModel(activePage);
    const copiedRoot = rectangles.find(node => node.id !== parent.id);
    const copiedChildren = tree.childrenOf(copiedRoot.id);
    return {
      rectangleCount: rectangles.length,
      circleCount: circles.length,
      copiedRootHasNewId: copiedRoot.id !== parent.id,
      copiedChildCount: copiedChildren.length,
      copiedChildHasNewId: copiedChildren[0]?.id !== child.id,
      hierarchyValid: tree.validateHierarchy(),
    };
  });
  expect(result.rectangleCount).toBe(2);
  expect(result.circleCount).toBe(2);
  expect(result.copiedRootHasNewId).toBe(true);
  expect(result.copiedChildCount).toBe(1);
  expect(result.copiedChildHasNewId).toBe(true);
  expect(result.hierarchyValid).toBe(true);
});

test('project serialization round-trip preserves referenced image assets and hierarchy', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const P = window.PixelEditorDebug.services.persistence;
    editor.newProject({ force: true });
    const activePage = editor.activePage();
    const assetId = editor.state.assets.add('image', 'data:image/png;base64,AA==', { name: 'test.png', mime: 'image/png' });
    const imageNode = M.createNode('image', { parentId: activePage.id, x: 1, y: 2, w: 3, h: 4, assetId, sourceWidth: 3, sourceHeight: 4, sourceName: 'test.png' });
    editor.exec(new C.AddNodesCommand([imageNode], activePage.id));
    const raw = P.ProjectSerializer.serialize(editor.state.project, editor.state.assets);
    const restored = P.ProjectSerializer.deserialize(raw);
    const restoredPage = restored.project.pages[0];
    const restoredNode = restoredPage.nodes.find(node => node.type === 'image');
    return {
      projectVersion: restored.project.version,
      imageAssetId: restoredNode.assetId,
      assetExists: restored.assets.has(restoredNode.assetId),
      hierarchyValid: new M.TreeModel(restoredPage).validateHierarchy(),
      serializedAssetCount: JSON.parse(raw).assets.length,
    };
  });
  expect(result.projectVersion).toBe(17);
  expect(result.assetExists).toBe(true);
  expect(result.hierarchyValid).toBe(true);
  expect(result.serializedAssetCount).toBe(1);
  expect(result.imageAssetId).toBeTruthy();
});

test('XBM import keeps exact source pixels and dimensions', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const xbm = `#define icon_width 8\n#define icon_height 2\nstatic unsigned char icon_bits[] = { 0x0f, 0xf0 };`;
    const node = await editor.importXbmText(xbm, 'icon.xbm');
    const runtime = editor.state.assets.getRuntime(node.assetId);
    return {
      sourceType: node.sourceType,
      sourceWidth: node.sourceWidth,
      sourceHeight: node.sourceHeight,
      runtimeWidth: runtime.width,
      runtimeHeight: runtime.height,
      firstPixel: runtime.data[0],
      lastPixelAlpha: runtime.data[runtime.data.length - 1],
    };
  });
  expect(result.sourceType).toBe('xbm');
  expect(result.sourceWidth).toBe(8);
  expect(result.sourceHeight).toBe(2);
  expect(result.runtimeWidth).toBe(8);
  expect(result.runtimeHeight).toBe(2);
  expect(result.firstPixel).toBe(0);
  expect(result.lastPixelAlpha).toBe(255);
});

test('zoom state and pixel-grid threshold remain stable', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const api = window.PixelEditorTest;
    const editor = api.editor;
    editor.setZoom(8);
    const high = { zoom: api.getZoom(), grid: api.isPixelGridVisible() };
    editor.setZoom(1);
    const low = { zoom: api.getZoom(), grid: api.isPixelGridVisible() };
    return { high, low };
  });
  expect(result.high).toEqual({ zoom: 8, grid: true });
  expect(result.low).toEqual({ zoom: 1, grid: false });
});
