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

  PE.workspaceCapabilities = PE.workspaceCapabilities || {};
  PE.workspaceCapabilities.bucketFillTarget = function bucketFillTarget(editor) {
    const page = editor.activePage();
    const id = editor.state.selection.primaryId;
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

  PE.workspaceCapabilities = PE.workspaceCapabilities || {};
  PE.workspaceCapabilities.bucketFillRaster = function bucketFillRaster(editor, node, point, settings) {
    const page = editor.activePage();
    const geometry = PE.selectionGeometry;
    const pivot = PE.selectionOverlay?.sourcePivotBounds?.(editor, node) || geometry?.sourceGeometryBounds?.(node);
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
    return editor.exec(new C.UpdateNodesCommand([node.id], { raster }, page.id, '油漆桶填充'));
  };

  PE.workspaceCapabilities = PE.workspaceCapabilities || {};
  PE.workspaceCapabilities.bucketFillPage = function bucketFillPage(editor, page, point, settings) {
    const sx = Math.max(0, Math.min(399, Math.round(point.x)));
    const sy = Math.max(0, Math.min(299, Math.round(point.y)));
    const source = R.FramebufferRenderer.renderPage(editor.state.project, page.id, editor.state.assets);
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
    editor.state.selection.clear();
    editor.pageSelectedId = page.id;
    return editor.exec(new C.UpdatePageCommand(page.id, { overlay }, '背景油漆桶填充'));
  };

  PE.workspaceCapabilities = PE.workspaceCapabilities || {};
  PE.workspaceCapabilities.bucketFillImage = function bucketFillImage(editor, node, point, settings) {
    const page = editor.activePage();
    const sx = Math.floor(point.x - node.x);
    const sy = Math.floor(point.y - node.y);
    if (sx < 0 || sy < 0 || sx >= node.w || sy >= node.h) return false;
    const subtree = R.FramebufferRenderer.renderSubtree(editor.state.project, page.id, node.id, editor.state.assets, 0);
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
    return editor.exec(new C.UpdateNodesCommand([node.id], { overlay }, page.id, '图片油漆桶填充'));
  };

  PE.workspaceCapabilities = PE.workspaceCapabilities || {};
  PE.workspaceCapabilities.bucketFillAt = function bucketFillAt(editor, point) {
    const info = editor.bucketFillTarget();
    if (!info) {
      editor.notice('油漆桶只能编辑未锁定的图片 / 栅格图层；未选择图层时编辑页面背景');
      return false;
    }
    editor.notice('');
    const settings = toolSettings(editor);
    if (info.kind === 'page') return editor.bucketFillPage(info.page, point, settings);
    if (info.node.type === 'raster') return editor.bucketFillRaster(info.node, point, settings);
    return editor.bucketFillImage(info.node, point, settings);
  };

  PE.floodFill = { collectFloodRegion, sampledBit };
}

export { collectFloodRegion, installFloodFillRuntime };
