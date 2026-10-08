import { TreeModel, pageById } from '../model/index.js';
import {
  CreatePageCommand,
  RenamePageCommand,
  UpdatePageCommand,
  ReorderPageCommand,
  DuplicatePageCommand,
  DeletePageCommand,
  ReparentCommand,
  SetVisibilityCommand,
  ToggleLockCommand,
  UpdateNodesCommand,
} from '../commands/index.js';

const TYPE = { rectangle: '矩形', circle: '圆', polygon: '多边形', line: '直线', text: '文字', image: '图片 / 栅格' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const SVG = {
  eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.5 6.2A10.5 10.5 0 0 1 12 6c6 0 9.5 6 9.5 6a18 18 0 0 1-3.1 3.8M7.1 7.1C4.2 8.8 2.5 12 2.5 12s3.5 6 9.5 6c1.3 0 2.5-.3 3.5-.7M10 10a3 3 0 0 0 4 4"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2.6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24"><path d="M7 9l5 5 5-5"/></svg>',
  chevRight: '<svg viewBox="0 0 24 24"><path d="M9 7l5 5-5 5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>',
};

class PageDock {
  constructor(editor, el) {
    this.editor = editor;
    this.el = el;
    this.collapsedPages = new Set();
    this.collapsedLayers = new Set();
    this.lastClicked = null;
    this.flat = [];
  }

  icon(name, title = '', extra = '', disabled = false) {
    return `<button class="icon-btn ${extra}" type="button" title="${escapeHtml(title)}" ${disabled ? 'disabled' : ''}>${SVG[name]}</button>`;
  }

  render() {
    const project = this.editor.state.project, activeId = project.activePageId;
    let html = `<div class="guide-toolbar"><button id="pageAddBtn" class="icon-btn" title="新建页面">${SVG.plus}</button><span class="muted">页面 / 图层</span></div>`;
    this.flat = [];
    for (let pageIndex = 0; pageIndex < project.pages.length; pageIndex += 1) {
      const page = project.pages[pageIndex], active = page.id === activeId, selected = active && this.editor.pageSelectedId === page.id;
      const collapsed = this.collapsedPages.has(page.id), tree = new TreeModel(page), hasRoots = tree.roots().length > 0;
      html += `<div class="page-row ${active ? 'active' : ''} ${selected ? 'selected' : ''}" data-page-id="${escapeHtml(page.id)}">${hasRoots ? this.icon(collapsed ? 'chevRight' : 'chevDown', collapsed ? '展开页面' : '折叠页面', 'page-expand') : '<span class="icon-spacer"></span>'}${this.icon(page.locked ? 'lock' : 'unlock', page.locked ? '解锁页面' : '锁定页面', 'page-lock')}<div class="page-main">${escapeHtml(page.name)}<div class="layer-type">页面 / 背景</div></div>${this.icon('up', '页面上移', 'page-up')}${this.icon('down', '页面下移', 'page-down')}${this.icon('copy', '复制页面', 'page-duplicate')}${this.icon('trash', '删除页面', 'page-delete')}</div>`;
      if (active && !collapsed) {
        const rows = [];
        const walk = (parentId, depth) => {
          for (const node of tree.childrenOf(parentId).slice().reverse()) {
            rows.push({ node, depth });
            if (!this.collapsedLayers.has(node.id)) walk(node.id, depth + 1);
          }
        };
        walk(page.id, 1);
        for (const { node, depth } of rows) {
          const hasChildren = tree.childrenOf(node.id).length > 0, isSelected = this.editor.state.selection.has(node.id);
          const inheritedLocked = tree.isInheritedLocked(node.id), effectiveLocked = inheritedLocked || node.locked;
          const lockTitle = inheritedLocked ? '由页面或父图层锁定' : (node.locked ? '解锁图层' : '锁定图层');
          this.flat.push(node.id);
          html += `<div class="layer-row ${isSelected ? 'selected' : ''}" data-page-id="${escapeHtml(page.id)}" data-node-id="${escapeHtml(node.id)}" draggable="${!effectiveLocked}" style="--depth:${depth}">${this.icon(node.visible === false ? 'eyeOff' : 'eye', node.visible === false ? '显示图层' : '隐藏图层', 'layer-eye')}${this.icon(effectiveLocked ? 'lock' : 'unlock', lockTitle, 'layer-lock', inheritedLocked)}${hasChildren ? this.icon(this.collapsedLayers.has(node.id) ? 'chevRight' : 'chevDown', this.collapsedLayers.has(node.id) ? '展开子图层' : '折叠子图层', 'layer-expand') : '<span class="icon-spacer"></span>'}<div class="layer-main"><div class="layer-name">${escapeHtml(node.name)}</div><div class="layer-type">${escapeHtml(TYPE[node.type] || node.type)}</div></div></div>`;
        }
      }
    }
    this.el.innerHTML = html;
    if (project.pages.length <= 1) this.el.querySelectorAll('.page-delete').forEach(button => { button.disabled = true; });
    this.bind();
  }

  bind() {
    const project = this.editor.state.project;
    this.el.querySelector('#pageAddBtn')?.addEventListener('click', () => this.editor.exec(new CreatePageCommand(`页面 ${project.pages.length + 1}`)));
    this.el.querySelectorAll('.page-row').forEach((row, pageIndex) => {
      const id = row.dataset.pageId, page = pageById(project, id);
      row.querySelector('.page-main').onclick = () => this.editor.selectPage(id);
      row.querySelector('.page-main').ondblclick = () => { const name = prompt('页面名称', page.name); if (name) this.editor.exec(new RenamePageCommand(id, name)); };
      row.querySelector('.page-expand')?.addEventListener('click', event => { event.stopPropagation(); this.collapsedPages.has(id) ? this.collapsedPages.delete(id) : this.collapsedPages.add(id); this.render(); });
      row.querySelector('.page-lock')?.addEventListener('click', event => { event.stopPropagation(); this.editor.exec(new UpdatePageCommand(id, { locked: !page.locked }, page.locked ? '解锁页面' : '锁定页面')); });
      row.querySelector('.page-up').onclick = event => { event.stopPropagation(); this.editor.exec(new ReorderPageCommand(id, pageIndex - 1)); };
      row.querySelector('.page-down').onclick = event => { event.stopPropagation(); this.editor.exec(new ReorderPageCommand(id, pageIndex + 1)); };
      row.querySelector('.page-duplicate').onclick = event => { event.stopPropagation(); this.editor.exec(new DuplicatePageCommand(id)); };
      row.querySelector('.page-delete').onclick = event => { event.stopPropagation(); if (project.pages.length > 1 && confirm('确认删除该页面吗？')) this.editor.exec(new DeletePageCommand(id)); };
      row.ondragover = event => { if (id !== project.activePageId) return; event.preventDefault(); row.classList.add('drag-over'); };
      row.ondragleave = () => row.classList.remove('drag-over');
      row.ondrop = event => { event.preventDefault(); row.classList.remove('drag-over'); const source = this.editor.treeDragId || event.dataTransfer?.getData('text/plain'); if (source && id === project.activePageId) this.editor.exec(new ReparentCommand([source], id, null, id)); };
    });
    this.el.querySelectorAll('.layer-row').forEach(row => this.bindLayer(row));
  }

  bindLayer(row) {
    const page = this.editor.activePage(), tree = new TreeModel(page), id = row.dataset.nodeId, node = tree.node(id);
    row.querySelector('.layer-eye')?.addEventListener('click', event => { event.stopPropagation(); this.editor.exec(new SetVisibilityCommand([id], node.visible === false, page.id)); });
    row.querySelector('.layer-lock')?.addEventListener('click', event => { event.stopPropagation(); this.editor.exec(new ToggleLockCommand([id], !node.locked, page.id)); });
    row.querySelector('.layer-expand')?.addEventListener('click', event => { event.stopPropagation(); this.collapsedLayers.has(id) ? this.collapsedLayers.delete(id) : this.collapsedLayers.add(id); this.render(); });
    row.querySelector('.layer-main').onclick = event => {
      this.editor.pageSelectedId = null;
      const selection = this.editor.state.selection;
      if (event.shiftKey && this.lastClicked) {
        const a = this.flat.indexOf(this.lastClicked), b = this.flat.indexOf(id);
        if (a >= 0 && b >= 0) selection.addMany(this.flat.slice(Math.min(a, b), Math.max(a, b) + 1)); else selection.addMany([id]);
      } else if (event.ctrlKey || event.metaKey) selection.toggle(id); else selection.replace([id]);
      this.lastClicked = id;
      this.editor.renderAll({ canvas: false, history: false });
    };
    row.querySelector('.layer-main').ondblclick = () => { const name = prompt('图层名称', node.name); if (name) this.editor.exec(new UpdateNodesCommand([id], { name }, page.id, '重命名图层')); };
    row.ondragstart = event => { if (tree.isEffectivelyLocked(id)) return event.preventDefault(); this.editor.treeDragId = id; event.dataTransfer?.setData('text/plain', id); };
    row.ondragover = event => { event.preventDefault(); row.classList.add('drag-over'); };
    row.ondragleave = () => row.classList.remove('drag-over');
    row.ondrop = event => {
      event.preventDefault(); row.classList.remove('drag-over');
      const source = this.editor.treeDragId || event.dataTransfer?.getData('text/plain');
      if (!source || source === id) return;
      const rect = row.getBoundingClientRect(), depth = Number(getComputedStyle(row).getPropertyValue('--depth')) || 1;
      const into = event.clientX > rect.left + 80 + depth * 8;
      if (into) this.editor.exec(new ReparentCommand([source], id, null, page.id));
      else {
        const siblings = tree.childrenOf(node.parentId);
        const index = siblings.findIndex(item => item.id === id) + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
        this.editor.exec(new ReparentCommand([source], node.parentId, index, page.id));
      }
    };
  }
}

export { PageDock };
