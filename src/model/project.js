import { createPage } from './page.js';

function createProject(name = '未命名工程') {
  const page = createPage('页面 1');
  return { version: 17, width: 400, height: 300, name, pages: [page], activePageId: page.id, fonts: [] };
}
function pageById(project, id) { return project?.pages?.find(page => page.id === id) || null; }
function nodeById(page, id) { return page?.nodes?.find(node => node.id === id) || null; }

export { createProject, pageById, nodeById };
