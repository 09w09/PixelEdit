import { beginPaintWithBrush } from '../raster/paint-brush.js';
import { installToolRegistry } from './tool-registry.js';

class ToolController {
  constructor(editor, registry, target = globalThis) {
    if (!editor || !registry) throw new Error('ToolController requires an editor and registry');
    this.editor = editor;
    this.registry = registry;
    this.target = target;
    const prototype = Object.getPrototypeOf(editor);
    this.base = {
      pointerDown: prototype.onPointerDown,
      pointerMove: prototype.onPointerMove,
      pointerUp: prototype.onPointerUp,
    };
    this.installed = false;
    this.boundKeyDown = event => this.keyDown(event);
  }

  install() {
    if (this.installed) return this;
    this.installed = true;
    const editor = this.editor;
    editor.toolController = this;
    editor.setTool = this.setTool.bind(this);
    editor.onPointerDown = this.pointerDown.bind(this);
    editor.onPointerMove = this.pointerMove.bind(this);
    editor.onPointerUp = this.pointerUp.bind(this);
    editor.beginPaint = this.beginPaint.bind(this);
    this.target.addEventListener?.('keydown', this.boundKeyDown);
    return this;
  }

  setTool(id) {
    const definition = this.registry.get(id);
    if (!definition) return false;
    const editor = this.editor;
    editor.bus?.breakMergeChain?.('tool-change');
    editor.cancelCustomGesture?.();
    editor.tool = definition.id;
    globalThis.document?.querySelectorAll?.('[data-tool]').forEach(button => {
      button.classList.toggle('active', button.dataset.tool === definition.id);
    });
    editor.updateInteraction?.();
    this.renderOptions();
    this.cursor({ resetNative: true });
    editor.renderOverlay?.();
    return definition.id;
  }

  beginPaint(point) {
    return beginPaintWithBrush(this.editor, point);
  }

  pointerDown(event) {
    const editor = this.editor;
    const definition = this.registry.get(editor.tool);
    if (definition?.kind === 'image') {
      if (event.button === 2) return false;
      globalThis.document?.querySelector?.('#fileImage')?.click();
      return true;
    }
    if (definition?.kind === 'bucket') {
      if (event.button === 2) return false;
      const point = editor.logicalPoint(event);
      editor.canvas?.setPointerCapture?.(event.pointerId);
      return editor.bucketFillAt?.(point) ?? false;
    }
    return this.base.pointerDown?.call(editor, event);
  }

  pointerMove(event) {
    const editor = this.editor;
    const result = this.base.pointerMove?.call(editor, event);
    editor.canvasCursorInside = true;
    editor.canvasCursorPoint = editor.logicalPoint(event);
    this.cursor();
    if (this.registry.get(editor.tool)?.cursor === 'brush') editor.renderOverlay?.();
    return result;
  }

  pointerUp(event) {
    return this.base.pointerUp?.call(this.editor, event);
  }

  keyDown(event) {
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event?.target?.tagName) || event?.target?.isContentEditable;
    if (editing || event?.ctrlKey || event?.metaKey || event?.altKey) return false;
    const key = String(event?.key || '').toLowerCase();
    const definition = this.registry.values().find(tool => tool.shortcut === key);
    if (!definition) return false;
    event.preventDefault?.();
    this.setTool(definition.id);
    return true;
  }

  renderOptions() {
    this.editor.toolOptionsBar?.render?.();
  }

  cursor({ resetNative = false } = {}) {
    this.editor.applyCanvasCursor?.({ resetNative });
    return this.registry.get(this.editor.tool)?.cursor || 'native';
  }
}

function installToolSystemRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.ui?.Workspace) throw new Error('PixelEditor workspace is not initialized');
  const registry = installToolRegistry(target);
  PE.tools.ToolController = ToolController;
  return { registry, ToolController };
}

export { ToolController, installToolSystemRuntime };
