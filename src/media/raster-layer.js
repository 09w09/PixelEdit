import { createNode, nodeById, TreeModel } from '../model/index.js';
import { FramebufferRenderer } from '../rendering/renderer.js';
import {
  RASTER_TRANSPARENT,
  RASTER_WHITE,
  RASTER_BLACK,
  RASTER_ENCODING,
  createTriStateRaster,
  decodeTriStatePixels,
  paintTriStateRaster,
  resizeTriStateRaster,
} from '../raster/tristate-raster.js';

function rasterizeSubtree({ project, pageId, nodeId, assets, framebufferRenderer = FramebufferRenderer }) {
  const cut = framebufferRenderer.subtreeRgba(project, pageId, nodeId, assets);
  const pixels = new Uint8Array(cut.w * cut.h);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    if (cut.data[offset + 3] === 0) pixels[index] = RASTER_TRANSPARENT;
    else {
      const luma = cut.data[offset] * 0.299 + cut.data[offset + 1] * 0.587 + cut.data[offset + 2] * 0.114;
      pixels[index] = luma < 128 ? RASTER_BLACK : RASTER_WHITE;
    }
  }
  return { x: cut.x, y: cut.y, w: cut.w, h: cut.h, pixels };
}

function validateRasterProject(project) {
  for (const page of project?.pages || []) for (const node of page.nodes || []) {
    if (node.type !== 'raster') continue;
    if (!node.raster || node.raster.encoding !== RASTER_ENCODING) throw new Error('V17 栅格数据格式无效');
    decodeTriStatePixels(node.raster.data, node.w, node.h);
  }
  return project;
}

async function rasterizeSelected(editor, target = globalThis) {
  const page = editor.activePage();
  const id = editor.state.selection.primaryId;
  const node = nodeById(page, id);
  const tree = new TreeModel(page);
  if (!node || tree.isEffectivelyLocked(id)) return false;
  if (node.type === 'raster' && tree.childrenOf(id).length === 0) return false;
  if (typeof target.confirm === 'function' && !target.confirm('确认将该图层及其所有子图层栅格化为固定像素图层吗？')) return false;
  const cut = rasterizeSubtree({ project: editor.state.project, pageId: page.id, nodeId: id, assets: editor.state.assets });
  const replacement = createNode('raster', {
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    visible: node.visible,
    locked: node.locked,
    x: cut.x,
    y: cut.y,
    w: cut.w,
    h: cut.h,
    pixels: cut.pixels,
    transform: node.transform,
  });
  const ids = new Set([id, ...tree.descendantsOf(id).map(item => item.id)]);
  const index = page.nodes.findIndex(item => item.id === id);
  return editor.exec({ label: '栅格化图层', execute: () => {
    page.nodes = page.nodes.filter(item => !ids.has(item.id));
    page.nodes.splice(Math.min(index, page.nodes.length), 0, replacement);
    editor.state.selection.replace([replacement.id]);
    return true;
  } });
}

const rasterLayer = Object.freeze({
  encoding: RASTER_ENCODING,
  decodeRasterPixels: decodeTriStatePixels,
  createRasterPayload: createTriStateRaster,
  paintRaster: paintTriStateRaster,
  resizeRaster: resizeTriStateRaster,
  rasterizeSubtree,
  validateRasterProject,
  rasterizeSelected,
});

export { RASTER_ENCODING, rasterizeSubtree, validateRasterProject, rasterizeSelected, rasterLayer };
