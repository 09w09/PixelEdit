const RASTER_ENCODING = 'bitset-base64-v1';

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeRasterPixels(pixels) {
  const source = pixels instanceof Uint8Array ? pixels : Uint8Array.from(pixels || []);
  const bytes = new Uint8Array(Math.ceil(source.length / 8));
  for (let index = 0; index < source.length; index += 1) {
    if (source[index]) bytes[index >> 3] |= 1 << (index & 7);
  }
  return bytesToBase64(bytes);
}

function decodeRasterPixels(data, width, height) {
  const length = Math.max(0, Math.round(Number(width) || 0) * Math.round(Number(height) || 0));
  const bytes = base64ToBytes(data);
  const pixels = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    pixels[index] = (bytes[index >> 3] || 0) >> (index & 7) & 1;
  }
  return pixels;
}

function createRasterPayload(width, height, pixels = null) {
  const length = Math.max(1, Math.round(Number(width) || 1)) * Math.max(1, Math.round(Number(height) || 1));
  const normalized = new Uint8Array(length);
  if (pixels) {
    const source = pixels instanceof Uint8Array ? pixels : Uint8Array.from(pixels);
    normalized.set(source.subarray(0, length));
  }
  return { encoding: RASTER_ENCODING, data: encodeRasterPixels(normalized) };
}

function pixelsFromNode(node) {
  if (!node?.raster || node.raster.encoding !== RASTER_ENCODING) {
    return new Uint8Array(Math.max(1, Number(node?.w) || 1) * Math.max(1, Number(node?.h) || 1));
  }
  return decodeRasterPixels(node.raster.data, node.w, node.h);
}

function paintRaster(node, points, value) {
  const pixels = pixelsFromNode(node);
  const width = Math.max(1, Math.round(Number(node.w) || 1));
  const height = Math.max(1, Math.round(Number(node.h) || 1));
  for (const point of points || []) {
    const x = Math.round(Number(point.x));
    const y = Math.round(Number(point.y));
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    pixels[y * width + x] = value ? 1 : 0;
  }
  return createRasterPayload(width, height, pixels);
}

function resizeRaster(node, geometry) {
  const oldX = Math.round(Number(node.x) || 0);
  const oldY = Math.round(Number(node.y) || 0);
  const oldW = Math.max(1, Math.round(Number(node.w) || 1));
  const oldH = Math.max(1, Math.round(Number(node.h) || 1));
  const x = Math.round(Number(geometry.x) || 0);
  const y = Math.round(Number(geometry.y) || 0);
  const w = Math.max(1, Math.round(Number(geometry.w) || 1));
  const h = Math.max(1, Math.round(Number(geometry.h) || 1));
  const source = pixelsFromNode(node);
  const output = new Uint8Array(w * h);

  for (let ny = 0; ny < h; ny += 1) {
    const globalY = y + ny;
    const oy = globalY - oldY;
    if (oy < 0 || oy >= oldH) continue;
    for (let nx = 0; nx < w; nx += 1) {
      const globalX = x + nx;
      const ox = globalX - oldX;
      if (ox < 0 || ox >= oldW) continue;
      output[ny * w + nx] = source[oy * oldW + ox];
    }
  }

  return { x, y, w, h, raster: createRasterPayload(w, h, output) };
}

function pixelsToRgba(pixels, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = pixels[index] ? 0 : 255;
    const offset = index * 4;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function adaptRasterProject(project, assets) {
  const clone = structuredClone(project);
  const runtimes = new Map();
  for (const page of clone.pages || []) {
    for (const node of page.nodes || []) {
      if (node.type !== 'raster') continue;
      const id = `__pixeledit_raster__${node.id}`;
      const pixels = pixelsFromNode(node);
      runtimes.set(id, { width: node.w, height: node.h, data: pixelsToRgba(pixels, node.w, node.h) });
      node.type = 'image';
      node.assetId = id;
      node.sourceWidth = node.w;
      node.sourceHeight = node.h;
      node.sourceType = 'raster-runtime';
      node.sourceName = '';
      node.svgViewBox = null;
      node.image = {
        fit: 'stretch', interpolation: 'nearest', cropX: 0, cropY: 0, cropW: node.w, cropH: node.h,
        bwMode: 'threshold', threshold: 128, invert: false, ditherAlgorithm: 'bayer', bayerMatrix: 4,
      };
      node.overlay = {};
      delete node.raster;
    }
  }
  const proxy = Object.create(assets || null);
  proxy.getRuntime = id => runtimes.get(id) || assets?.getRuntime?.(id) || null;
  proxy.get = id => assets?.get?.(id) || null;
  return { project: clone, assets: proxy };
}

function rasterizeSubtree({ project, pageId, nodeId, assets, framebufferRenderer }) {
  const cut = framebufferRenderer.subtreeRgba(project, pageId, nodeId, assets);
  const pixels = new Uint8Array(cut.w * cut.h);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    const alpha = cut.data[offset + 3];
    if (alpha > 0) {
      const luma = cut.data[offset] * 0.299 + cut.data[offset + 1] * 0.587 + cut.data[offset + 2] * 0.114;
      pixels[index] = luma < 128 ? 1 : 0;
    }
  }
  return { x: cut.x, y: cut.y, w: cut.w, h: cut.h, pixels };
}

function installRasterLayerRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const R = PE?.renderer;
  const Workspace = PE?.ui?.Workspace;
  const Properties = PE?.ui?.Properties;
  if (!M?.createNode || !R?.FramebufferRenderer || !Workspace) throw new Error('PixelEditor is not initialized');
  if (PE.rasterLayerInstalled) return;
  PE.rasterLayerInstalled = true;

  const originalCreateNode = M.createNode;
  M.createNode = function createNode(type, props = {}) {
    if (type !== 'raster') return originalCreateNode(type, props);
    const w = Math.max(1, Math.round(Number(props.w) || 40));
    const h = Math.max(1, Math.round(Number(props.h) || 30));
    let raster;
    if (props.raster?.encoding === RASTER_ENCODING) raster = structuredClone(props.raster);
    else raster = createRasterPayload(w, h, props.pixels || null);
    return {
      id: props.id || M.nextId('raster'),
      type: 'raster',
      name: props.name || '栅格',
      parentId: props.parentId ?? null,
      visible: props.visible !== false,
      locked: Boolean(props.locked),
      x: Math.round(Number(props.x) || 0),
      y: Math.round(Number(props.y) || 0),
      w,
      h,
      aspectLocked: Boolean(props.aspectLocked),
      raster,
    };
  };

  const framebuffer = R.FramebufferRenderer;
  const originalRenderPage = framebuffer.renderPage;
  const originalRenderSubtree = framebuffer.renderSubtree;
  const originalSubtreeRgba = framebuffer.subtreeRgba;
  framebuffer.renderPage = function renderPage(project, pageId, assets) {
    const adapted = adaptRasterProject(project, assets);
    return originalRenderPage(adapted.project, pageId, adapted.assets);
  };
  framebuffer.renderSubtree = function renderSubtree(project, pageId, nodeId, assets, base = 0) {
    const adapted = adaptRasterProject(project, assets);
    return originalRenderSubtree(adapted.project, pageId, nodeId, adapted.assets, base);
  };
  framebuffer.subtreeRgba = function subtreeRgba(project, pageId, nodeId, assets) {
    const adapted = adaptRasterProject(project, assets);
    return originalSubtreeRgba(adapted.project, pageId, nodeId, adapted.assets);
  };

  const originalPaintTarget = Workspace.prototype.paintTarget;
  Workspace.prototype.paintTarget = function paintTarget() {
    const page = this.activePage();
    const id = this.state.selection.primaryId;
    const node = M.nodeById(page, id);
    const tree = new M.TreeModel(page);
    if (node) {
      if (node.type !== 'raster' || tree.isEffectivelyLocked(node.id) || !tree.isEffectivelyVisible(node.id)) return null;
      return { kind: 'node', node };
    }
    return originalPaintTarget.call(this);
  };

  const originalBeginPaint = Workspace.prototype.beginPaint;
  Workspace.prototype.beginPaint = function beginPaint(point) {
    const targetInfo = this.paintTarget();
    if (!targetInfo || targetInfo.kind !== 'node' || targetInfo.node.type !== 'raster') {
      return originalBeginPaint.call(this, point);
    }
    this.notice('');
    this.customGesture = {
      type: 'paint', targetKind: 'raster', nodeId: targetInfo.node.id, pageId: this.activePage().id,
      value: this.tool === 'pencil' ? 1 : 0, start: point, last: point, lastPaint: point,
      originalRaster: structuredClone(targetInfo.node.raster), changed: false,
    };
    this.applyPaintSegment(this.customGesture, point, point);
    this.renderCanvas();
    return true;
  };

  const originalApplyPaintSegment = Workspace.prototype.applyPaintSegment;
  Workspace.prototype.applyPaintSegment = function applyPaintSegment(gesture, a, b) {
    if (gesture.targetKind !== 'raster') return originalApplyPaintSegment.call(this, gesture, a, b);
    const node = M.nodeById(this.activePage(), gesture.nodeId);
    if (!node || node.type !== 'raster') return false;
    const points = this.linePoints(a, b).map(p => ({ x: p.x - node.x, y: p.y - node.y }));
    const before = node.raster.data;
    node.raster = paintRaster(node, points, gesture.value);
    const changed = node.raster.data !== before;
    gesture.changed = gesture.changed || changed;
    return changed;
  };

  const originalCommitPaint = Workspace.prototype.commitPaint;
  Workspace.prototype.commitPaint = function commitPaint(gesture) {
    if (gesture.targetKind !== 'raster') return originalCommitPaint.call(this, gesture);
    const page = this.activePage();
    const node = M.nodeById(page, gesture.nodeId);
    if (!node) return false;
    const finalRaster = structuredClone(node.raster);
    node.raster = structuredClone(gesture.originalRaster);
    if (!gesture.changed) return false;
    return this.exec(new C.UpdateNodesCommand([node.id], { raster: finalRaster }, page.id, gesture.value ? '栅格铅笔' : '栅格橡皮'));
  };

  const originalCancelCustomGesture = Workspace.prototype.cancelCustomGesture;
  Workspace.prototype.cancelCustomGesture = function cancelCustomGesture() {
    const gesture = this.customGesture;
    if (gesture?.type === 'paint' && gesture.targetKind === 'raster') {
      const node = M.nodeById(this.activePage(), gesture.nodeId);
      if (node) node.raster = structuredClone(gesture.originalRaster);
      this.customGesture = null;
      this.overlayState = {};
      this.renderCanvas();
      return;
    }
    return originalCancelCustomGesture.call(this);
  };

  Workspace.prototype.rasterizeSelected = async function rasterizeSelected() {
    const page = this.activePage();
    const id = this.state.selection.primaryId;
    const node = M.nodeById(page, id);
    const tree = new M.TreeModel(page);
    if (!node || tree.isEffectivelyLocked(id)) return false;
    const children = tree.childrenOf(id);
    if (node.type === 'raster' && children.length === 0) return false;
    if (typeof confirm === 'function' && !confirm('确认将该图层及其所有子图层栅格化为固定像素图层吗？')) return false;
    const cut = rasterizeSubtree({ project: this.state.project, pageId: page.id, nodeId: id, assets: this.state.assets, framebufferRenderer: R.FramebufferRenderer });
    const replacement = M.createNode('raster', {
      id: node.id, parentId: node.parentId, name: node.name, visible: node.visible, locked: node.locked,
      x: cut.x, y: cut.y, w: cut.w, h: cut.h, pixels: cut.pixels,
    });
    const ids = new Set([id, ...tree.descendantsOf(id).map(item => item.id)]);
    const index = page.nodes.findIndex(item => item.id === id);
    return this.exec({
      label: '栅格化图层',
      execute: () => {
        page.nodes = page.nodes.filter(item => !ids.has(item.id));
        page.nodes.splice(Math.min(index, page.nodes.length), 0, replacement);
        this.state.selection.replace([replacement.id]);
        return true;
      },
    });
  };

  const originalSetSelectionSize = Workspace.prototype.setSelectionSize;
  Workspace.prototype.setSelectionSize = function setSelectionSize(axis, target) {
    const page = this.activePage();
    const rasterIds = this.state.selection.ids.filter(id => M.nodeById(page, id)?.type === 'raster');
    if (!rasterIds.length) return originalSetSelectionSize.call(this, axis, target);
    target = Math.max(1, Math.round(Number(target)));
    if (!Number.isFinite(target)) return false;
    return this.exec(new C.UpdateNodesCommand(rasterIds, node => {
      const geometry = { x: node.x, y: node.y, w: node.w, h: node.h };
      if (axis === 'w') geometry.w = target;
      else geometry.h = target;
      if (node.aspectLocked) {
        const ratio = node.w / Math.max(1, node.h);
        if (axis === 'w') geometry.h = Math.max(1, Math.round(target / ratio));
        else geometry.w = Math.max(1, Math.round(target * ratio));
      }
      return resizeRaster(node, geometry);
    }, page.id, '调整栅格尺寸'));
  };

  const originalCommitLiveHandle = Workspace.prototype.commitLiveHandle;
  Workspace.prototype.commitLiveHandle = function commitLiveHandle(gesture) {
    const page = this.activePage();
    const node = M.nodeById(page, gesture.nodeId);
    if (gesture.type !== 'resize-live' || node?.type !== 'raster') return originalCommitLiveHandle.call(this, gesture);
    const geometry = { x: node.x, y: node.y, w: node.w, h: node.h };
    const original = structuredClone(gesture.original);
    Object.assign(node, original);
    const patch = resizeRaster(original, geometry);
    return this.exec(new C.UpdateNodesCommand([gesture.nodeId], patch, page.id, '调整栅格大小'));
  };

  if (Properties) {
    const originalTransform = Properties.prototype.transform;
    Properties.prototype.transform = function transform(nodes, locked) {
      const adapted = nodes.map(node => node.type === 'raster' ? { ...node, type: 'image' } : node);
      return originalTransform.call(this, adapted, locked);
    };
    const originalTypeFields = Properties.prototype.typeFields;
    Properties.prototype.typeFields = function typeFields(nodes, locked) {
      if (nodes[0]?.type === 'raster') {
        return '<div class="property-section"><h4>栅格</h4><div class="muted">固定 1-bit 像素画布，可使用铅笔和橡皮编辑；调整边框只扩展白色区域或裁剪，不缩放像素。</div></div>';
      }
      return originalTypeFields.call(this, nodes, locked);
    };
    const originalBind = Properties.prototype.bind;
    Properties.prototype.bind = function bind(nodes, locked) {
      const changed = [];
      for (const node of nodes) if (node.type === 'raster') { changed.push(node); node.type = 'image'; }
      try { return originalBind.call(this, nodes, locked); }
      finally { for (const node of changed) node.type = 'raster'; }
    };
  }

  PE.rasterLayer = {
    encoding: RASTER_ENCODING,
    encodeRasterPixels,
    decodeRasterPixels,
    createRasterPayload,
    paintRaster,
    resizeRaster,
    rasterizeSubtree,
  };
}

export {
  RASTER_ENCODING,
  encodeRasterPixels,
  decodeRasterPixels,
  createRasterPayload,
  paintRaster,
  resizeRaster,
  rasterizeSubtree,
  installRasterLayerRuntime,
};
