import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('text renderer owns one mask implementation without runtime replacement', async () => {
  const base = await readFile(new URL('../src/rendering/base-text-renderer.js', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../src/rendering/text-layout.js', import.meta.url), 'utf8');

  expect(base).toContain("import { renderTextMask } from './text-layout.js';");
  expect(base).not.toContain('function fallbackMask');
  expect(base).not.toContain('function browserMask');
  expect(layout).not.toContain('renderer.TextRenderer.mask =');
});

test('binary image facade is not pre-defined by the base image renderer', async () => {
  const base = await readFile(new URL('../src/rendering/base-image-renderer.js', import.meta.url), 'utf8');

  expect(base).not.toContain('R.thresholdRgba=');
  expect(base).not.toContain('R.ditherImageData=');
  expect(base).not.toContain('function dither(');
  expect(base).not.toContain('function threshold(');
});
