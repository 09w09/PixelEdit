import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function mustReplace(path, pattern, replacement, label) {
  const source = read(path);
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`${label || path}: expected source pattern was not found`);
  write(path, next);
}
function removeBetween(path, start, end, label) {
  const source = read(path);
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`${label || path}: boundary not found`);
  write(path, source.slice(0, a) + source.slice(b));
}

// Clipboard: keyboard ownership moves to V17Workspace.
removeBetween(
  'src/clipboard/element-clipboard.js',
  '  const oldSetupKeyboard = Workspace.prototype.setupKeyboard;',
  '  PE.elementClipboard = {',
  'clipboard keyboard wrapper',
);

// Font lifecycle is owned by V17Workspace; font commands remain in this module.
removeBetween(
  'src/fonts/font-manager.js',
  '  const originalMount = Workspace.prototype.mount;',
  '  Workspace.prototype.removeImportedFont =',
  'font manager lifecycle wrappers',
);

// Preferences still own persistence/layout helpers, not Workspace lifecycle wrapping.
removeBetween(
  'src/preferences/editor-preferences.js',
  '  const oldMount = Workspace.prototype.mount;',
  '  Workspace.prototype.updateWorkspaceLayout =',
  'preferences mount wrapper',
);
mustReplace(
  'src/preferences/editor-preferences.js',
  /\n  const oldRenderAll = Workspace\.prototype\.renderAll;[\s\S]*?\n  const oldTestApi = Workspace\.prototype\.testApi;[\s\S]*?\n  const oldSaveProject = Workspace\.prototype\.saveProject;[\s\S]*?\n  };\n(?=}\n\nexport)/,
  '\n',
  'preferences render/test/save wrappers',
);

// Tool defaults are pure preference helpers; Workspace behavior is defined in V17Workspace.
write('src/tools/tool-state.js', `function clone(value) {\n  return structuredClone(value);\n}\n\nfunction toolDefaults(preferences, tool) {\n  const defaults = preferences?.tools?.[tool];\n  return defaults ? clone(defaults) : {};\n}\n\nfunction installToolStateRuntime(target = globalThis) {\n  const PE = target.PixelEditor;\n  if (!PE?.preferences) throw new Error('PixelEditor preferences are not initialized');\n  if (PE.toolStateInstalled) return;\n  PE.toolStateInstalled = true;\n  PE.tools = PE.tools || {};\n  PE.tools.toolDefaults = toolDefaults;\n}\n\nexport { toolDefaults, installToolStateRuntime };\n`);

// Tool options retain their view/provider classes only.
mustReplace(
  'src/tools/tool-options-bar.js',
  /function installToolOptionsRuntime\(target = globalThis\) \{[\s\S]*?\n\}\n\nexport \{/,
  `function installToolOptionsRuntime(target = globalThis) {\n  const PE = target.PixelEditor;\n  if (!PE?.ui?.Workspace) throw new Error('PixelEditor workspace is not initialized');\n  if (PE.toolOptionsInstalled) return;\n  PE.toolOptionsInstalled = true;\n  PE.toolOptions = { ToolOptionsBar, installGlobalToolbar, actionRequirement, SELECTION_ACTIONS };\n}\n\nexport {`,
  'tool options lifecycle wrappers',
);

// Canvas cursor keeps cursor primitives/one native capability. Setup lifecycle moves to V17Workspace.
removeBetween(
  'src/tools/canvas-cursor.js',
  '  const previousSetupCanvas = Workspace.prototype.setupCanvas;',
  '\n}\n\nexport {',
  'canvas cursor lifecycle wrappers',
);

// Raster model owns raster algorithms and rasterize action, not generic Workspace routing.
removeBetween(
  'src/media/raster-layer.js',
  '  const originalPaintTarget = Workspace.prototype.paintTarget;',
  '  Workspace.prototype.rasterizeSelected =',
  'raster paint wrappers',
);
removeBetween(
  'src/media/raster-layer.js',
  '  const originalSetSelectionSize = Workspace.prototype.setSelectionSize;',
  '  PE.rasterLayer = {',
  'raster size/commit wrappers',
);
write('src/media/raster-sizing.js', `function installRasterSizingRuntime(target = globalThis) {\n  const PE = target.PixelEditor;\n  if (!PE?.rasterLayer?.resizeRaster) throw new Error('PixelEditor raster sizing dependencies are not initialized');\n  if (PE.rasterSizingInstalled) return;\n  PE.rasterSizingInstalled = true;\n}\n\nexport { installRasterSizingRuntime };\n`);

// Brush module owns algorithms and begin action; Workspace painting lifecycle is native.
removeBetween(
  'src/raster/paint-brush.js',
  '  const previousApplyPaintSegment = Workspace.prototype.applyPaintSegment;',
  '  PE.paintBrush = {',
  'paint brush wrappers',
);

// Selection overlay keeps geometry/markup plus the single selectionHandleAt capability.
removeBetween(
  'src/rendering/selection-overlay.js',
  '  const originalBeginLiveHandle = Workspace.prototype.beginLiveHandle;',
  '  PE.selectionOverlay = {',
  'selection interaction wrappers',
);

// Photopea UI keeps pure edge-handle markup/cursor functions. Geometry and interaction are canonical elsewhere.
removeBetween(
  'src/transforms/photopea-transform-ui.js',
  '  const originalBounds = Properties.prototype.bounds;',
  '  function edgeHandlesMarkup(editor) {',
  'photopea property/geometry wrappers',
);
removeBetween(
  'src/transforms/photopea-transform-ui.js',
  '  function reanchorTransform(editor, node, gesture, anchorLocal, anchorWorld) {',
  '  PE.photopeaTransformUI = {',
  'photopea interaction wrappers',
);

// Selection transform keeps commands/conversions, not paint routing.
removeBetween(
  'src/transforms/selection-transform.js',
  '  const previousApplyPaintSegment = Workspace.prototype.applyPaintSegment;',
  '  PE.selectionTransform = {',
  'selection transform paint wrapper',
);

// Context-menu document boundary is composed by V17Workspace.
mustReplace(
  'src/ui/context-menu-boundary.js',
  /function installContextMenuBoundaryRuntime\(target = globalThis\) \{[\s\S]*?\n\}\n\nexport \{/,
  `function installContextMenuBoundaryRuntime(target = globalThis) {\n  const PE = target.PixelEditor;\n  if (!PE?.ui?.Workspace) throw new Error('PixelEditor context-menu boundary dependencies are not initialized');\n  if (PE.contextMenuBoundaryInstalled) return;\n  PE.contextMenuBoundaryInstalled = true;\n  PE.contextMenuBoundary = { classifyContextRegion, installNativeContextMenuBoundary };\n}\n\nexport {`,
  'context menu boundary wrapper',
);
mustReplace(
  'src/ui/context-menu.js',
  /\n  \/\/ The document-level context-menu boundary[\s\S]*?PageDock\.prototype\.bindLayer = function bindLayerWithSharedContext\(row\) \{\n    return oldBindLayer\.call\(this, row\);\n  \};\n/,
  '\n',
  'page dock no-op wrapper',
);

// SVG vector rendering becomes a native ImageRenderer branch.
mustReplace(
  'src/media/image-runtime.js',
  /\n  const originalRender = PE\.renderer\.ImageRenderer\.render;\n  PE\.renderer\.ImageRenderer\.render = function renderImage\(node, assets\) \{[\s\S]*?\n  \};\n/,
  '\n',
  'image renderer wrapper',
);
mustReplace(
  'src/rendering/base-image-renderer.js',
  "function render(node,assets){const src=assets.getRuntime(node.assetId);if(!src)return null;",
  "function render(node,assets){const src=assets.getRuntime(node.assetId);if(!src)return null;if(src.kind==='svg-vector'&&globalThis.PixelEditor?.svgVectorRuntime?.renderSvgNode)return globalThis.PixelEditor.svgVectorRuntime.renderSvgNode(node,src);",
  'native SVG renderer branch',
);

// Canonical selection geometry owns all eight box handles.
mustReplace(
  'src/selection/selection-geometry.js',
  `  return {\n    nw: { x: left, y: top },\n    ne: { x: right, y: top },\n    sw: { x: left, y: bottom },\n    se: { x: right, y: bottom },\n  };`,
  `  return {\n    nw: { x: left, y: top },\n    n: { x: (left + right) / 2, y: top },\n    ne: { x: right, y: top },\n    e: { x: right, y: (top + bottom) / 2 },\n    se: { x: right, y: bottom },\n    s: { x: (left + right) / 2, y: bottom },\n    sw: { x: left, y: bottom },\n    w: { x: left, y: (top + bottom) / 2 },\n  };`,
  'eight source handles',
);
mustReplace(
  'src/selection/selection-geometry.js',
  "      for (const corner of ['nw', 'ne', 'sw', 'se']) {",
  "      for (const corner of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {",
  'eight handle hit test',
);

// Property bounds are normalized where the Properties class owns the API.
mustReplace(
  'src/ui/properties.js',
  '  bounds(nodes){return this.provider.bounds(this,nodes);}',
  `  bounds(nodes){return this.provider.bounds(this,nodes).map(bounds=>{const x=Math.round(Number(bounds.x)||0),y=Math.round(Number(bounds.y)||0),right=Math.round((Number(bounds.x)||0)+(Number(bounds.w)||0)),bottom=Math.round((Number(bounds.y)||0)+(Number(bounds.h)||0));return{...bounds,x,y,w:Math.max(0,right-x),h:Math.max(0,bottom-y)};});}`,
  'integer property bounds',
);

// V17Workspace is installed after providers/capabilities and before bootstrap.
mustReplace(
  'src/main.js',
  "import { bootstrapPixelEdit } from './app/bootstrap.js';",
  "import { bootstrapPixelEdit } from './app/bootstrap.js';\nimport { installV17WorkspaceClass } from './app/v17-workspace.js';",
  'main workspace import',
);
mustReplace(
  'src/main.js',
  'installRuntimeModules();\nbootstrapPixelEdit(globalThis);',
  'installRuntimeModules();\ninstallV17WorkspaceClass(globalThis);\nbootstrapPixelEdit(globalThis);',
  'main workspace install',
);

console.log('Task 7 codemod completed');
