import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }

function matchingBrace(source, open) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('matching brace not found');
}

function prototypeMethodRange(source, receiver, name) {
  const needle = `  ${receiver}.prototype.${name} = `;
  const start = source.indexOf(needle);
  if (start < 0) throw new Error(`${receiver}.${name}: prototype assignment not found`);
  const signatureStart = start + needle.length;
  const signature = source.slice(signatureStart).match(/^(async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{/);
  if (!signature) throw new Error(`${receiver}.${name}: unsupported function signature`);
  const open = signatureStart + signature[0].length - 1;
  const close = matchingBrace(source, open);
  let end = close + 1;
  while (/\s/.test(source[end] || '')) end += 1;
  if (source[end] !== ';') throw new Error(`${receiver}.${name}: assignment terminator not found`);
  end += 1;
  return {
    start,
    end,
    async: Boolean(signature[1]),
    args: signature[2].trim(),
    body: source.slice(open + 1, close),
  };
}

function capabilityMethod(path, receiver, name) {
  const source = read(path);
  const range = prototypeMethodRange(source, receiver, name);
  const args = range.args ? `, ${range.args}` : '';
  const body = range.body.replace(/\bthis\b/g, 'editor');
  const replacement = `  PE.workspaceCapabilities = PE.workspaceCapabilities || {};\n  PE.workspaceCapabilities.${name} = ${range.async ? 'async ' : ''}function ${name}(editor${args}) {${body}};`;
  write(path, source.slice(0, range.start) + replacement + source.slice(range.end));
}

const workspaceMethods = [
  ['src/clipboard/element-clipboard.js', 'Workspace', ['copySelection', 'pasteClipboard', 'selectAllOnPage']],
  ['src/fonts/font-import.js', 'Workspace', ['importFonts']],
  ['src/fonts/font-manager.js', 'Workspace', ['removeImportedFont']],
  ['src/media/image-runtime.js', 'PE.ui.Workspace', ['importSvgText', 'hydrateAssets']],
  ['src/media/raster-layer.js', 'Workspace', ['rasterizeSelected']],
  ['src/preferences/editor-preferences.js', 'Workspace', ['updateWorkspaceLayout', 'applyLayout', 'setupDockSplitters']],
  ['src/raster/flood-fill.js', 'Workspace', ['bucketFillTarget', 'bucketFillRaster', 'bucketFillPage', 'bucketFillImage', 'bucketFillAt']],
  ['src/rendering/overlay-pipeline.js', 'Workspace', ['renderOverlay']],
  ['src/rendering/selection-overlay.js', 'Workspace', ['selectionHandleAt']],
  ['src/tools/canvas-cursor.js', 'Workspace', ['applyCanvasCursor']],
  ['src/transforms/selection-transform.js', 'Workspace', ['runSelectionTransform', 'align', 'distribute']],
  ['src/ui/context-menu.js', 'Workspace', ['contextCommands', 'executeContextCommand', 'renderContextMenu', 'openContextMenu', 'closeContextMenu', 'onContextMenu', 'setupContextMenu']],
];

for (const [path, receiver, names] of workspaceMethods) {
  for (const name of names) capabilityMethod(path, receiver, name);
}

// HistoryDock remains a class owner rather than a runtime prototype mutation.
{
  const path = 'src/ui/history-properties.js';
  const source = read(path);
  const range = prototypeMethodRange(source, 'HistoryDock', 'render');
  const replacement = `  class V17HistoryDock extends HistoryDock {\n    render() {${range.body}}\n  }\n  PE.ui.HistoryDock = V17HistoryDock;`;
  write(path, source.slice(0, range.start) + replacement + source.slice(range.end));
}

// V17Workspace exposes the public methods explicitly and delegates subsystem work
// to registered capabilities. This preserves one class owner without moving all
// subsystem algorithms into the application shell.
{
  const path = 'src/app/v17-workspace.js';
  let source = read(path);
  const anchor = `  const G = PE.selectionGeometry;\n\n  class V17Workspace extends BaseWorkspace {`;
  if (!source.includes(anchor)) throw new Error('V17Workspace capability helper anchor not found');
  source = source.replace(anchor, `  const G = PE.selectionGeometry;\n\n  const capability = (name, editor, ...args) => {\n    const fn = PE.workspaceCapabilities?.[name];\n    if (typeof fn !== 'function') throw new Error(\`PixelEditor workspace capability is not registered: \${name}\`);\n    return fn(editor, ...args);\n  };\n\n  class V17Workspace extends BaseWorkspace {`);

  const oldContextSetup = `    setupContextMenu() {\n      this.nativeContextMenuCleanup?.();\n      const result = super.setupContextMenu();\n      this.nativeContextMenuCleanup = installNativeContextMenuBoundary(this, target.document);\n      return result;\n    }`;
  if (!source.includes(oldContextSetup)) throw new Error('V17Workspace setupContextMenu anchor not found');

  const delegates = `    copySelection() { return capability('copySelection', this); }\n    pasteClipboard() { return capability('pasteClipboard', this); }\n    selectAllOnPage() { return capability('selectAllOnPage', this); }\n    importFonts(files) { return capability('importFonts', this, files); }\n    removeImportedFont(family) { return capability('removeImportedFont', this, family); }\n    importSvgText(text, name = 'svg', options = {}) { return capability('importSvgText', this, text, name, options); }\n    hydrateAssets() { return capability('hydrateAssets', this); }\n    rasterizeSelected() { return capability('rasterizeSelected', this); }\n    updateWorkspaceLayout(patch = {}) { return capability('updateWorkspaceLayout', this, patch); }\n    applyLayout() { return capability('applyLayout', this); }\n    setupDockSplitters() { return capability('setupDockSplitters', this); }\n    bucketFillTarget() { return capability('bucketFillTarget', this); }\n    bucketFillRaster(node, point, settings) { return capability('bucketFillRaster', this, node, point, settings); }\n    bucketFillPage(page, point, settings) { return capability('bucketFillPage', this, page, point, settings); }\n    bucketFillImage(node, point, settings) { return capability('bucketFillImage', this, node, point, settings); }\n    bucketFillAt(point) { return capability('bucketFillAt', this, point); }\n    renderOverlay() { return capability('renderOverlay', this); }\n    selectionHandleAt(point) { return capability('selectionHandleAt', this, point); }\n    applyCanvasCursor(options = {}) { return capability('applyCanvasCursor', this, options); }\n    runSelectionTransform(action, value = 0) { return capability('runSelectionTransform', this, action, value); }\n    align(mode) { return capability('align', this, mode); }\n    distribute(axis) { return capability('distribute', this, axis); }\n    contextCommands() { return capability('contextCommands', this); }\n    executeContextCommand(id, value) { return capability('executeContextCommand', this, id, value); }\n    renderContextMenu() { return capability('renderContextMenu', this); }\n    openContextMenu(options = {}) { return capability('openContextMenu', this, options); }\n    closeContextMenu() { return capability('closeContextMenu', this); }\n    onContextMenu(event) { return capability('onContextMenu', this, event); }\n\n    setupContextMenu() {\n      this.nativeContextMenuCleanup?.();\n      const result = capability('setupContextMenu', this);\n      this.nativeContextMenuCleanup = installNativeContextMenuBoundary(this, target.document);\n      return result;\n    }`;
  source = source.replace(oldContextSetup, delegates);
  write(path, source);
}

console.log('Task 7 capability codemod completed');
