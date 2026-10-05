import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const TESTS = path.join(ROOT, 'tests');

async function sourceFiles(dir = SRC) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(resolved));
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(resolved);
  }
  return files.sort();
}

async function sources() {
  return Promise.all((await sourceFiles()).map(async file => ({
    file: path.relative(ROOT, file).replaceAll('\\', '/'),
    text: await readFile(file, 'utf8'),
  })));
}

function matchingLines(text, pattern) {
  return text.split('\n').flatMap((line, index) => pattern.test(line)
    ? [`${index + 1}: ${line.trim()}`]
    : []);
}

test('production source contains no runtime prototype patch assignments', async () => {
  const violations = [];
  for (const { file, text } of await sources()) {
    const lines = matchingLines(text, /\.prototype\.[A-Za-z_$][\w$]*\s*=/);
    for (const line of lines) violations.push(`${file}:${line}`);
  }
  expect(violations).toEqual([]);
});

test('production source contains no listener-clone, image type adaptation, or legacy V15 markers', async () => {
  const violations = [];
  for (const { file, text } of await sources()) {
    const checks = [
      ['cloneNode listener reset', /\bcloneNode\s*\(/],
      ['node type image adaptation', /\b[A-Za-z_$][\w$]*\.type\s*=\s*['"]image['"]/],
      ['legacy V15 marker', /\b(?:PE\.)?version\s*=\s*15\b|\bversion\s*:\s*15\b|\bV15\b/],
      ['property UI regex removal', /\.replace\(\s*\/[^\n]*(?:importFontBtn|removeFontBtn|prop[A-Z])/],
    ];
    for (const [label, pattern] of checks) {
      for (const line of matchingLines(text, pattern)) violations.push(`${label}: ${file}:${line}`);
    }
  }
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  if (/\b(?:PE\.)?version\s*=\s*15\b|\bversion\s*:\s*15\b|\bV15\b/.test(html)) {
    violations.push('legacy V15 marker: index.html');
  }
  expect(violations).toEqual([]);
});

test('renderer path never deep-clones the whole project', async () => {
  const violations = [];
  for (const { file, text } of await sources()) {
    if (!file.startsWith('src/rendering/')) continue;
    for (const line of matchingLines(text, /structuredClone\s*\(\s*project\s*\)/)) {
      violations.push(`${file}:${line}`);
    }
  }
  expect(violations).toEqual([]);
});

test('architecture convergence residues cannot return to production source', async () => {
  const all = await sources();
  const files = all.map(item => item.file);
  const violations = [];
  const testFiles = (await readdir(TESTS)).filter(name => name.endsWith('.js')).sort();

  expect(files).not.toContain('src/app/v17-workspace.js');
  expect(files).not.toContain('src/model/v17-schema.js');
  expect(files).not.toContain('src/interaction/clipboard.js');
  expect(testFiles).not.toContain('v16-full-workflow.spec.js');
  expect(testFiles).toContain('v17-full-workflow.spec.js');

  for (const { file, text } of all) {
    const checks = [
      ['workspace capability registry', /\bworkspaceCapabilities\b/],
      ['legacy workspace module reference', /\bv17-workspace(?:\.js)?\b/],
      ['legacy schema module reference', /\bv17-schema(?:\.js)?\b/],
      ['V17 workspace subclass', /\b(?:BaseWorkspace|V17Workspace)\b/],
      ['legacy persistence wrapper', /\b(?:ProjectFilesV17|AutosaveV17|BaseProjectFiles)\b/],
      ['legacy schema installer', /\binstallV17SchemaRuntime\b/],
      ['runtime anonymous class replacement', /\b(?:PE(?:\.[A-Za-z_$][\w$]*)+|P|I|U)\.[A-Za-z_$][\w$]*\s*=\s*class\b/],
      ['tool instance method replacement', /\beditor\.(?:setTool|onPointerDown|onPointerMove|onPointerUp|beginPaint)\s*=/],
      ['property preview method replacement', /\bprovider\.renderPreviews\s*=/],
      ['clipboard constructor replacement', /\bI\.Clipboard\s*=/],
      ['base workspace export', /\b(?:PE\.ui|U)\.BaseWorkspace\s*=/],
      ['legacy clipboard project-version field', /\bversion\s*:\s*16\b/],
    ];
    for (const [label, pattern] of checks) {
      for (const line of matchingLines(text, pattern)) violations.push(`${label}: ${file}:${line}`);
    }
  }

  expect(violations).toEqual([]);
});
