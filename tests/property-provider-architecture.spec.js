import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

test('properties are owned by one PropertyProvider and PropertySession', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const system = window.PixelEditor.properties;
    const editor = window.PixelEditorTest.editor;
    return {
      hasDescriptor: typeof system?.PropertyDescriptor === 'function',
      hasProvider: typeof system?.PropertyProvider === 'function',
      hasSession: typeof system?.PropertySession === 'function',
      providerOwned: Boolean(system?.provider) && editor.properties?.provider === system.provider,
      descriptorIds: system?.provider?.descriptors?.map(item => item.id) || [],
    };
  });
  expect(result.hasDescriptor).toBe(true);
  expect(result.hasProvider).toBe(true);
  expect(result.hasSession).toBe(true);
  expect(result.providerOwned).toBe(true);
  expect(result.descriptorIds.length).toBeGreaterThan(0);
  expect(new Set(result.descriptorIds).size).toBe(result.descriptorIds.length);
});

test('live property editing keeps the original DOM control instead of cloning it', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => window.PixelEditorTest.createNode('rectangle', {
    x: 40, y: 40, w: 80, h: 60,
    stroke: { width: 1, color: 1, style: 'solid' },
    fill: { mode: 'solid', color: 1 },
  }));
  const result = await page.evaluate(() => {
    const control = document.querySelector('#propX');
    control.focus();
    control.value = '73';
    control.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '3' }));
    return {
      sameControl: document.querySelector('#propX') === control,
      activeControl: document.activeElement === control,
      value: window.PixelEditorTest.getNode(window.PixelEditorTest.editor.state.selection.primaryId)?.x,
    };
  });
  expect(result).toEqual({ sameControl: true, activeControl: true, value: 73 });
});

test('property implementation has no prototype patch stack, cloneControl, or regex UI surgery', async () => {
  const paths = [
    '../src/properties/property-system.js',
    '../src/ui/properties.js',
    '../src/media/raster-layer.js',
    '../src/rendering/binary-image-preview.js',
    '../src/fonts/font-options.js',
  ];
  for (const relative of paths) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    expect(source, relative).not.toContain('Properties.prototype');
    expect(source, relative).not.toContain('cloneControl');
    expect(source, relative).not.toContain('stripFontActionButtons');
  }
});

test('bootstrap wires one explicit property provider without runtime installers', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const services = await readFile(new URL('../src/app/services.js', import.meta.url), 'utf8');
  const propertySystem = await readFile(new URL('../src/properties/property-system.js', import.meta.url), 'utf8');

  expect(main).toContain('bootstrapPixelEdit');
  expect(main).not.toContain('installPropertySystem');
  expect(services).toContain("import { PropertyDescriptor, PropertyProvider, PropertySession, normalizeNumber } from '../properties/property-system.js';");
  expect(services.match(/new PropertyProvider\(services\)/g) || []).toHaveLength(1);
  expect(propertySystem).not.toMatch(/\binstall[A-Za-z0-9_$]*Runtime\b/);
  expect(propertySystem).not.toContain('installPropertySystem');
});
