import { transformModel } from '../transforms/transform-model.js';
import { selectionGeometry } from '../selection/selection-geometry.js';
import { selectionOverlay } from '../rendering/selection-overlay.js';

const PE = globalThis.PixelEditor;
PE.transformModel = transformModel;
PE.selectionGeometry = selectionGeometry;
PE.selectionOverlay = selectionOverlay;
