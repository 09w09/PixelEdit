import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

async function sourceFiles(root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function collectMatches(source, file, kind, pattern, offenders) {
  for (const match of source.matchAll(pattern)) {
    offenders.push({ file, line: lineNumber(source, match.index), kind, code: match[0].trim() });
  }
}

test('V17 source contains no legacy runtime wrapper or compatibility adaptation', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const files = await sourceFiles(root);
  const offenders = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const name = relative(root, file);

    collectMatches(
      source,
      name,
      'method-wrapper',
      /\b(?:const|let)\s+(?:old|original|previous)[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*;/g,
      offenders,
    );
    collectMatches(source, name, 'listener-reset-clone', /\.cloneNode\s*\(/g, offenders);
    collectMatches(source, name, 'image-type-adaptation', /\bnode\.type\s*=\s*['"]image['"]/g, offenders);
    if (name.startsWith('rendering/')) {
      collectMatches(source, name, 'renderer-project-clone', /structuredClone\s*\(\s*project\s*\)/g, offenders);
    }
    if (name.startsWith('properties/')) {
      collectMatches(source, name, 'regex-property-ui-removal', /\.replace\s*\(\s*\/[^\n/]*(?:button|prop|field|font)[^\n/]*\//gi, offenders);
    }
  }

  const shell = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const [name, source] of [['index.html', shell], ['main.js', main]]) {
    collectMatches(source, name, 'legacy-v15-marker', /(?:PE\.version\s*=\s*15|version\s*:\s*15|pixelEditor\s*=\s*['"]v15['"]|\bV15\b)/g, offenders);
  }

  expect(offenders).toEqual([]);
});

test('ToolController does not replace Workspace instance methods or capture its prototype', async () => {
  const source = await readFile(new URL('../src/tools/tool-controller.js', import.meta.url), 'utf8');
  for (const forbidden of [
    'Object.getPrototypeOf(editor)',
    'editor.setTool =',
    'editor.onPointerDown =',
    'editor.onPointerMove =',
    'editor.onPointerUp =',
    'editor.beginPaint =',
  ]) {
    expect(source, forbidden).not.toContain(forbidden);
  }
  for (const method of ['handlePointerDown', 'handlePointerMove', 'handlePointerUp']) {
    expect(source).toContain(`${method}(`);
  }
});
