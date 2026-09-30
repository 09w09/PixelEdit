function isImportedFamily(project, family) {
  return Boolean((project?.fonts || []).some(record => record.family === family));
}

class FontManager {
  constructor({ editor, document: documentRef = globalThis.document }) {
    this.editor = editor;
    this.document = documentRef;
  }

  cachedFace(record) {
    if (!record) return null;
    const key = `${record.assetId}:${record.family}`;
    return this.editor.fontFaceCache?.get(key) || null;
  }

  register(record) {
    const cached = this.cachedFace(record);
    if (cached) {
      try { this.document?.fonts?.add?.(cached); } catch {}
      return Promise.resolve(cached);
    }
    return Promise.resolve(this.editor.registerFont(record)).catch(() => null);
  }

  unregister(record) {
    const face = this.cachedFace(record);
    if (!face) return false;
    try { return Boolean(this.document?.fonts?.delete?.(face)); } catch { return false; }
  }

  sync(records = []) {
    const desired = new Map((records || []).map(record => [record.family, record]));
    for (const [key, face] of this.editor.fontFaceCache || []) {
      const family = key.slice(key.indexOf(':') + 1);
      if (!desired.has(family)) {
        try { this.document?.fonts?.delete?.(face); } catch {}
      }
    }
    for (const record of desired.values()) {
      const cached = this.cachedFace(record);
      if (cached) {
        try { this.document?.fonts?.add?.(cached); } catch {}
      } else {
        this.register(record).catch(() => {});
      }
    }
  }
}

function installFontManagerRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const M = PE?.model;
  const C = PE?.commands;
  const Workspace = PE?.ui?.Workspace;
  const Properties = PE?.ui?.Properties;
  if (!M || !C || !Workspace) throw new Error('PixelEditor is not initialized');
  if (PE.fontManagerInstalled) return;
  PE.fontManagerInstalled = true;

  class RemoveImportedFontCommand {
    constructor(family) {
      this.family = family;
      this.label = '移除字体';
    }

    execute(state) {
      const fonts = state.project.fonts || [];
      const record = fonts.find(item => item.family === this.family);
      if (!record) return false;
      for (const page of state.project.pages || []) {
        for (const node of page.nodes || []) {
          if (node.type !== 'text' || node.fontFamily !== this.family) continue;
          const effectiveSize = Math.max(1, Math.round(Number(node.fixedFontSize ?? node.fontSize ?? 16) || 16));
          node.fontFamily = 'sans-serif';
          node.fontSize = effectiveSize;
          node.fixedFontSize = null;
        }
      }
      state.project.fonts = fonts.filter(item => item.family !== this.family);
      return true;
    }
  }
  C.RemoveImportedFontCommand = RemoveImportedFontCommand;

  const originalMount = Workspace.prototype.mount;
  Workspace.prototype.mount = function mount() {
    if (!this.fontManager) this.fontManager = new FontManager({ editor: this, document: target.document });
    return originalMount.call(this);
  };

  const originalRenderAll = Workspace.prototype.renderAll;
  Workspace.prototype.renderAll = function renderAll(options = {}) {
    this.fontManager?.sync(this.state.project.fonts || []);
    return originalRenderAll.call(this, options);
  };

  Workspace.prototype.removeImportedFont = function removeImportedFont(family) {
    const record = (this.state.project.fonts || []).find(item => item.family === family);
    if (!record) return false;
    const ok = this.exec(new RemoveImportedFontCommand(family));
    if (ok) {
      PE.textToolOptions?.fallbackRemovedFamily?.(this, family);
      this.fontManager?.unregister(record);
      this.fontManager?.sync(this.state.project.fonts || []);
      this.properties?.render();
      this.toolOptionsBar?.render?.();
    }
    return ok;
  };

  if (Properties) {
    const originalBind = Properties.prototype.bind;
    Properties.prototype.bind = function bind(nodes, locked) {
      const result = originalBind.call(this, nodes, locked);
      const button = this.el.querySelector('#removeFontBtn');
      if (button && !button.disabled && nodes[0]?.type === 'text') {
        const family = nodes[0].fontFamily;
        button.onclick = () => this.editor.removeImportedFont(family);
      }
      return result;
    };
  }

  PE.fonts = { FontManager, isImportedFamily, RemoveImportedFontCommand };
}

export { FontManager, isImportedFamily, installFontManagerRuntime };
