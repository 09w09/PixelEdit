import { nextId } from './ids.js';
import { defaultToolDither, defaultToolPattern } from './fill-values.js';

function createPage(name = '页面') {
  return { id: nextId('page'), name, width: 400, height: 300, locked: false, fill: { mode: 'solid', color: 0 }, dither: defaultToolDither(), pattern: defaultToolPattern(), overlay: {}, nodes: [] };
}

export { createPage };
