import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function properIntersect(a, b, c, d) {
  const ab1 = orientation(a, b, c);
  const ab2 = orientation(a, b, d);
  const cd1 = orientation(c, d, a);
  const cd2 = orientation(c, d, b);
  return ab1 * ab2 < -1e-9 && cd1 * cd2 < -1e-9;
}

function selfIntersects(points) {
  return points.length === 4 && (
    properIntersect(points[0], points[1], points[2], points[3])
    || properIntersect(points[1], points[2], points[3], points[0])
  );
}

test('V17 cross-subsystem workflow stays canonical through edit, save/load and export', async ({ page }) => {
  await openEditor(page);

  const result = await page.evaluate(() => {
    const PE = window.PixelEditorDebug.services;
    const editor = window.PixelEditorTest.editor;
    const M = PE.model;
    const C = PE.commands;
    const G = PE.selectionGeometry;
    const P = PE.persistence;

    editor.newProject({ force: true });
    const activePage = editor.activePage();
    activePage.fill = { mode: 'solid', color: 1 };

    // Shape creation must snapshot tool defaults rather than read them later.
    editor.setToolDefault('rectangle', 'width', 3);
    editor.setToolDefault('rectangle', 'color', 1);
    editor.setToolDefault('rectangle', 'style', 'dash-dot');
    editor.setToolDefault('rectangle', 'fill', { mode: 'solid', color: 0 });
    editor.state.selection.clear();
    editor.setTool('rectangle');
    editor.beginLiveDraw('rectangle', { x: 40, y: 50 });
    editor.updateLiveDraw(editor.customGesture, { x: 92, y: 82 });
    const shapeId = editor.customGesture.nodeId;
    const shapeGesture = editor.customGesture;
    editor.customGesture = null;
    editor.commitLiveDraw(shapeGesture);
    const createdShape = M.nodeById(editor.activePage(), shapeId);
    const createdStyle = {
      stroke: structuredClone(createdShape.stroke),
      fill: structuredClone(createdShape.fill),
    };

    // Mirror + arbitrary rotation must keep one perimeter-ordered selection outline.
    editor.state.selection.replace([shapeId]);
    editor.runSelectionTransform('flip-horizontal');
    editor.runSelectionTransform('rotate-angle', 23);
    const transformedShape = M.nodeById(editor.activePage(), shapeId);
    const selectionGeometry = G.selectionGeometry(transformedShape);
    editor.renderOverlay();
    const overlayPoints = [...(editor.overlay.querySelector('polygon.selection-box')?.points || [])]
      .map(point => ({ x: point.x, y: point.y }));

    // Three matching moves are one semantic history entry; another operation splits it.
    const beforeMoves = editor.bus.entries.length;
    for (let index = 0; index < 3; index += 1) {
      editor.bus.execute(new C.MoveSelectionCommand([shapeId], 1, 0, editor.activePage().id));
    }
    const afterMoves = editor.bus.entries.length;
    editor.runSelectionTransform('rotate-cw-90');
    const afterDifferentOperation = editor.bus.entries.length;

    // Fixed-size text -> scalable text transition must restore last scalable size.
    const fixedFamily = 'Imported_E2E_fixed_18';
    const fontAssetId = editor.state.assets.add('font', 'data:font/woff2;base64,AA==', {
      name: 'E2E_18px.woff2', mime: 'font/woff2', sha256: 'e2e-fixed-font-sha',
    });
    editor.state.project.fonts.push({
      name: 'E2E_18px.woff2', family: fixedFamily, fixedSize: 18,
      assetId: fontAssetId, sha256: 'e2e-fixed-font-sha',
    });
    editor.setToolDefault('text', 'lastScalableFontSize', 27);
    editor.setToolDefault('text', 'fontSize', 27);
    editor.setToolDefault('text', 'fontFamily', fixedFamily);
    editor.state.selection.clear();
    editor.setTool('text');
    const fixedUi = {
      family: document.querySelector('#toolOptionFont')?.value,
      size: Number(document.querySelector('#toolOptionFontSize')?.value),
      disabled: document.querySelector('#toolOptionFontSize')?.disabled,
    };
    editor.beginLiveDraw('text', { x: 120, y: 35 });
    editor.updateLiveDraw(editor.customGesture, { x: 185, y: 62 });
    const fixedTextId = editor.customGesture.nodeId;
    const fixedGesture = editor.customGesture;
    editor.customGesture = null;
    editor.commitLiveDraw(fixedGesture);

    editor.setTool('text');
    const fontSelect = document.querySelector('#toolOptionFont');
    fontSelect.value = 'sans-serif';
    fontSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const scalableDefaults = structuredClone(editor.getToolDefaults('text'));
    editor.state.selection.clear();
    editor.beginLiveDraw('text', { x: 120, y: 80 });
    editor.updateLiveDraw(editor.customGesture, { x: 190, y: 108 });
    const scalableTextId = editor.customGesture.nodeId;
    const scalableGesture = editor.customGesture;
    editor.customGesture = null;
    editor.commitLiveDraw(scalableGesture);

    const fixedText = M.nodeById(editor.activePage(), fixedTextId);
    const scalableText = M.nodeById(editor.activePage(), scalableTextId);

    // Binary image conversion is one final inversion stage and preserves transparency.
    const imageData = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 0,
    ]);
    const imageAssetId = editor.state.assets.add('image', 'data:image/png;base64,AA==', {
      name: 'alpha.png', mime: 'image/png',
    });
    editor.state.assets.setRuntime(imageAssetId, { width: 2, height: 1, data: imageData });
    const imageNode = M.createNode('image', {
      parentId: editor.activePage().id,
      x: 220, y: 30, w: 2, h: 1,
      assetId: imageAssetId,
      sourceWidth: 2, sourceHeight: 1, sourceName: 'alpha.png', sourceType: 'bitmap',
      image: {
        fit: 'stretch', interpolation: 'nearest', cropX: 0, cropY: 0, cropW: 2, cropH: 1,
        bwMode: 'threshold', threshold: 128, invert: true, ditherAlgorithm: 'bayer', bayerMatrix: 4,
      },
    });
    editor.exec(new C.AddNodesCommand([imageNode], editor.activePage().id));
    const binary = PE.binaryImage.binaryImageForNode(imageNode, editor.state.assets);

    // The app owns contextmenu everywhere: canvas may open PixelEdit menu; toolbar may not.
    editor.renderAll();
    editor.closeContextMenu();
    const canvas = document.querySelector('#screenCanvas');
    const canvasRect = canvas.getBoundingClientRect();
    const canvasEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: canvasRect.left + (220.5 / 400) * canvasRect.width,
      clientY: canvasRect.top + (30.5 / 300) * canvasRect.height,
    });
    canvas.dispatchEvent(canvasEvent);
    const menu = document.querySelector('#contextMenu');
    const canvasMenu = {
      prevented: canvasEvent.defaultPrevented,
      open: menu.classList.contains('open'),
      source: menu.dataset.source,
    };
    const toolbarEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    document.querySelector('#globalToolbar').dispatchEvent(toolbarEvent);
    const toolbarMenu = {
      prevented: toolbarEvent.defaultPrevented,
      open: menu.classList.contains('open'),
    };

    // Save/load must retain canonical state without compatibility fields.
    const serialized = P.ProjectSerializer.serialize(editor.state.project, editor.state.assets);
    const restored = P.ProjectSerializer.deserialize(serialized);
    const restoredPage = restored.project.pages.find(item => item.id === editor.activePage().id);
    const restoredShape = M.nodeById(restoredPage, shapeId);
    const restoredFixedText = M.nodeById(restoredPage, fixedTextId);
    const restoredScalableText = M.nodeById(restoredPage, scalableTextId);
    const restoredImage = M.nodeById(restoredPage, imageNode.id);

    // Actual PNG export must remain opaque 1-bit RGB across the full 400x300 image.
    const exportCanvas = editor.exportPng();
    const exported = exportCanvas.getContext('2d').getImageData(0, 0, 400, 300).data;
    let opaque = true;
    let binaryRgb = true;
    for (let offset = 0; offset < exported.length; offset += 4) {
      opaque &&= exported[offset + 3] === 255;
      binaryRgb &&= exported[offset] === exported[offset + 1]
        && exported[offset + 1] === exported[offset + 2]
        && (exported[offset] === 0 || exported[offset] === 255);
      if (!opaque || !binaryRgb) break;
    }

    return {
      version: restored.project.version,
      createdStyle,
      geometry: selectionGeometry,
      overlayPoints,
      history: { beforeMoves, afterMoves, afterDifferentOperation },
      fixedUi,
      scalableDefaults,
      text: {
        fixed: { family: fixedText.fontFamily, fontSize: fixedText.fontSize, fixedSize: fixedText.fixedFontSize },
        scalable: { family: scalableText.fontFamily, fontSize: scalableText.fontSize, fixedSize: scalableText.fixedFontSize },
      },
      binary: { bits: Array.from(binary.bits), alpha: Array.from(binary.alpha) },
      context: { canvasMenu, toolbarMenu },
      restored: {
        shape: { stroke: restoredShape.stroke, fill: restoredShape.fill, transform: restoredShape.transform, hasLineWidth: Object.hasOwn(restoredShape, 'lineWidth') },
        fixedText: { family: restoredFixedText.fontFamily, fontSize: restoredFixedText.fontSize, fixedSize: restoredFixedText.fixedFontSize },
        scalableText: { family: restoredScalableText.fontFamily, fontSize: restoredScalableText.fontSize, fixedSize: restoredScalableText.fixedFontSize },
        image: structuredClone(restoredImage.image),
      },
      export: { opaque, binaryRgb, width: exportCanvas.width, height: exportCanvas.height },
    };
  });

  expect(result.version).toBe(17);
  expect(result.createdStyle).toEqual({
    stroke: { width: 3, color: 1, style: 'dash-dot' },
    fill: { mode: 'solid', color: 0 },
  });
  expect(result.geometry.outline).toEqual([
    result.geometry.handles.nw,
    result.geometry.handles.ne,
    result.geometry.handles.se,
    result.geometry.handles.sw,
  ]);
  expect(selfIntersects(result.geometry.outline)).toBe(false);
  expect(result.overlayPoints).toHaveLength(4);
  expect(selfIntersects(result.overlayPoints)).toBe(false);
  expect(result.history.afterMoves).toBe(result.history.beforeMoves + 1);
  expect(result.history.afterDifferentOperation).toBe(result.history.afterMoves + 1);
  expect(result.fixedUi).toEqual({ family: 'Imported_E2E_fixed_18', size: 18, disabled: true });
  expect(result.scalableDefaults.fontFamily).toBe('sans-serif');
  expect(result.scalableDefaults.fontSize).toBe(27);
  expect(result.scalableDefaults.lastScalableFontSize).toBe(27);
  expect(result.text.fixed).toEqual({ family: 'Imported_E2E_fixed_18', fontSize: 18, fixedSize: 18 });
  expect(result.text.scalable).toEqual({ family: 'sans-serif', fontSize: 27, fixedSize: null });
  expect(result.binary).toEqual({ bits: [0, 0], alpha: [1, 0] });
  expect(result.context.canvasMenu).toEqual({ prevented: true, open: true, source: 'canvas' });
  expect(result.context.toolbarMenu).toEqual({ prevented: true, open: false });
  expect(result.restored.shape.stroke).toEqual({ width: 3, color: 1, style: 'dash-dot' });
  expect(result.restored.shape.fill).toEqual({ mode: 'solid', color: 0 });
  expect(result.restored.shape.hasLineWidth).toBe(false);
  expect(result.restored.shape.transform.rotation).not.toBe(0);
  expect(result.restored.fixedText).toEqual(result.text.fixed);
  expect(result.restored.scalableText).toEqual(result.text.scalable);
  expect(result.restored.image.invert).toBe(true);
  expect(result.export).toEqual({ opaque: true, binaryRgb: true, width: 400, height: 300 });
});
