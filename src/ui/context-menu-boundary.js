function elementForTarget(target) {
  if (!target) return null;
  if (target.nodeType === 1) return target;
  return target.parentElement || null;
}

function classifyContextRegion(target) {
  const element = elementForTarget(target);
  if (!element?.closest) return 'none';
  if (element.closest('.layer-row[data-node-id]')) return 'layers';
  if (element.closest('#screenCanvas, #stage')) return 'canvas';
  return 'none';
}

function installNativeContextMenuBoundary(editor, documentRef = globalThis.document) {
  if (!editor || !documentRef?.addEventListener) return () => {};
  const handler = event => {
    event.preventDefault();
    const region = classifyContextRegion(event.target);
    if (region === 'layers') {
      const row = elementForTarget(event.target)?.closest?.('.layer-row[data-node-id]');
      return editor.openContextMenu({ source: 'layers', nodeId: row?.dataset?.nodeId || null, event });
    }
    if (region === 'canvas') return editor.onContextMenu(event);
    editor.closeContextMenu?.();
    return false;
  };
  documentRef.addEventListener('contextmenu', handler);
  return () => documentRef.removeEventListener('contextmenu', handler);
}

function installContextMenuBoundaryRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.ui?.Workspace) throw new Error('PixelEditor context-menu boundary dependencies are not initialized');
  if (PE.contextMenuBoundaryInstalled) return;
  PE.contextMenuBoundaryInstalled = true;
  PE.contextMenuBoundary = { classifyContextRegion, installNativeContextMenuBoundary };
}

export { classifyContextRegion, installNativeContextMenuBoundary, installContextMenuBoundaryRuntime };
