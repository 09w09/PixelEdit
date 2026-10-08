import { OverlayRenderer } from './base-overlay-renderer.js';
import { selectionOverlay } from './selection-overlay.js';

const DEFAULT_LAYER_ORDER = ['selection', 'handles', 'interaction', 'tool-cursor'];

function wrapLayer(id, markup = '') {
  return `<g data-overlay-layer="${id}">${markup || ''}</g>`;
}

class OverlayPipeline {
  constructor({ photopeaTransformUI, canvasCursor, selection = selectionOverlay, overlayRenderer = OverlayRenderer } = {}) {
    if (!overlayRenderer?.markup) throw new Error('PixelEditor overlay renderer is not initialized');
    this.layers = [
      {
        id: 'selection',
        render: editor => selection?.selectionMarkup?.(editor) || '',
      },
      {
        id: 'handles',
        render: editor => (selection?.handlesMarkup?.(editor) || '')
          + (photopeaTransformUI?.edgeHandlesMarkup?.(editor) || ''),
      },
      {
        id: 'interaction',
        render: editor => overlayRenderer.markup({
          smartGuides: editor.overlayState?.smartGuides || [],
          marquee: editor.overlayState?.marquee,
        }),
      },
      {
        id: 'tool-cursor',
        render: editor => canvasCursor?.brushCursorMarkup?.(editor) || '',
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

let activeOverlayPipeline = null;

function renderOverlay(editor, pipeline = activeOverlayPipeline) {
  if (!pipeline) return '';
  editor.overlayPipeline = pipeline;
  return pipeline.render(editor);
}

export { DEFAULT_LAYER_ORDER, OverlayPipeline, renderOverlay };
