import { brushWidth } from '../raster/paint-brush.js';

const BRUSH_TOOLS = new Set(['pencil', 'eraser']);
const CROSSHAIR_TOOLS = new Set([
  'select',
  'line',
  'rectangle',
  'circle',
  'polygon',
  'bucket',
  'image',
  'text',
]);

function cursorModeForTool(tool) {
  if (BRUSH_TOOLS.has(tool)) return 'brush';
  if (CROSSHAIR_TOOLS.has(tool)) return 'crosshair';
  return 'native';
}

function brushCursorBounds(point, width) {
  const size = brushWidth(width);
  const offset = -Math.floor((size - 1) / 2);
  return {
    x: Math.round(Number(point?.x) || 0) + offset,
    y: Math.round(Number(point?.y) || 0) + offset,
    width: size,
    height: size,
  };
}

function brushCursorMarkup(editor) {
  if (!editor.canvasCursorInside || cursorModeForTool(editor.tool) !== 'brush' || !editor.canvasCursorPoint) return '';
  const settings = editor.getToolDefaults?.(editor.tool) || {};
  const bounds = brushCursorBounds(editor.canvasCursorPoint, settings.width);
  const attrs = `x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"`;
  return `<g data-canvas-tool-cursor-layer="brush" pointer-events="none" shape-rendering="crispEdges">`
    + `<rect ${attrs} fill="none" stroke="#fff" stroke-width="3" vector-effect="non-scaling-stroke"/>`
    + `<rect data-canvas-tool-cursor="brush" ${attrs} fill="none" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke"/>`
    + `</g>`;
}

function installCanvasCursorRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Workspace = PE?.ui?.Workspace;
  if (!Workspace) throw new Error('PixelEditor workspace is not initialized');
  if (PE.canvasCursorInstalled) return;
  PE.canvasCursorInstalled = true;

  PE.canvasCursor = {
    BRUSH_TOOLS,
    CROSSHAIR_TOOLS,
    cursorModeForTool,
    brushCursorBounds,
  };

  Workspace.prototype.applyCanvasCursor = function applyCanvasCursor({ resetNative = false } = {}) {
    if (!this.canvas) return;
    const mode = cursorModeForTool(this.tool);
    if (mode === 'brush') {
      this.canvas.style.cursor = 'none';
      return;
    }
    if (mode === 'crosshair') {
      this.canvas.style.cursor = 'crosshair';
      return;
    }
    if (resetNative) this.canvas.style.cursor = 'default';
  };

  const previousSetupCanvas = Workspace.prototype.setupCanvas;
  Workspace.prototype.setupCanvas = function setupCanvasWithToolCursor() {
    const result = previousSetupCanvas.call(this);
    this.canvasCursorInside = false;
    this.canvasCursorPoint = null;
    this.canvas?.addEventListener('pointerenter', event => {
      this.canvasCursorInside = true;
      this.canvasCursorPoint = this.logicalPoint(event);
      this.applyCanvasCursor({ resetNative: true });
      if (cursorModeForTool(this.tool) === 'brush') this.renderOverlay?.();
    });
    this.canvas?.addEventListener('pointerleave', () => {
      this.canvasCursorInside = false;
      this.canvasCursorPoint = null;
      if (cursorModeForTool(this.tool) === 'brush') this.renderOverlay?.();
    });
    return result;
  };

  const previousSetupFiles = Workspace.prototype.setupFiles;
  Workspace.prototype.setupFiles = function setupFilesWithImageToolReset() {
    const result = previousSetupFiles.call(this);
    const input = document.querySelector('#fileImage');
    const resetImageTool = () => {
      if (this.tool === 'image') this.setTool('pointer');
    };
    input?.addEventListener('cancel', resetImageTool);
    input?.addEventListener('change', () => {
      if (!input.files?.length) resetImageTool();
    });
    return result;
  };

  const previousImportImageFile = Workspace.prototype.importImageFile;
  Workspace.prototype.importImageFile = async function importImageFileWithImageToolReset(...args) {
    try {
      return await previousImportImageFile.apply(this, args);
    } finally {
      if (this.tool === 'image') this.setTool('pointer');
    }
  };

  const previousSetToolDefault = Workspace.prototype.setToolDefault;
  Workspace.prototype.setToolDefault = function setToolDefaultWithCanvasCursor(tool, key, value) {
    const result = previousSetToolDefault.call(this, tool, key, value);
    if (
      key === 'width'
      && tool === this.tool
      && cursorModeForTool(tool) === 'brush'
      && this.canvasCursorInside
    ) {
      this.renderOverlay?.();
    }
    return result;
  };

  const previousRenderOverlay = Workspace.prototype.renderOverlay;
  Workspace.prototype.renderOverlay = function renderOverlayWithCanvasCursor(...args) {
    const result = previousRenderOverlay.apply(this, args);
    const markup = brushCursorMarkup(this);
    if (markup && this.overlay) this.overlay.insertAdjacentHTML('beforeend', markup);
    return result;
  };
}

export {
  BRUSH_TOOLS,
  CROSSHAIR_TOOLS,
  cursorModeForTool,
  brushCursorBounds,
  installCanvasCursorRuntime,
};
