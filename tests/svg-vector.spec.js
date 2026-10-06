import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('core editor boot, render, undo and redo remain functional', async ({ page }) => {
  await openEditor(page);

  const result = await page.evaluate(() => {
    const api = window.PixelEditorTest;
    const editor = api.editor;
    editor.newProject({ force: true });

    api.createNode('rectangle', {
      x: 4,
      y: 5,
      w: 20,
      h: 12,
      lineWidth: 1,
      fill: { mode: 'solid' },
    });

    const beforeUndo = {
      count: api.countType('rectangle'),
      blackPixels: api.previewFramebufferBlackCount(),
      hierarchyValid: api.validateHierarchy(),
    };

    const undoResult = editor.bus.undo();
    editor.renderAll();
    const afterUndo = api.countType('rectangle');

    const redoResult = editor.bus.redo();
    editor.renderAll();
    const afterRedo = api.countType('rectangle');

    return { beforeUndo, undoResult, afterUndo, redoResult, afterRedo };
  });

  expect(result.beforeUndo.count).toBe(1);
  expect(result.beforeUndo.blackPixels).toBeGreaterThan(0);
  expect(result.beforeUndo.hierarchyValid).toBe(true);
  expect(result.undoResult).toBe(true);
  expect(result.afterUndo).toBe(0);
  expect(result.redoResult).toBe(true);
  expect(result.afterRedo).toBe(1);
});

test('SVG is rerasterized from vector source at the current target size', async ({ page }) => {
  await openEditor(page);

  const metrics = await page.evaluate(async () => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="2.55" fill="black"/></svg>';
    const node = await editor.importSvgText(svg, 'circle.svg');
    node.w = 64;
    node.h = 64;
    node.image.fit = 'stretch';
    node.image.cropX = 0;
    node.image.cropY = 0;
    node.image.cropW = 8;
    node.image.cropH = 8;

    const state = window.PixelEditorTest.getState();
    const rendered = window.PixelEditorDebug.services.renderer.ImageRenderer.render(node, state.assets);

    const directImage = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(directImage, 0, 0, 64, 64);
    const reference = context.getImageData(0, 0, 64, 64).data;

    let absoluteError = 0;
    for (let i = 0; i < reference.length; i += 1) {
      absoluteError += Math.abs(reference[i] - rendered.data[i]);
    }

    let mixedBlocks = 0;
    for (let blockY = 0; blockY < 8; blockY += 1) {
      for (let blockX = 0; blockX < 8; blockX += 1) {
        const values = new Set();
        for (let y = blockY * 8; y < (blockY + 1) * 8; y += 1) {
          for (let x = blockX * 8; x < (blockX + 1) * 8; x += 1) {
            const offset = (y * 64 + x) * 4;
            values.add(`${rendered.data[offset]},${rendered.data[offset + 3]}`);
          }
        }
        if (values.size > 1) mixedBlocks += 1;
      }
    }

    return {
      meanAbsoluteError: absoluteError / reference.length,
      mixedBlocks,
      runtimeKind: state.assets.getRuntime(node.assetId)?.kind || null,
    };
  });

  expect(metrics.meanAbsoluteError).toBeLessThan(0.5);
  expect(metrics.mixedBlocks).toBeGreaterThan(0);
  expect(metrics.runtimeKind).toBe('svg-vector');
});

test('serialized SVG stays vector-backed after project hydration', async ({ page }) => {
  await openEditor(page);

  const result = await page.evaluate(async () => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><path d="M0 8 L8 0 L8 2 L2 8 Z" fill="black"/></svg>';
    await editor.importSvgText(svg, 'diagonal.svg');

    const raw = window.PixelEditorDebug.services.persistence.ProjectSerializer.serialize(
      editor.state.project,
      editor.state.assets,
    );
    const restored = window.PixelEditorDebug.services.persistence.ProjectSerializer.deserialize(raw);
    editor.state.project = restored.project;
    editor.state.assets = restored.assets;
    editor.state.selection.clear();
    await editor.hydrateAssets();

    const pageModel = editor.activePage();
    const node = pageModel.nodes.find(item => item.sourceType === 'svg');
    node.w = 64;
    node.h = 64;
    node.image.fit = 'stretch';
    node.image.cropX = 0;
    node.image.cropY = 0;
    node.image.cropW = 8;
    node.image.cropH = 8;

    const runtime = editor.state.assets.getRuntime(node.assetId);
    const rendered = window.PixelEditorDebug.services.renderer.ImageRenderer.render(node, editor.state.assets);

    let mixedBlocks = 0;
    for (let blockY = 0; blockY < 8; blockY += 1) {
      for (let blockX = 0; blockX < 8; blockX += 1) {
        const values = new Set();
        for (let y = blockY * 8; y < (blockY + 1) * 8; y += 1) {
          for (let x = blockX * 8; x < (blockX + 1) * 8; x += 1) {
            const offset = (y * 64 + x) * 4;
            values.add(`${rendered.data[offset]},${rendered.data[offset + 3]}`);
          }
        }
        if (values.size > 1) mixedBlocks += 1;
      }
    }

    return { runtimeKind: runtime?.kind || null, mixedBlocks };
  });

  expect(result.runtimeKind).toBe('svg-vector');
  expect(result.mixedBlocks).toBeGreaterThan(0);
});

test('nearest-neighbor bitmap rendering remains unchanged', async ({ page }) => {
  await openEditor(page);

  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const state = editor.state;
    const activePage = editor.activePage();

    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    const assetId = state.assets.add('image', '', { name: 'grid.png', mime: 'image/png' });
    state.assets.setRuntime(assetId, { width: 2, height: 2, data });

    const node = window.PixelEditorDebug.services.model.createNode('image', {
      parentId: activePage.id,
      x: 0,
      y: 0,
      w: 4,
      h: 4,
      assetId,
      sourceWidth: 2,
      sourceHeight: 2,
      sourceType: 'bitmap',
      image: {
        fit: 'stretch',
        interpolation: 'nearest',
        cropX: 0,
        cropY: 0,
        cropW: 2,
        cropH: 2,
        bwMode: 'threshold',
        threshold: 128,
        invert: false,
        ditherAlgorithm: 'bayer',
        bayerMatrix: 4,
      },
    });

    const rendered = window.PixelEditorDebug.services.renderer.ImageRenderer.render(node, state.assets);
    const at = (x, y) => rendered.data[(y * 4 + x) * 4];
    return {
      topLeft: at(0, 0),
      topRight: at(3, 0),
      bottomLeft: at(0, 3),
      bottomRight: at(3, 3),
    };
  });

  expect(result).toEqual({
    topLeft: 0,
    topRight: 255,
    bottomLeft: 255,
    bottomRight: 0,
  });
});
