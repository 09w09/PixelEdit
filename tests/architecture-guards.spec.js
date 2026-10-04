import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

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
