import { toolRegistry } from '../tools/tool-registry.js';

function ensureRegistryTools(registry = toolRegistry) {
  if (!registry?.has?.('bucket') || document.querySelector('[data-tool="bucket"]')) return;
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

class Toolbar {
  constructor(editor, { registry = toolRegistry } = {}) {
    this.editor = editor;
    this.registry = registry;
  }
  mount() {
    ensureRegistryTools(this.registry);
    document.querySelectorAll('[data-tool]').forEach(button => { button.onclick = () => this.editor.setTool(button.dataset.tool); });
    document.querySelectorAll('[data-align]').forEach(button => { button.onclick = () => this.editor.align(button.dataset.align); });
    document.querySelectorAll('[data-distribute]').forEach(button => { button.onclick = () => this.editor.distribute(button.dataset.distribute); });
  }
}

export { Toolbar, ensureRegistryTools };
