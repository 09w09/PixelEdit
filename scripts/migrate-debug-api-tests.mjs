import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const TESTS = join(ROOT, 'tests');
const LEGACY = 'window.PixelEditor';
const DEBUG_SERVICES = 'window.PixelEditorDebug.services';

async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path));
    else if (entry.isFile() && entry.name.endsWith('.spec.js')) out.push(path);
  }
  return out;
}

function replaceCodeToken(source, token, replacement) {
  let out = '';
  let i = 0;
  let state = 'code';
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === "'") { state = 'single'; out += ch; i += 1; continue; }
      if (ch === '"') { state = 'double'; out += ch; i += 1; continue; }
      if (ch === '`') { state = 'template'; out += ch; i += 1; continue; }
      if (ch === '/' && next === '/') { state = 'line-comment'; out += '//'; i += 2; continue; }
      if (ch === '/' && next === '*') { state = 'block-comment'; out += '/*'; i += 2; continue; }
      if (source.startsWith(token, i)) {
        const before = source[i - 1] || '';
        const after = source[i + token.length] || '';
        if (!/[\w$]/.test(before) && !/[\w$]/.test(after)) {
          out += replacement;
          i += token.length;
          continue;
        }
      }
      out += ch;
      i += 1;
      continue;
    }
    if (state === 'single') {
      out += ch;
      i += 1;
      if (ch === '\\' && i < source.length) { out += source[i]; i += 1; }
      else if (ch === "'") state = 'code';
      continue;
    }
    if (state === 'double') {
      out += ch;
      i += 1;
      if (ch === '\\' && i < source.length) { out += source[i]; i += 1; }
      else if (ch === '"') state = 'code';
      continue;
    }
    if (state === 'template') {
      out += ch;
      i += 1;
      if (ch === '\\' && i < source.length) { out += source[i]; i += 1; }
      else if (ch === '`') state = 'code';
      continue;
    }
    if (state === 'line-comment') {
      out += ch;
      i += 1;
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') { out += '*/'; i += 2; state = 'code'; }
      else { out += ch; i += 1; }
    }
  }
  return out;
}

function normalizeServicePaths(source) {
  const root = DEBUG_SERVICES.replaceAll('.', '\\.');
  return source
    .replace(new RegExp(`${root}\\.commandCoalescing`, 'g'), `${DEBUG_SERVICES}.commands`)
    .replace(new RegExp(`${root}\\.integerGeometry\\.normalizeTransformTranslation`, 'g'), `${DEBUG_SERVICES}.model.normalizeCommittedTransform`)
    .replace(new RegExp(`${root}\\.integerGeometry\\.normalizeProjectGeometry`, 'g'), `${DEBUG_SERVICES}.model.normalizeCommittedProject`)
    .replace(new RegExp(`${root}\\.integerGeometry\\.projectGeometryViolations`, 'g'), `${DEBUG_SERVICES}.model.invariantViolations`)
    .replace(new RegExp(`${root}\\.integerGeometry\\.assertIntegerProjectGeometry`, 'g'), `${DEBUG_SERVICES}.model.assertProjectInvariants`)
    .replace(new RegExp(`${root}\\.integerGeometry`, 'g'), `${DEBUG_SERVICES}.model`)
    .replace(new RegExp(`${root}\\.pixelStrokeRuntime`, 'g'), `${DEBUG_SERVICES}.pixelStroke`)
    .replace(new RegExp(`${root}\\.elementClipboard\\.ElementClipboard`, 'g'), `${DEBUG_SERVICES}.clipboard.ElementClipboard`)
    .replace(new RegExp(`${root}\\.ElementClipboard`, 'g'), `${DEBUG_SERVICES}.clipboard.ElementClipboard`)
    .replace(new RegExp(`${root}\\.interaction\\.Clipboard`, 'g'), `${DEBUG_SERVICES}.clipboard.ElementClipboard`)
    .replace(new RegExp(`${root}\\.ui\\.Workspace`, 'g'), 'window.PixelEditorDebug.app.constructor');
}

let changed = 0;
for (const path of await filesUnder(TESTS)) {
  const before = await readFile(path, 'utf8');
  const migrated = normalizeServicePaths(replaceCodeToken(before, LEGACY, DEBUG_SERVICES));
  if (migrated !== before) {
    await writeFile(path, migrated);
    changed += 1;
  }
}

const playwrightPath = join(ROOT, 'playwright.config.js');
const playwright = await readFile(playwrightPath, 'utf8');
await writeFile(playwrightPath, playwright.replace('npm run dev -- --config vite.test.config.js --host 127.0.0.1', 'npm run dev -- --host 127.0.0.1'));
await rm(join(ROOT, 'tests/debug-compat.js'), { force: true });
await rm(join(ROOT, 'vite.test.config.js'), { force: true });

console.log(`migrated ${changed} test files`);
