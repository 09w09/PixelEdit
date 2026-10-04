function installLivePositionPropertiesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Properties = PE?.ui?.Properties;
  const live = PE?.liveProperties;
  const M = PE?.model;
  const C = PE?.commands;
  const R = PE?.renderer;
  if (!Properties || !live?.bindNumber || !M?.TreeModel || !C?.moveNodeTree || !R?.FramebufferRenderer) {
    throw new Error('PixelEditor live position property dependencies are not initialized');
  }
  if (PE.livePositionPropertiesInstalled) return;
  PE.livePositionPropertiesInstalled = true;

  function createAxisCommand(editor, pageId, roots, axis, targetValue) {
    return {
      label: '设置位置',
      mergeDescriptor: { operation: 'property', targets: roots, channel: axis },
      execute: state => {
        const page = M.pageById(state.project, pageId);
        if (!page) return false;
        const tree = new M.TreeModel(page);
        let changed = false;
        for (const id of roots) {
          if (tree.isEffectivelyLocked(id)) continue;
          const bounds = R.FramebufferRenderer.visualBounds(id, {
            project: state.project,
            pageId: page.id,
            assets: state.assets,
          });
          const delta = Math.round(targetValue - bounds[axis]);
          if (!delta) continue;
          C.moveNodeTree(page, id, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0, tree);
          changed = true;
        }
        return changed;
      },
    };
  }

  function rebindPositionControls(properties) {
    const editor = properties.editor;
    const page = editor.activePage();
    const ids = editor.state.selection.ids;
    if (!ids.length || editor.pageSelectedId === page.id) return;
    const tree = new M.TreeModel(page);
    const roots = editor.state.selection.transformRoots(tree);
    if (!roots.length) return;

    for (const axis of ['x', 'y']) {
      const existing = properties.el?.querySelector?.(`#prop${axis.toUpperCase()}`);
      if (!existing || existing.disabled) continue;
      const control = live.cloneControl(existing);
      live.bindNumber(control, {
        editor,
        channel: axis,
        createCommand: value => createAxisCommand(editor, page.id, roots, axis, value),
        readModel: () => live.selectionBounds(editor)?.[axis],
        refresh: { canvas: true, overlay: true },
      });
    }
  }

  const originalRender = Properties.prototype.render;
  Properties.prototype.render = function renderWithStablePositionTargets(...args) {
    const result = originalRender.apply(this, args);
    rebindPositionControls(this);
    return result;
  };

  PE.livePositionProperties = { createAxisCommand, rebindPositionControls };
}

export { installLivePositionPropertiesRuntime };
