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

test('V17 source contains no runtime method monkey-patching', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const files = await sourceFiles(root);
  const offenders = [];
  const rules = [
    {
      kind: 'prototype-assignment',
      pattern: /\b[A-Za-z_$][\w$]*\.prototype\.[A-Za-z_$][\w$]*\s*=\s*/g,
    },
    {
      kind: 'method-wrapper',
      pattern: /\b(?:const|let)\s+(?:original|previous)[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*;/g,
    },
  ];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const rule of rules) {
      for (const match of source.matchAll(rule.pattern)) {
        offenders.push({
          file: relative(root, file),
          line: lineNumber(source, match.index),
          kind: rule.kind,
          code: match[0].trim(),
        });
      }
    }
  }

  expect(offenders).toEqual([]);
});
