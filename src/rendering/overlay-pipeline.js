const DEFAULT_LAYER_ORDER = ['transparency', 'selection', 'handles', 'interaction', 'tool-cursor'];

function wrapLayer(id, markup = '') {
  return `<g data-overlay-layer="${id}">${markup || ''}</g>`;
}

class OverlayPipeline {
  constructor(target = globalThis) {
    const PE = target.PixelEditor;
    if (!PE?.renderer?.OverlayRenderer) throw new Error('PixelEditor overlay renderer is not initialized');
    this.target = target;
    this.layers = [
      {
        id: 'transparency',
        render: editor => PE.transparencyOverlay?.markup?.(editor) || '',
      },
      {
        id: 'selection',
        render: editor => PE.selectionOverlay?.selectionMarkup?.(editor) || '',
      },
      {
        id: 'handles',
        render: editor => (PE.selectionOverlay?.handlesMarkup?.(editor) || '')
          + (PE.photopeaTransformUI?.edgeHandlesMarkup?.(editor) || ''),
      },
      {
        id: 'interaction',
        render: editor => PE.renderer.OverlayRenderer.markup({
          smartGuides: editor.overlayState?.smartGuides || [],
          marquee: editor.overlayState?.marquee,
        }),
      },
      {
        id: 'tool-cursor',
        render: editor => PE.canvasCursor?.brushCursorMarkup?.(editor) || '',
      },
    ];
  }

  render(editor) {
    const svg = editor?.overlay;
    if (!svg) return '';
    const html = this.layers.map(layer => wrapLayer(layer.id, layer.render(editor))).join('');
    svg.innerHTML = html;
    editor.overlayPipeline = this;
    return html;
  }
}

function installOverlayPipelineRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Workspace = PE?.ui?.Workspace;
  if (!Workspace || !PE?.selectionOverlay || !PE?.transparencyOverlay || !PE?.canvasCursor) {
    throw new Error('PixelEditor overlay layer dependencies are not initialized');
  }
  if (PE.overlayPipelineInstalled) return PE.overlayPipeline;
  PE.overlayPipelineInstalled = true;
  const pipeline = new OverlayPipeline(target);
  PE.overlayPipeline = pipeline;
  Workspace.prototype.renderOverlay = function renderOverlayWithPipeline() {
    this.overlayPipeline = pipeline;
    return pipeline.render(this);
  };
  return pipeline;
}

export { DEFAULT_LAYER_ORDER, OverlayPipeline, installOverlayPipelineRuntime };
