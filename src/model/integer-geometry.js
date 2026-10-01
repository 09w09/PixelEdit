const BOX_TYPES = new Set(['rectangle', 'circle', 'text', 'image', 'raster']);

function finiteInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : Math.round(Number(fallback) || 0);
}

function nearestEvenInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return nearestEvenInteger(fallback, 0);
  const lower = Math.floor(number);
  const fraction = number - lower;
  if (Math.abs(fraction - 0.5) < 1e-9) return Math.abs(lower % 2) === 0 ? lower : lower + 1;
  return Math.round(number);
}

function positiveInteger(value, fallback = 1) {
  return Math.max(1, finiteInteger(value, fallback));
}

function integerPoint(point, fallback = { x: 0, y: 0 }) {
  return {
    x: finiteInteger(point?.x, fallback?.x),
    y: finiteInteger(point?.y, fallback?.y),
  };
}

function normalizeTransformTranslation(transform, integer = finiteInteger) {
  if (!transform || typeof transform !== 'object') return transform;
  const output = structuredClone(transform);
  for (const key of ['translateX', 'translateY']) {
    if (!Object.hasOwn(output, key)) continue;
    const value = integer(output[key]);
    if (value === 0) delete output[key];
    else output[key] = value;
  }
  return output;
}

function normalizeNodeGeometry(node) {
  if (!node || typeof node !== 'object') return node;

  if (BOX_TYPES.has(node.type)) {
    node.x = finiteInteger(node.x);
    node.y = finiteInteger(node.y);
    node.w = positiveInteger(node.w);
    node.h = positiveInteger(node.h);
  } else if (node.type === 'line') {
    node.x1 = finiteInteger(node.x1);
    node.y1 = finiteInteger(node.y1);
    node.x2 = finiteInteger(node.x2);
    node.y2 = finiteInteger(node.y2);
  } else if (node.type === 'polygon') {
    node.points = (node.points || []).map(point => integerPoint(point));
  }

  if (node.transform && typeof node.transform === 'object') {
    node.transform = normalizeTransformTranslation(node.transform);
  }
  return node;
}

function normalizeGeometryPatch(node, patch) {
  if (!patch || typeof patch !== 'object') return patch;
  const output = structuredClone(patch);

  if (BOX_TYPES.has(node?.type)) {
    if (Object.hasOwn(output, 'x')) output.x = finiteInteger(output.x, node.x);
    if (Object.hasOwn(output, 'y')) output.y = finiteInteger(output.y, node.y);
    if (Object.hasOwn(output, 'w')) output.w = positiveInteger(output.w, node.w);
    if (Object.hasOwn(output, 'h')) output.h = positiveInteger(output.h, node.h);
  } else if (node?.type === 'line') {
    for (const key of ['x1', 'y1', 'x2', 'y2']) {
      if (Object.hasOwn(output, key)) output[key] = finiteInteger(output[key], node[key]);
    }
  } else if (node?.type === 'polygon' && Object.hasOwn(output, 'points')) {
    output.points = (output.points || []).map((point, index) => integerPoint(point, node.points?.[index]));
  }

  if (Object.hasOwn(output, 'transform')) {
    output.transform = normalizeTransformTranslation(output.transform);
  }
  return output;
}

function geometryViolations(node) {
  if (!node || typeof node !== 'object') return [];
  const violations = [];
  const check = (path, value) => {
    if (!Number.isInteger(value)) violations.push(`${node.type}:${node.id || '?'}:${path}=${value}`);
  };

  if (BOX_TYPES.has(node.type)) {
    check('x', node.x);
    check('y', node.y);
    check('w', node.w);
    check('h', node.h);
  } else if (node.type === 'line') {
    check('x1', node.x1);
    check('y1', node.y1);
    check('x2', node.x2);
    check('y2', node.y2);
  } else if (node.type === 'polygon') {
    (node.points || []).forEach((point, index) => {
      check(`points[${index}].x`, point.x);
      check(`points[${index}].y`, point.y);
    });
  }

  if (node.transform && typeof node.transform === 'object') {
    if (Object.hasOwn(node.transform, 'translateX')) check('transform.translateX', node.transform.translateX);
    if (Object.hasOwn(node.transform, 'translateY')) check('transform.translateY', node.transform.translateY);
  }
  return violations;
}

function projectGeometryViolations(project) {
  const violations = [];
  for (const page of project?.pages || []) {
    for (const node of page.nodes || []) violations.push(...geometryViolations(node));
  }
  return violations;
}

function normalizeProjectGeometry(project) {
  for (const page of project?.pages || []) {
    for (const node of page.nodes || []) normalizeNodeGeometry(node);
  }
  return project;
}

function assertIntegerProjectGeometry(project) {
  const violations = projectGeometryViolations(project);
  if (violations.length) {
    throw new Error(`元素位置和宽高必须为整数像素：${violations.slice(0, 8).join(', ')}`);
  }
  return project;
}

function installIntegerGeometryRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const P = PE?.persistence;
  const T = PE?.transformModel;
  const Workspace = PE?.ui?.Workspace;
  if (!M?.createNode || !C?.CommandBus || !C?.AddNodesCommand || !C?.UpdateNodesCommand || !P?.ProjectSerializer || !T?.moveNodeGeometry || !T?.normalizeTransform || !Workspace) {
    throw new Error('PixelEditor integer geometry dependencies are not initialized');
  }
  if (PE.integerGeometryInstalled) return;
  PE.integerGeometryInstalled = true;

  const originalNormalizeTranslation = T.normalizeTranslation;
  const originalNormalizeTransform = T.normalizeTransform;
  T.normalizeTranslation = function normalizeIntegerTranslation(value) {
    return finiteInteger(originalNormalizeTranslation(value));
  };
  T.normalizeTransform = function normalizeIntegerTransform(value = {}) {
    return normalizeTransformTranslation(originalNormalizeTransform(value));
  };

  const originalCreateNode = M.createNode;
  M.createNode = function createIntegerNode(type, props = {}) {
    return normalizeNodeGeometry(originalCreateNode(type, props));
  };

  const addPrototype = C.AddNodesCommand.prototype;
  const originalAddExecute = addPrototype.execute;
  addPrototype.execute = function executeIntegerAdd(state) {
    const originalNodes = this.nodes;
    this.nodes = (originalNodes || []).map(node => normalizeNodeGeometry(structuredClone(node)));
    try {
      return originalAddExecute.call(this, state);
    } finally {
      this.nodes = originalNodes;
    }
  };

  const updatePrototype = C.UpdateNodesCommand.prototype;
  const originalUpdateExecute = updatePrototype.execute;
  updatePrototype.execute = function executeIntegerUpdate(state) {
    const originalPatch = this.patch;
    this.patch = node => normalizeGeometryPatch(
      node,
      typeof originalPatch === 'function' ? originalPatch(node) : originalPatch,
    );
    try {
      return originalUpdateExecute.call(this, state);
    } finally {
      this.patch = originalPatch;
    }
  };

  const selectionTransformPrototype = C.SelectionTransformCommand?.prototype;
  if (selectionTransformPrototype?.execute) {
    const originalSelectionTransformExecute = selectionTransformPrototype.execute;
    selectionTransformPrototype.execute = function executeSelectionTransformOnIntegerGrid(state) {
      const normalNormalizeTransform = T.normalizeTransform;
      T.normalizeTransform = function normalizeUnbiasedSelectionTransform(value = {}) {
        return normalizeTransformTranslation(originalNormalizeTransform(value), nearestEvenInteger);
      };
      try {
        return originalSelectionTransformExecute.call(this, state);
      } finally {
        T.normalizeTransform = normalNormalizeTransform;
      }
    };
  }

  // Every committed command passes this boundary before CommandBus snapshots the
  // project. Tool-specific code may calculate in floating point, but committed
  // editable geometry can never enter history with fractional pixel values.
  const busPrototype = C.CommandBus.prototype;
  const originalBusExecute = busPrototype.execute;
  busPrototype.execute = function executeWithIntegerGeometryBoundary(command) {
    if (!command || typeof command.execute !== 'function') return originalBusExecute.call(this, command);
    const originalCommandExecute = command.execute;
    command.execute = function executeAndNormalizeGeometry(state) {
      const changed = originalCommandExecute.call(this, state);
      if (changed !== false) normalizeProjectGeometry(state.project);
      return changed;
    };
    try {
      return originalBusExecute.call(this, command);
    } finally {
      command.execute = originalCommandExecute;
    }
  };

  const originalMoveNodeGeometry = T.moveNodeGeometry;
  T.moveNodeGeometry = function moveNodeGeometryOnIntegerGrid(node, dx, dy) {
    const result = originalMoveNodeGeometry(
      node,
      finiteInteger(dx),
      finiteInteger(dy),
    );
    normalizeNodeGeometry(node);
    return result;
  };

  const liveNode = (workspace, gesture) => {
    const id = gesture?.nodeId;
    return id ? M.nodeById(workspace.activePage(), id) : null;
  };

  const originalBeginLiveDraw = Workspace.prototype.beginLiveDraw;
  Workspace.prototype.beginLiveDraw = function beginIntegerLiveDraw(tool, point) {
    const result = originalBeginLiveDraw.call(this, tool, integerPoint(point));
    normalizeNodeGeometry(liveNode(this, this.customGesture));
    return result;
  };

  const originalUpdateLiveDraw = Workspace.prototype.updateLiveDraw;
  Workspace.prototype.updateLiveDraw = function updateIntegerLiveDraw(gesture, point) {
    const result = originalUpdateLiveDraw.call(this, gesture, integerPoint(point));
    normalizeNodeGeometry(liveNode(this, gesture));
    return result;
  };

  const originalCommitLiveDraw = Workspace.prototype.commitLiveDraw;
  Workspace.prototype.commitLiveDraw = function commitIntegerLiveDraw(gesture) {
    normalizeNodeGeometry(liveNode(this, gesture));
    const result = originalCommitLiveDraw.call(this, gesture);
    normalizeNodeGeometry(liveNode(this, gesture));
    return result;
  };

  const serializer = P.ProjectSerializer;
  const originalSerialize = serializer.serialize.bind(serializer);
  const originalDeserialize = serializer.deserialize.bind(serializer);
  serializer.serialize = function serializeIntegerGeometry(project, assets) {
    assertIntegerProjectGeometry(project);
    return originalSerialize(project, assets);
  };
  serializer.deserialize = function deserializeIntegerGeometry(raw) {
    const result = originalDeserialize(raw);
    assertIntegerProjectGeometry(result.project);
    return result;
  };

  PE.integerGeometry = {
    BOX_TYPES,
    finiteInteger,
    nearestEvenInteger,
    positiveInteger,
    integerPoint,
    normalizeTransformTranslation,
    normalizeNodeGeometry,
    normalizeGeometryPatch,
    normalizeProjectGeometry,
    geometryViolations,
    projectGeometryViolations,
    assertIntegerProjectGeometry,
  };
}

export {
  BOX_TYPES,
  finiteInteger,
  nearestEvenInteger,
  positiveInteger,
  integerPoint,
  normalizeTransformTranslation,
  normalizeNodeGeometry,
  normalizeGeometryPatch,
  normalizeProjectGeometry,
  geometryViolations,
  projectGeometryViolations,
  assertIntegerProjectGeometry,
  installIntegerGeometryRuntime,
};
