import { normalizeToolFill, normalizeDither, normalizePattern } from '../model/fill-values.js';

function collectFloodRegion(source, width, height, startX, startY) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const x = Math.round(Number(startX));
  const y = Math.round(Number(startY));
  if (x < 0 || y < 0 || x >= w || y >= h) return [];
  const start = y * w + x;
  const target = source[start];
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const region = [];
  let read = 0;
  let write = 0;
  queue[write++] = start;
  seen[start] = 1;

  while (read < write) {
    const index = queue[read++];
    if (source[index] !== target) continue;
    region.push(index);
    const px = index % w;
    const py = Math.floor(index / w);
    const neighbors = [];
    if (px > 0) neighbors.push(index - 1);
    if (px + 1 < w) neighbors.push(index + 1);
    if (py > 0) neighbors.push(index - w);
    if (py + 1 < h) neighbors.push(index + w);
    for (const next of neighbors) {
      if (seen[next] || source[next] !== target) continue;
      seen[next] = 1;
      queue[write++] = next;
    }
  }
  return region;
}

function toolSettings(editor) {
  const settings = editor.getToolDefaults?.('bucket') || {};
  return {
    fill: normalizeToolFill(settings.fill, { mode: 'solid', color: 1 }),
    dither: normalizeDither(settings.dither),
    pattern: normalizePattern(settings.pattern),
  };
}

function sampledBit(settings, renderer, absoluteX, absoluteY, localX, localY) {
  if (settings.fill.mode === 'solid') return settings.fill.color;
  if (settings.fill.mode === 'dither') {
    return renderer.graphicDitherPixel(settings.dither, absoluteX, absoluteY, localX, localY) ? 1 : 0;
  }
  if (settings.fill.mode === 'pattern') {
    return renderer.patternPixel(settings.pattern, absoluteX, absoluteY, localX, localY) ? 1 : 0;
  }
  return null;
}

function rasterState(settings, renderer, tristate, absoluteX, absoluteY, localX, localY) {
  if (settings.fill.mode === 'transparent') return tristate.RASTER_TRANSPARENT;
  const bit = sampledBit(settings, renderer, absoluteX, absoluteY, localX, localY);
  return bit ? tristate.RASTER_BLACK : tristate.RASTER_WHITE;
}

function ensureBucketButton() {
  if (document.querySelector('[data-tool="bucket"]')) return;
  const eraser = document.querySelector('[data-tool="eraser"]');
  const grid = eraser?.closest('.tool-grid');
  if (!grid) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.tool = 'bucket';
  button.className = 'tool-btn';
  button.title = '油漆桶（B）';
  button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 4l8 8-6 6-6-6zM7 4l2-2 8 8M14 17h7M18 14l3 3-3 3"/></svg><span>油漆桶</span>';
  eraser.insertAdjacentElement('afterend', button);
}

function installFloodFillRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const R = PE?.renderer;
  const T = PE?.tristateRaster;
  const Workspace = PE?.ui?.Workspace;
  if (!M || !C || !R?.FramebufferRenderer || !T || !Workspace) {
    throw new Error('PixelEditor flood fill dependencies are not initialized');
  }
  if (PE.floodFillInstalled) return;
  PE.floodFillInstalled = true;

  const originalMount = Workspace.prototype.mount;
  Workspace.prototype.mount = function mountWithBucket() {
    const result = originalMount.call(this);
    ensureBucketButton();
    this.toolbar?.mount?.();
    const shortcut = event => {
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable;
      if (editing || event.ctrlKey || event.metaKey || event.altKey || event.key?.toLowerCase() !== 'b') return;
      event.preventDefault();
      this.setTool('bucket');
    };
    target.addEventListener?.('keydown', shortcut);
    return result;
  };

  const originalSetTool = Workspace.prototype.setTool;
  Workspace.prototype.setTool = function setToolWithBucket(tool) {
    if (tool !== 'bucket') return originalSetTool.call(this, tool);
    this.cancelCustomGesture?.();
    this.tool = 'bucket';
    document.querySelectorAll('[data-tool]').forEach(button => {
      button.classList.toggle('active', button.dataset.tool === 'bucket');
    });
    this.updateInteraction?.();
    this.toolOptionsBar?.render?.();
    return 'bucket';
  };

  Workspace.prototype.bucketFillTarget = function bucketFillTarget() {
    const page = this.activePage();
    const id = this.state.selection.primaryId;
    const node = M.nodeById(page, id);
    const tree = new M.TreeModel(page);
    if (node) {
      if (tree.isEffectivelyLocked(node.id) || !tree.isEffectivelyVisible(node.id)) return null;
      if (node.type === 'raster' || node.type === 'image') return { kind: 'node', node };
      return null;
    }
    if (!page.locked) return { kind: 'page', page };
    return null;
  };

  Workspace.prototype.bucketFillRaster = function bucketFillRaster(node, point, settings) {
    const page = this.activePage();
    const geometry = PE.selectionGeometry;
    const pivot = PE.selectionOverlay?.sourcePivotBounds?.(this, node) || geometry?.sourceGeometryBounds?.(node);
    const localPoint = geometry?.worldToLocal
      ? geometry.worldToLocal(node, point, pivot)
      : point;
    const sx = Math.floor(localPoint.x - node.x);
    const sy = Math.floor(localPoint.y - node.y);
    if (sx < 0 || sy < 0 || sx >= node.w || sy >= node.h) return false;

    const pixels = T.pixelsFromRasterNode(node);
    const region = collectFloodRegion(pixels, node.w, node.h, sx, sy);
    if (!region.length) return false;
    let changed = false;
    for (const index of region) {
      const x = index % node.w;
      const y = Math.floor(index / node.w);
      const value = rasterState(settings, R, T, node.x + x, node.y + y, x, y);
      if (pixels[index] === value) continue;
      pixels[index] = value;
      changed = true;
    }
    if (!changed) return false;
    const raster = T.createTriStateRaster(node.w, node.h, pixels);
    return this.exec(new C.UpdateNodesCommand([node.id], { raster }, page.id, '油漆桶填充'));
  };

  Workspace.prototype.bucketFillPage = function bucketFillPage(page, point, settings) {
    const sx = Math.max(0, Math.min(399, Math.round(point.x)));
    const sy = Math.max(0, Math.min(299, Math.round(point.y)));
    const source = R.FramebufferRenderer.renderPage(this.state.project, page.id, this.state.assets);
    const region = collectFloodRegion(source, 400, 300, sx, sy);
    if (!region.length) return false;
    const overlay = structuredClone(page.overlay || {});
    let changed = false;
    for (const index of region) {
      const x = index % 400;
      const y = Math.floor(index / 400);
      const key = `${x},${y}`;
      if (settings.fill.mode === 'transparent') {
        if (Object.hasOwn(overlay, key)) {
          delete overlay[key];
          changed = true;
        }
        continue;
      }
      const value = sampledBit(settings, R, x, y, x, y);
      if (overlay[key] === value) continue;
      overlay[key] = value;
      changed = true;
    }
    if (!changed) return false;
    this.state.selection.clear();
    this.pageSelectedId = page.id;
    return this.exec(new C.UpdatePageCommand(page.id, { overlay }, '背景油漆桶填充'));
  };

  Workspace.prototype.bucketFillImage = function bucketFillImage(node, point, settings) {
    const page = this.activePage();
    const sx = Math.floor(point.x - node.x);
    const sy = Math.floor(point.y - node.y);
    if (sx < 0 || sy < 0 || sx >= node.w || sy >= node.h) return false;
    const subtree = R.FramebufferRenderer.renderSubtree(this.state.project, page.id, node.id, this.state.assets, 0);
    const source = new Uint8Array(node.w * node.h);
    for (let y = 0; y < node.h; y += 1) {
      for (let x = 0; x < node.w; x += 1) {
        source[y * node.w + x] = subtree[(node.y + y) * 400 + node.x + x] ? 1 : 0;
      }
    }
    const region = collectFloodRegion(source, node.w, node.h, sx, sy);
    if (!region.length) return false;
    const overlay = structuredClone(node.overlay || {});
    let changed = false;
    for (const index of region) {
      const x = index % node.w;
      const y = Math.floor(index / node.w);
      const key = `${x},${y}`;
      if (settings.fill.mode === 'transparent') {
        if (Object.hasOwn(overlay, key)) {
          delete overlay[key];
          changed = true;
        }
        continue;
      }
      const value = sampledBit(settings, R, node.x + x, node.y + y, x, y);
      if (overlay[key] === value) continue;
      overlay[key] = value;
      changed = true;
    }
    if (!changed) return false;
    return this.exec(new C.UpdateNodesCommand([node.id], { overlay }, page.id, '图片油漆桶填充'));
  };

  Workspace.prototype.bucketFillAt = function bucketFillAt(point) {
    const info = this.bucketFillTarget();
    if (!info) {
      this.notice('油漆桶只能编辑未锁定的图片 / 栅格图层；未选择图层时编辑页面背景');
      return false;
    }
    this.notice('');
    const settings = toolSettings(this);
    if (info.kind === 'page') return this.bucketFillPage(info.page, point, settings);
    if (info.node.type === 'raster') return this.bucketFillRaster(info.node, point, settings);
    return this.bucketFillImage(info.node, point, settings);
  };

  const originalPointerDown = Workspace.prototype.onPointerDown;
  Workspace.prototype.onPointerDown = function onPointerDownWithBucket(event) {
    if (this.tool !== 'bucket') return originalPointerDown.call(this, event);
    if (event.button === 2) return;
    const point = this.logicalPoint(event);
    this.canvas.setPointerCapture?.(event.pointerId);
    this.bucketFillAt(point);
  };

  PE.floodFill = {
    collectFloodRegion,
    sampledBit,
    ensureBucketButton,
  };
}

export { collectFloodRegion, installFloodFillRuntime };
