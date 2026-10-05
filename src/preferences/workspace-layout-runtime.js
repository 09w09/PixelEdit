import {
  loadEditorPreferences,
  saveEditorPreferences,
  updateEditorPreferences,
} from './editor-preferences.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function installWorkspaceLayoutRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.ui?.Workspace) throw new Error('PixelEditor workspace is not initialized');

  PE.workspaceCapabilities = PE.workspaceCapabilities || {};
  PE.workspaceCapabilities.updateWorkspaceLayout = function updateWorkspaceLayout(editor, patch = {}) {
    editor.editorPreferences = updateEditorPreferences(editor.editorPreferences, { workspace: patch });
    saveEditorPreferences(editor.editorPreferences);
    editor.applyLayout();
    editor.renderRulers?.();
    return structuredClone(editor.editorPreferences.workspace);
  };

  PE.workspaceCapabilities.applyLayout = function applyLayout(editor) {
    if (!editor.editorPreferences) editor.editorPreferences = loadEditorPreferences();
    const layout = editor.editorPreferences.workspace;
    target.document?.documentElement?.style?.setProperty('--left-w', `${layout.leftWidth}px`);
    target.document?.documentElement?.style?.setProperty('--right-w', `${layout.rightWidth}px`);
    const leftTop = target.document?.querySelector?.('#leftTopPane');
    const leftBottom = target.document?.querySelector?.('#leftBottomPane');
    const rightTop = target.document?.querySelector?.('#rightTopPane');
    const rightBottom = target.document?.querySelector?.('#rightBottomPane');
    if (leftTop) leftTop.style.flex = `${layout.leftSplit} 1 0`;
    if (leftBottom) leftBottom.style.flex = `${1 - layout.leftSplit} 1 0`;
    if (rightTop) rightTop.style.flex = `${layout.rightSplit} 1 0`;
    if (rightBottom) rightBottom.style.flex = `${1 - layout.rightSplit} 1 0`;
  };

  PE.workspaceCapabilities.setupDockSplitters = function setupDockSplitters(editor) {
    const width = (selector, key, direction) => {
      const element = target.document?.querySelector?.(selector);
      if (!element) return;
      let active = false;
      let startX = 0;
      let start = 0;
      element.onpointerdown = event => {
        active = true;
        startX = event.clientX;
        start = editor.editorPreferences.workspace[key];
        element.setPointerCapture?.(event.pointerId);
      };
      element.onpointermove = event => {
        if (!active) return;
        editor.updateWorkspaceLayout({ [key]: start + (event.clientX - startX) * direction });
      };
      element.onpointerup = () => { active = false; };
      element.onpointercancel = () => { active = false; };
    };
    width('#leftWidthSplitter', 'leftWidth', 1);
    width('#rightWidthSplitter', 'rightWidth', -1);

    const split = (selector, key, containerSelector) => {
      const element = target.document?.querySelector?.(selector);
      const container = target.document?.querySelector?.(containerSelector);
      if (!element || !container) return;
      let active = false;
      element.onpointerdown = event => {
        active = true;
        element.setPointerCapture?.(event.pointerId);
      };
      element.onpointermove = event => {
        if (!active) return;
        const rect = container.getBoundingClientRect();
        const min = Math.min(0.45, 120 / Math.max(1, rect.height));
        const value = clamp((event.clientY - rect.top) / Math.max(1, rect.height), min, 1 - min);
        editor.updateWorkspaceLayout({ [key]: value });
      };
      element.onpointerup = () => { active = false; };
      element.onpointercancel = () => { active = false; };
    };
    split('#leftPaneSplitter', 'leftSplit', '#leftSidebar');
    split('#rightPaneSplitter', 'rightSplit', '#rightSidebar');
  };
}

export { installWorkspaceLayoutRuntime };
