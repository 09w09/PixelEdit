import * as model from '../model/index.js';

const PE = globalThis.PixelEditor;
Object.assign(PE.model, model);
PE.integerGeometry = {
  BOX_TYPES: model.BOX_TYPES,
  finiteInteger: model.finiteInteger,
  nearestEvenInteger: model.nearestEvenInteger,
  positiveInteger: model.positiveInteger,
  integerPoint: model.integerPoint,
  normalizeTransformTranslation: model.normalizeCommittedTransform,
  normalizeNodeGeometry: model.normalizeNodeGeometry,
  normalizeGeometryPatch: model.normalizeGeometryPatch,
  normalizeProjectGeometry: model.normalizeCommittedProject,
  projectGeometryViolations: model.invariantViolations,
  assertIntegerProjectGeometry: model.assertProjectInvariants,
};
