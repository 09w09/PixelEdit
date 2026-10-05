import { renderTextMask } from './text-layout.js';

const R = globalThis.PixelEditor.renderer;
R.TextRenderer = { mask: renderTextMask };

export { renderTextMask };
