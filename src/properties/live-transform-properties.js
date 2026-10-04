function installLiveTransformPropertiesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Properties = PE?.ui?.Properties;
  const live = PE?.liveProperties;
  const C = PE?.commands;
  const M = PE?.model;
  const T = PE?.transformModel;
  const transformTypes = PE?.historyProperties?.TRANSFORM_TYPES || new Set(['rectangle', 'circle', 'line', 'polygon', 'text', 'image', 'raster']);
  if (!Properties || !live?.bindNumber || !live?.bindCheckbox || !C?.UpdateNodesCommand || !M?.nodeById || !T) {
    throw new Error('PixelEditor live transform property dependencies are not initialized');
  }
  if (PE.liveTransformPropertiesInstalled) return;
  PE.liveTransformPropertiesInstalled = true;

  function rebind(properties) {
    const editor = properties.editor;
    const page = editor.activePage();
    if (editor.pageSelectedId === page.id || editor.state.selection.ids.length !== 1) return;
    const id = editor.state.selection.ids[0];
    const node = M.nodeById(page, id);
    if (!node || !transformTypes.has(node.type)) return;
    const tree = new M.TreeModel(page);
    if (tree.isEffectivelyLocked(id)) return;
    const current = () => M.nodeById(editor.activePage(), id);
    const claim = controlId => {
      const existing = properties.el?.querySelector?.(`#${controlId}`);
      if (!existing || existing.disabled) return null;
      return live.cloneControl(existing);
    };
    const update = (patch, label, channel) => new C.UpdateNodesCommand(
      [id],
      item => ({ transform: T.normalizeTransform({ ...item.transform, ...patch }) }),
      page.id,
      label,
      { historyChannel: channel },
    );

    const rotation = claim('propRotation');
    if (rotation) live.bindNumber(rotation, {
      editor,
      channel: 'transform.rotation',
      min: -180,
      max: 180,
      createCommand: value => update({ rotation: T.normalizeRotation(value) }, '旋转元素', 'transform.rotation'),
      readModel: () => T.normalizeTransform(current()?.transform).rotation,
      refresh: { canvas: true, overlay: true },
    });

    for (const [controlId, key, label] of [
      ['propFlipX', 'flipX', '水平翻转元素'],
      ['propFlipY', 'flipY', '垂直翻转元素'],
    ]) {
      const control = claim(controlId);
      if (!control) continue;
      live.bindCheckbox(control, {
        editor,
        createCommand: value => update({ [key]: value }, label, `transform.${key}`),
        refresh: { canvas: true, overlay: true },
      });
    }
  }

  const originalRender = Properties.prototype.render;
  Properties.prototype.render = function renderWithLiveTransformProperties(...args) {
    const result = originalRender.apply(this, args);
    rebind(this);
    return result;
  };

  PE.liveTransformProperties = { rebind };
}

export { installLiveTransformPropertiesRuntime };
