import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function drawWithTool(page, tool, start, end) {
  return page.evaluate(({ tool, start, end }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    editor.state.selection.clear();
    editor.pageSelectedId = null;
    editor.setTool(tool);
    const before = new Set(editor.activePage().nodes.map(node => node.id));
    editor.beginLiveDraw(tool, start);
    const gesture = editor.customGesture;
    if (!gesture) return null;
    editor.updateLiveDraw(gesture, end);
    editor.customGesture = null;
    editor.commitLiveDraw(gesture);
    const node = editor.activePage().nodes.find(item => !before.has(item.id));
    return node ? { id: node.id, stroke: structuredClone(node.stroke), type: node.type } : null;
  }, { tool, start, end });
}

test('complete V17 workflow survives round-trip and exports opaque black-white PNG pixels', async ({ page }) => {
  await openEditor(page);

  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    editor.setToolDefault('line', 'width', 2);
    editor.setToolDefault('line', 'color', 1);
    editor.setToolDefault('line', 'style', 'short-dash');
    editor.setToolDefault('rectangle', 'width', 3);
    editor.setToolDefault('rectangle', 'color', 0);
    editor.setToolDefault('rectangle', 'style', 'dash-dot');
  });

  const line = await drawWithTool(page, 'line', { x: 12, y: 14 }, { x: 46, y: 24 });
  const rectangle = await drawWithTool(page, 'rectangle', { x: 60, y: 40 }, { x: 89, y: 61 });
  expect(line).not.toBeNull();
  expect(rectangle).not.toBeNull();
  expect(line.stroke).toEqual({ width: 2, color: 1, style: 'short-dash' });
  expect(rectangle.stroke).toEqual({ width: 3, color: 0, style: 'dash-dot' });

  const setup = await page.evaluate(({ lineId, rectangleId }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    const T = window.PixelEditorDebug.services.tristateRaster;
    const source = editor.activePage();

    const raster = M.createNode('raster', {
      parentId: rectangleId,
      x: 66,
      y: 46,
      w: 3,
      h: 3,
      pixels: Uint8Array.from([
        T.RASTER_BLACK, T.RASTER_WHITE, T.RASTER_TRANSPARENT,
        T.RASTER_TRANSPARENT, T.RASTER_BLACK, T.RASTER_WHITE,
        T.RASTER_WHITE, T.RASTER_TRANSPARENT, T.RASTER_BLACK,
      ]),
    });
    const locked = M.createNode('circle', {
      parentId: source.id,
      x: 150,
      y: 30,
      w: 18,
      h: 18,
      locked: true,
      stroke: { width: 1, color: 1, style: 'solid' },
      fill: { mode: 'transparent', color: 1 },
    });
    editor.exec(new C.AddNodesCommand([raster, locked], source.id, '添加工作流节点'));

    editor.state.selection.replace([rectangleId]);
    editor.runSelectionTransform('rotate-angle', 23);
    editor.state.selection.replace([raster.id]);
    editor.runSelectionTransform('rotate-cw-90');

    const previewOn = editor.setBackgroundPreview(true);
    const previewButtonOn = document.querySelector('#backgroundPreviewBtn')?.getAttribute('aria-pressed');
    const previewOff = editor.setBackgroundPreview(false);
    const previewButtonOff = document.querySelector('#backgroundPreviewBtn')?.getAttribute('aria-pressed');

    return {
      sourcePageId: source.id,
      lineId,
      rectangleId,
      rasterId: raster.id,
      lockedId: locked.id,
      previewOn,
      previewOff,
      previewButtonOn,
      previewButtonOff,
      rasterPixels: [...T.decodeTriStatePixels(M.nodeById(source, raster.id).raster.data, 3, 3)],
      rectangleTransform: structuredClone(M.nodeById(source, rectangleId).transform),
      rasterTransform: structuredClone(M.nodeById(source, raster.id).transform),
    };
  }, { lineId: line.id, rectangleId: rectangle.id });

  expect(setup.previewOn).toBe(true);
  expect(setup.previewOff).toBe(false);
  expect(setup.previewButtonOn).toBe('true');
  expect(setup.previewButtonOff).toBe('false');
  expect(new Set(setup.rasterPixels)).toEqual(new Set([0, 1, 2]));
  expect(setup.rectangleTransform.rotation).toBe(23);
  expect(setup.rasterTransform.rotation).toBe(113);

  await page.keyboard.press('Control+A');
  const selectedAll = await page.evaluate(({ lockedId }) => {
    const editor = window.PixelEditorTest.editor;
    return {
      ids: [...editor.state.selection.ids],
      nodeCount: editor.activePage().nodes.length,
      includesLocked: editor.state.selection.has(lockedId),
    };
  }, { lockedId: setup.lockedId });
  expect(selectedAll.ids).toHaveLength(selectedAll.nodeCount);
  expect(selectedAll.includesLocked).toBe(true);

  const crossPage = await page.evaluate(({ rectangleId, rasterId }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;

    editor.state.selection.replace([rectangleId]);
    const payload = editor.copySelection();
    const sourceRoot = payload.nodes.find(node => node.id === rectangleId);
    const sourceChild = payload.nodes.find(node => node.id === rasterId);

    editor.exec(new C.CreatePageCommand('工作流目标页'));
    const target = editor.activePage();
    const countBefore = target.nodes.length;

    const cursorBeforeFirst = editor.bus.cursor;
    const firstPaste = editor.pasteClipboard();
    const firstRootId = editor.state.selection.primaryId;
    const firstRoot = M.nodeById(target, firstRootId);
    const firstChild = new M.TreeModel(target).childrenOf(firstRootId)[0];
    const cursorAfterFirst = editor.bus.cursor;

    const secondPaste = editor.pasteClipboard();
    const secondRootId = editor.state.selection.primaryId;
    const secondRoot = M.nodeById(target, secondRootId);
    const countAfterSecond = target.nodes.length;
    const cursorAfterSecond = editor.bus.cursor;

    const undo = editor.bus.undo();
    editor.renderAll();
    const countAfterUndo = editor.activePage().nodes.length;
    const redo = editor.bus.redo();
    editor.renderAll();
    const countAfterRedo = editor.activePage().nodes.length;

    return {
      payloadRoots: payload.roots,
      payloadNodeCount: payload.nodes.length,
      sourceRoot: { x: sourceRoot.x, y: sourceRoot.y },
      sourceChildParent: sourceChild.parentId,
      firstPaste,
      secondPaste,
      firstRoot: { id: firstRoot.id, x: firstRoot.x, y: firstRoot.y, transform: structuredClone(firstRoot.transform) },
      firstChild: { id: firstChild.id, parentId: firstChild.parentId, transform: structuredClone(firstChild.transform) },
      secondRoot: { id: secondRoot.id, x: secondRoot.x, y: secondRoot.y },
      countBefore,
      countAfterSecond,
      cursorBeforeFirst,
      cursorAfterFirst,
      cursorAfterSecond,
      undo,
      redo,
      countAfterUndo,
      countAfterRedo,
      targetPageId: target.id,
    };
  }, { rectangleId: setup.rectangleId, rasterId: setup.rasterId });

  expect(crossPage.payloadRoots).toEqual([setup.rectangleId]);
  expect(crossPage.payloadNodeCount).toBe(2);
  expect(crossPage.sourceChildParent).toBe(setup.rectangleId);
  expect(crossPage.firstPaste).toBe(true);
  expect(crossPage.secondPaste).toBe(true);
  expect(crossPage.firstRoot.x).toBe(crossPage.sourceRoot.x);
  expect(crossPage.firstRoot.y).toBe(crossPage.sourceRoot.y);
  expect(crossPage.firstRoot.transform.rotation).toBe(23);
  expect(crossPage.firstChild.parentId).toBe(crossPage.firstRoot.id);
  expect(crossPage.firstChild.transform.rotation).toBe(113);
  expect(crossPage.secondRoot.x).toBe(crossPage.sourceRoot.x + 8);
  expect(crossPage.secondRoot.y).toBe(crossPage.sourceRoot.y + 8);
  expect(crossPage.cursorAfterFirst - crossPage.cursorBeforeFirst).toBe(1);
  expect(crossPage.cursorAfterSecond - crossPage.cursorAfterFirst).toBe(1);
  expect(crossPage.undo).toBe(true);
  expect(crossPage.redo).toBe(true);
  expect(crossPage.countAfterUndo).toBe(crossPage.countAfterSecond - 2);
  expect(crossPage.countAfterRedo).toBe(crossPage.countAfterSecond);

  const roundTrip = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const P = window.PixelEditorDebug.services.persistence;
    const R = window.PixelEditorDebug.services.renderer;
    const M = window.PixelEditorDebug.services.model;

    const before = R.FramebufferRenderer.renderPage(editor.state.project, editor.activePage().id, editor.state.assets);
    const raw = P.ProjectSerializer.serialize(editor.state.project, editor.state.assets);
    const parsed = JSON.parse(raw);
    const restored = P.ProjectSerializer.deserialize(raw);
    const after = R.FramebufferRenderer.renderPage(restored.project, restored.project.activePageId, restored.assets);
    let sameFramebuffer = before.length === after.length;
    for (let index = 0; sameFramebuffer && index < before.length; index += 1) sameFramebuffer = before[index] === after[index];

    const savedRaster = parsed.pages.flatMap(page => page.nodes).find(node => node.type === 'raster');
    const savedStyledShape = parsed.pages.flatMap(page => page.nodes).find(node => node.type === 'rectangle' && node.stroke?.style === 'dash-dot');
    const preferencesBeforeRestore = structuredClone(editor.editorPreferences);

    editor.state.project = restored.project;
    editor.state.assets = restored.assets;
    editor.state.selection.clear();
    editor.pageSelectedId = restored.project.activePageId;
    editor.renderAll();
    const canvas = editor.exportPng();
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = true;
    let blackWhiteOnly = true;
    for (let index = 0; index < rgba.length; index += 4) {
      if (rgba[index + 3] !== 255) opaque = false;
      const r = rgba[index], g = rgba[index + 1], b = rgba[index + 2];
      if (r !== g || g !== b || (r !== 0 && r !== 255)) blackWhiteOnly = false;
    }

    return {
      version: parsed.version,
      hasWorkspaceLayout: Object.hasOwn(parsed, 'workspaceLayout'),
      hasTools: Object.hasOwn(parsed, 'tools'),
      hasBackgroundPreview: Object.hasOwn(parsed, 'hidePageBackground'),
      hasEditorPreferences: Object.hasOwn(parsed, 'editorPreferences'),
      savedRasterEncoding: savedRaster?.raster?.encoding,
      savedRasterTransform: savedRaster?.transform,
      savedStyledShapeStroke: savedStyledShape?.stroke,
      savedStyledShapeTransform: savedStyledShape?.transform,
      sameFramebuffer,
      opaque,
      blackWhiteOnly,
      preferencesBeforeRestore,
      preferencesAfterRestore: structuredClone(editor.editorPreferences),
      testApiVersion: window.PixelEditorTest.version,
      pageCount: restored.project.pages.length,
      hierarchyValid: restored.project.pages.every(page => new M.TreeModel(page).validateHierarchy()),
    };
  });

  expect(roundTrip.version).toBe(17);
  expect(roundTrip.testApiVersion).toBe(17);
  expect(roundTrip.hasWorkspaceLayout).toBe(false);
  expect(roundTrip.hasTools).toBe(false);
  expect(roundTrip.hasBackgroundPreview).toBe(false);
  expect(roundTrip.hasEditorPreferences).toBe(false);
  expect(roundTrip.savedRasterEncoding).toBe('tristate-packed-v1');
  expect(roundTrip.savedRasterTransform.rotation).toBe(113);
  expect(roundTrip.savedStyledShapeStroke).toEqual({ width: 3, color: 0, style: 'dash-dot' });
  expect(roundTrip.savedStyledShapeTransform.rotation).toBe(23);
  expect(roundTrip.sameFramebuffer).toBe(true);
  expect(roundTrip.opaque).toBe(true);
  expect(roundTrip.blackWhiteOnly).toBe(true);
  expect(roundTrip.preferencesAfterRestore).toEqual(roundTrip.preferencesBeforeRestore);
  expect(roundTrip.preferencesAfterRestore.tools.rectangle).toEqual({ width: 3, color: 0, style: 'dash-dot', fill: { mode: 'transparent', color: 1 } });
  expect(roundTrip.preferencesAfterRestore.hidePageBackground).toBe(false);
  expect(roundTrip.pageCount).toBe(2);
  expect(roundTrip.hierarchyValid).toBe(true);
});
