import { expect, test } from '@playwright/test';
import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

async function sourceFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

async function existing(paths) {
  const found = [];
  for (const path of paths) {
    try { await access(new URL(path, import.meta.url)); found.push(path); } catch {}
  }
  return found;
}

test('temporary integration adapters are removed instead of kept as no-op runtimes', async () => {
  expect(await existing([
    '../src/ui/history-properties.js',
    '../src/media/raster-sizing.js',
  ])).toEqual([]);

  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  expect(main).not.toContain('installHistoryPropertiesRuntime');
  expect(main).not.toContain('installRasterSizingRuntime');
});

test('production source has one canonical schema path without schemaV17 service-locator access', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const offenders = [];
  for (const file of await sourceFiles(root)) {
    const source = await readFile(file, 'utf8');
    if (source.includes('schemaV17')) offenders.push(relative(root, file).replaceAll('\\', '/'));
  }
  expect(offenders).toEqual([]);
});

test('Workspace does not keep duplicate fallbacks for mandatory ToolController delegation', async () => {
  const source = await readFile(new URL('../src/app/workspace.js', import.meta.url), 'utf8');
  expect(source).not.toMatch(/setTool\(tool\)\s*\{\s*if\s*\(this\.toolController\)/);
  expect(source).not.toMatch(/beginPaint\(point\)\s*\{\s*if\s*\(this\.toolController\)/);
});

test('architecture guards cover runtime class and renderer method replacement regressions', async () => {
  const guard = await readFile(new URL('./no-runtime-patching.spec.js', import.meta.url), 'utf8');
  expect(guard).toContain('runtime-class-replacement');
  expect(guard).toContain('renderer-method-replacement');
});
