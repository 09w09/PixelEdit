const M = globalThis.PixelEditor.model;
function createPage(name = '页面') {
  return { id: M.nextId('page'), name, width: 400, height: 300, locked: false, fill: { mode: 'solid', color: 0 }, dither: M.defaultDither(), pattern: M.defaultPattern(), overlay: {}, nodes: [] };
}
M.createPage = createPage;
export { createPage };
