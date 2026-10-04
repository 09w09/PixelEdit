const M = globalThis.PixelEditor.model;
function createProject(name = '未命名工程') {
  const page = M.createPage('页面 1');
  return { version: 17, width: 400, height: 300, name, pages: [page], activePageId: page.id, fonts: [] };
}
function pageById(project, id) { return project?.pages?.find(page => page.id === id) || null; }
function nodeById(page, id) { return page?.nodes?.find(node => node.id === id) || null; }
Object.assign(M, { createProject, pageById, nodeById });
export { createProject, pageById, nodeById };
