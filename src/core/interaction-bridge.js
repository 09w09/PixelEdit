import { HitTest, rectIntersects } from '../interaction/hit-test.js';
import { SnapEngine } from '../interaction/snap-engine.js';
import { InteractionController } from '../interaction/interaction-controller.js';

Object.assign(globalThis.PixelEditor.interaction, { HitTest, rectIntersects, SnapEngine, InteractionController });
