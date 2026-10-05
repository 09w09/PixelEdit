import { expect, test } from '@playwright/test';
import { access, readFile } from 'node:fs/promises';

const LEGACY_PROPERTY_MODULES = [
  '../src/properties/live-property-runtime.js',
  '../src/properties/live-position-properties.js',
  '../src/properties/live-transform-properties.js',
  '../src/properties/live-text-properties.js',
  '../src/properties/live-image-structural-properties.js',
  '../src/properties/shape-style-properties.js',
  '../src/properties/page-fill-properties.js',
  '../src/properties/text-font-actions.js',
];

test('obsolete split property runtimes are removed from production source', async () => {
  const existing = [];
  for (const relative of LEGACY_PROPERTY_MODULES) {
    try {
      await access(new URL(relative, import.meta.url));
      existing.push(relative);
    } catch {}
  }
  expect(existing).toEqual([]);
});

test('Properties facade does not retain empty compatibility bind methods', async () => {
  const source = await readFile(new URL('../src/ui/properties.js', import.meta.url), 'utf8');
  for (const method of ['bind', 'bindPage', 'bindDither', 'bindPattern', 'bindText', 'bindImage']) {
    expect(source).not.toContain(`${method}(){/* binding is owned by PropertyProvider descriptors */}`);
  }
});
