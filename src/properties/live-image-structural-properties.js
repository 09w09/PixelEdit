function installLiveImageStructuralPropertiesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Properties = PE?.ui?.Properties;
  const live = PE?.liveProperties;
  const C = PE?.commands;
  const M = PE?.model;
  if (!Properties || !live?.bindNumber || !live?.bindSelect || !C?.UpdateNodesCommand || !M?.nodeById) {
    throw new Error('PixelEditor live image/structural property dependencies are not initialized');
  }
  if (PE.liveImageStructuralPropertiesInstalled) return;
  PE.liveImageStructuralPropertiesInstalled = true;

  const nodeById = (editor, id) => M.nodeById(editor.activePage(), id);

  function claim(properties, id) {
    const existing = properties.el?.querySelector?.(`#${id}`);
    if (!existing || existing.disabled) return null;
    return live.cloneControl(existing);
  }

  function bindImageProperties(properties, node) {
    const editor = properties.editor;
    const pageId = editor.activePage().id;
    const id = node.id;
    const current = () => nodeById(editor, id);
    const update = (key, value, label = '图片属性') => new C.UpdateNodesCommand(
      [id],
      item => ({ image: { ...(item.image || {}), [key]: value } }),
      pageId,
      label,
      { historyChannel: `image.${key}` },
    );
    const preview = () => {
      const latest = current();
      if (latest) properties.renderPreviews?.([latest]);
    };

    for (const [controlId, key] of [
      ['propImageFit', 'fit'],
      ['propInterpolation', 'interpolation'],
    ]) {
      const control = claim(properties, controlId);
      if (!control) continue;
      live.bindSelect(control, {
        editor,
        createCommand: value => update(key, value),
        refresh: { canvas: true, overlay: key === 'fit' },
        afterPreview: preview,
      });
    }

    for (const [controlId, key, min, max] of [
      ['propCropX', 'cropX', 0, Math.max(0, node.sourceWidth - 1)],
      ['propCropY', 'cropY', 0, Math.max(0, node.sourceHeight - 1)],
      ['propCropW', 'cropW', 1, Math.max(1, node.sourceWidth)],
      ['propCropH', 'cropH', 1, Math.max(1, node.sourceHeight)],
      ['propThreshold', 'threshold', 0, 255],
    ]) {
      const control = claim(properties, controlId);
      if (!control) continue;
      live.bindNumber(control, {
        editor,
        channel: `image.${key}`,
        min,
        max,
        createCommand: value => update(key, value),
        readModel: () => current()?.image?.[key],
        refresh: { canvas: true },
        afterPreview: preview,
      });
    }

    const bwMode = claim(properties, 'propBwMode');
    if (bwMode) live.bindSelect(bwMode, {
      editor,
      createCommand: value => update('bwMode', value),
      refresh: { canvas: true },
      structural: true,
      afterPreview: preview,
    });

    const algorithm = claim(properties, 'propImageDitherAlgorithm');
    if (algorithm) live.bindSelect(algorithm, {
      editor,
      createCommand: value => update('ditherAlgorithm', value),
      refresh: { canvas: true },
      structural: true,
      afterPreview: preview,
    });

    const matrix = claim(properties, 'propImageBayerMatrix');
    if (matrix) live.bindSelect(matrix, {
      editor,
      createCommand: value => update('bayerMatrix', Number(value)),
      refresh: { canvas: true },
      afterPreview: preview,
    });

    const invert = claim(properties, 'propImageInvert');
    if (invert) live.bindCheckbox(invert, {
      editor,
      createCommand: value => update('invert', value, '图片反相'),
      refresh: { canvas: true },
      afterPreview: preview,
    });
  }

  function pointFieldMarkup(index, point) {
    const x = Math.round(Number(point?.x) || 0);
    const y = Math.round(Number(point?.y) || 0);
    return `<div class="point-row"><span>P${index + 1}</span>`
      + `<div class="field"><label for="propPoint${index}X">X</label><input id="propPoint${index}X" type="number" value="${x}" step="1"></div>`
      + `<div class="field"><label for="propPoint${index}Y">Y</label><input id="propPoint${index}Y" type="number" value="${y}" step="1"></div>`
      + '</div>';
  }

  function resizedPoints(points, count) {
    const result = (points || []).map(point => ({ ...point }));
    while (result.length < count) {
      const last = result.at(-1) || { x: 0, y: 0 };
      const previous = result.at(-2) || last;
      result.push({
        x: last.x + (last.x - previous.x || 10),
        y: last.y + (last.y - previous.y),
      });
    }
    while (result.length > count) result.pop();
    return result;
  }

  function bindPointCoordinates(properties, polygonId) {
    const editor = properties.editor;
    const pageId = editor.activePage().id;
    const current = () => nodeById(editor, polygonId);
    const polygon = current();
    if (!polygon?.points) return;

    polygon.points.forEach((_, index) => {
      for (const [suffix, key] of [['X', 'x'], ['Y', 'y']]) {
        const controlId = `propPoint${index}${suffix}`;
        const existing = properties.el?.querySelector?.(`#${controlId}`);
        if (!existing || existing.disabled) continue;
        const control = live.cloneControl(existing);
        live.bindNumber(control, {
          editor,
          channel: `points.${index}.${key}`,
          createCommand: value => new C.UpdateNodesCommand(
            [polygonId],
            item => {
              const points = (item.points || []).map(point => ({ ...point }));
              if (!points[index]) return {};
              points[index][key] = value;
              return { points };
            },
            pageId,
            '修改顶点',
            { historyChannel: `points.${index}.${key}` },
          ),
          readModel: () => current()?.points?.[index]?.[key],
          refresh: { canvas: true, overlay: true },
        });
      }
    });
  }

  function bindPolygonStructure(properties, polygon) {
    const editor = properties.editor;
    const pageId = editor.activePage().id;
    const id = polygon.id;
    const current = () => nodeById(editor, id);

    const syncPointList = () => {
      const latest = current();
      const list = properties.el?.querySelector?.('#polygonPointList');
      if (!latest || !list) return;
      list.innerHTML = latest.points.map((point, index) => pointFieldMarkup(index, point)).join('');
      bindPointCoordinates(properties, id);
    };

    const count = claim(properties, 'propPointCount');
    if (count) live.bindNumber(count, {
      editor,
      channel: 'points.count',
      min: 3,
      max: 24,
      createCommand: value => new C.UpdateNodesCommand(
        [id],
        item => ({ points: resizedPoints(item.points, value) }),
        pageId,
        '顶点数量',
        { historyChannel: 'points.count' },
      ),
      readModel: () => current()?.points?.length,
      refresh: { canvas: true, overlay: true },
      afterPreview: syncPointList,
    });

    bindPointCoordinates(properties, id);
  }

  function rebind(properties) {
    const editor = properties.editor;
    const page = editor.activePage();
    if (editor.pageSelectedId === page.id) return;
    const ids = [...editor.state.selection.ids];
    const nodes = ids.map(id => M.nodeById(page, id)).filter(Boolean);
    if (nodes.length !== 1) return;
    if (nodes[0].type === 'image') bindImageProperties(properties, nodes[0]);
    if (nodes[0].type === 'polygon') bindPolygonStructure(properties, nodes[0]);
  }

  const originalRender = Properties.prototype.render;
  Properties.prototype.render = function renderWithLiveImageStructuralProperties(...args) {
    const result = originalRender.apply(this, args);
    rebind(this);
    return result;
  };

  PE.liveImageStructuralProperties = {
    resizedPoints,
    rebind,
  };
}

export { installLiveImageStructuralPropertiesRuntime };
