function installLiveTextPropertiesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Properties = PE?.ui?.Properties;
  const live = PE?.liveProperties;
  const C = PE?.commands;
  const M = PE?.model;
  const normalizeFill = PE?.schemaV17?.normalizeFill;
  if (!Properties || !live?.bindNumber || !live?.bindTextarea || !C?.UpdateNodesCommand || !M?.nodeById) {
    throw new Error('PixelEditor live text property dependencies are not initialized');
  }
  if (PE.liveTextPropertiesInstalled) return;
  PE.liveTextPropertiesInstalled = true;

  function rebindTextProperties(properties) {
    const editor = properties.editor;
    const page = editor.activePage();
    const ids = [...editor.state.selection.ids];
    if (!ids.length || editor.pageSelectedId === page.id) return;
    const nodes = ids.map(id => M.nodeById(page, id)).filter(Boolean);
    if (!nodes.length || !nodes.every(node => node.type === 'text')) return;

    const currentNodes = () => ids.map(id => M.nodeById(editor.activePage(), id)).filter(Boolean);
    const claim = id => {
      const existing = properties.el?.querySelector?.(`#${id}`);
      if (!existing || existing.disabled) return null;
      return live.cloneControl(existing);
    };
    const update = (patch, label, channel) => new C.UpdateNodesCommand(
      ids,
      patch,
      page.id,
      label,
      { historyChannel: channel },
    );
    const preview = () => properties.renderPreviews?.(currentNodes());

    const text = claim('propText');
    if (text) live.bindTextarea(text, {
      editor,
      channel: 'text',
      createCommand: value => update({ text: value }, '文字', 'text'),
      refresh: { canvas: true, overlay: true },
    });

    const font = claim('propFont');
    if (font) live.bindSelect(font, {
      editor,
      structural: true,
      createCommand: value => {
        const record = (editor.state.project.fonts || []).find(item => item.family === value);
        return update(node => ({
          fontFamily: value,
          fixedFontSize: record?.fixedSize || null,
          fontSize: record?.fixedSize || node.fontSize,
        }), '字体', 'fontFamily');
      },
      refresh: { canvas: true, overlay: true },
    });

    for (const [id, key, min, max] of [
      ['propFontSize', 'fontSize', 1, 200],
      ['propLetterSpacing', 'letterSpacing', -20, 100],
      ['propLineSpacing', 'lineSpacing', -20, 200],
    ]) {
      const control = claim(id);
      if (!control) continue;
      live.bindNumber(control, {
        editor,
        channel: key,
        min,
        max,
        createCommand: value => update({ [key]: value }, '文字排版', key),
        readModel: () => currentNodes()[0]?.[key],
        refresh: { canvas: true, overlay: true },
      });
    }

    for (const [id, key] of [['propAlignH', 'alignH'], ['propAlignV', 'alignV']]) {
      const control = claim(id);
      if (!control) continue;
      live.bindSelect(control, {
        editor,
        createCommand: value => update({ [key]: value }, '文字排版', key),
        refresh: { canvas: true },
      });
    }

    for (const [id, key] of [['propWrap', 'wrap'], ['propBold', 'bold'], ['propInvert', 'invert']]) {
      const control = claim(id);
      if (!control) continue;
      live.bindCheckbox(control, {
        editor,
        createCommand: value => update({ [key]: value }, '文字排版', key),
        refresh: { canvas: true, overlay: key === 'wrap' },
      });
    }

    const fill = claim('propFill');
    if (fill) live.bindSelect(fill, {
      editor,
      structural: true,
      createCommand: mode => update(node => ({
        fill: normalizeFill
          ? normalizeFill({ ...normalizeFill(node.fill), mode })
          : { ...(node.fill || {}), mode },
      }), '填充', 'fill.mode'),
      refresh: { canvas: true },
    });

    const ditherCommand = (key, value) => update(node => ({
      dither: { ...(node.dither || M.defaultDither()), [key]: value },
    }), '修改抖动', `dither.${key}`);
    for (const [id, key, min, max] of [
      ['propDitherDensity', 'density', 0, 100],
      ['propDitherOffsetX', 'offsetX', -Infinity, Infinity],
      ['propDitherOffsetY', 'offsetY', -Infinity, Infinity],
    ]) {
      const control = claim(id);
      if (!control) continue;
      live.bindNumber(control, {
        editor,
        channel: `dither.${key}`,
        min,
        max,
        createCommand: value => ditherCommand(key, value),
        readModel: () => currentNodes()[0]?.dither?.[key],
        refresh: { canvas: true },
        afterPreview: preview,
      });
    }
    for (const [id, key, parse] of [
      ['propDitherType', 'type', value => value],
      ['propDitherMatrix', 'matrix', value => Number(value)],
      ['propDitherAlign', 'align', value => value],
    ]) {
      const control = claim(id);
      if (!control) continue;
      live.bindSelect(control, {
        editor,
        createCommand: raw => ditherCommand(key, parse(raw)),
        refresh: { canvas: true },
        afterPreview: preview,
      });
    }

    const patternCommand = (key, value) => update(node => ({
      pattern: { ...(node.pattern || M.defaultPattern()), [key]: value },
    }), '修改图案', `pattern.${key}`);
    for (const [id, key, min, max] of [
      ['propPatternLineWidth', 'lineWidth', 1, 16],
      ['propPatternGap', 'gap', 0, 32],
      ['propPatternOffsetX', 'offsetX', -Infinity, Infinity],
      ['propPatternOffsetY', 'offsetY', -Infinity, Infinity],
    ]) {
      const control = claim(id);
      if (!control) continue;
      live.bindNumber(control, {
        editor,
        channel: `pattern.${key}`,
        min,
        max,
        createCommand: value => patternCommand(key, value),
        readModel: () => currentNodes()[0]?.pattern?.[key],
        refresh: { canvas: true },
        afterPreview: preview,
      });
    }
    for (const [id, key] of [['propPatternType', 'type'], ['propPatternAlign', 'align']]) {
      const control = claim(id);
      if (!control) continue;
      live.bindSelect(control, {
        editor,
        createCommand: value => patternCommand(key, value),
        refresh: { canvas: true },
        afterPreview: preview,
      });
    }
  }

  const originalRender = Properties.prototype.render;
  Properties.prototype.render = function renderWithLiveTextProperties(...args) {
    const result = originalRender.apply(this, args);
    rebindTextProperties(this);
    return result;
  };

  PE.liveTextProperties = { rebindTextProperties };
}

export { installLiveTextPropertiesRuntime };
