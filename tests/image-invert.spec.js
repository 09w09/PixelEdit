import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

const ALGORITHMS = ['bayer', 'blueNoise', 'floydSteinberg', 'atkinson'];

test('final invert complements only covered threshold and dither pixels', async ({ page }) => {
  await openEditor(page);

  const result = await page.evaluate(() => {
    const binary = window.PixelEditor.binaryImage;
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      96, 96, 96, 255,
      0, 0, 0, 0,
    ]);
    const summarize = value => ({ bits: Array.from(value.bits), alpha: Array.from(value.alpha) });
    const threshold = binary.thresholdToBinary(rgba, 4, 1, 128);
    const thresholdInverted = binary.applyFinalBinaryInvert(threshold, true);
    const dithers = {};
    for (const algorithm of ['bayer', 'blueNoise', 'floydSteinberg', 'atkinson']) {
      const normal = binary.ditherToBinary(rgba, 4, 1, { algorithm, bayerMatrix: 4 });
      dithers[algorithm] = {
        normal: summarize(normal),
        inverted: summarize(binary.applyFinalBinaryInvert(normal, true)),
      };
    }
    return {
      threshold: summarize(threshold),
      thresholdInverted: summarize(thresholdInverted),
      dithers,
    };
  });

  expect(result.threshold.alpha).toEqual([1, 1, 1, 0]);
  expect(result.thresholdInverted.alpha).toEqual(result.threshold.alpha);
  for (let i = 0; i < result.threshold.bits.length; i += 1) {
    expect(result.thresholdInverted.bits[i]).toBe(result.threshold.alpha[i] ? 1 - result.threshold.bits[i] : result.threshold.bits[i]);
  }
  for (const algorithm of ALGORITHMS) {
    const { normal, inverted } = result.dithers[algorithm];
    expect(inverted.alpha).toEqual(normal.alpha);
    for (let i = 0; i < normal.bits.length; i += 1) {
      expect(inverted.bits[i]).toBe(normal.alpha[i] ? 1 - normal.bits[i] : normal.bits[i]);
    }
  }
});

test('contain padding and transparent source remain uncovered after inversion', async ({ page }) => {
  await openEditor(page);

  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const state = editor.state;
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 0,
    ]);
    const assetId = state.assets.add('image', '', { name: 'alpha.png', mime: 'image/png' });
    state.assets.setRuntime(assetId, { width: 2, height: 1, data: rgba });
    const node = window.PixelEditor.model.createNode('image', {
      parentId: editor.activePage().id,
      x: 0,
      y: 0,
      w: 4,
      h: 4,
      assetId,
      sourceWidth: 2,
      sourceHeight: 1,
      image: {
        fit: 'contain', interpolation: 'nearest', cropX: 0, cropY: 0, cropW: 2, cropH: 1,
        bwMode: 'threshold', threshold: 128, invert: true, ditherAlgorithm: 'bayer', bayerMatrix: 4,
      },
    });
    const binary = window.PixelEditor.binaryImage.binaryImageForNode(node, state.assets);
    return { bits: Array.from(binary.bits), alpha: Array.from(binary.alpha), width: binary.width, height: binary.height };
  });

  expect(result.width).toBe(4);
  expect(result.height).toBe(4);
  const covered = result.alpha.map((value, index) => value ? index : -1).filter(index => index >= 0);
  expect(covered).toEqual([4, 8]);
  expect(result.bits[4]).toBe(0);
  expect(result.alpha[5]).toBe(0);
  expect(result.alpha[9]).toBe(0);
});

test('binary image result matches framebuffer and PNG export pixels', async ({ page }) => {
  await openEditor(page);

  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    editor.newProject({ force: true });
    const state = editor.state;
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
    const assetId = state.assets.add('image', '', { name: 'pair.png', mime: 'image/png' });
    state.assets.setRuntime(assetId, { width: 2, height: 1, data: rgba });
    const node = window.PixelEditor.model.createNode('image', {
      parentId: editor.activePage().id,
      x: 10,
      y: 10,
      w: 2,
      h: 1,
      assetId,
      sourceWidth: 2,
      sourceHeight: 1,
      image: {
        fit: 'stretch', interpolation: 'nearest', cropX: 0, cropY: 0, cropW: 2, cropH: 1,
        bwMode: 'threshold', threshold: 128, invert: true, ditherAlgorithm: 'bayer', bayerMatrix: 4,
      },
    });
    editor.activePage().nodes.push(node);
    const binary = window.PixelEditor.binaryImage.binaryImageForNode(node, state.assets);
    const framebuffer = window.PixelEditor.renderer.FramebufferRenderer.renderPage(state.project, editor.activePage().id, state.assets);
    const canvas = editor.exportPng();
    const pixels = canvas.getContext('2d').getImageData(10, 10, 2, 1).data;
    return {
      binary: Array.from(binary.bits),
      framebuffer: [framebuffer[10 * 400 + 10], framebuffer[10 * 400 + 11]],
      png: [pixels[0] === 0 ? 1 : 0, pixels[4] === 0 ? 1 : 0],
      alpha: [pixels[3], pixels[7]],
    };
  });

  expect(result.binary).toEqual([0, 1]);
  expect(result.framebuffer).toEqual(result.binary);
  expect(result.png).toEqual(result.binary);
  expect(result.alpha).toEqual([255, 255]);
});
