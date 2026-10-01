import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function seedShape(page, type, props = {}) {
  return page.evaluate(({ type, props }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const geometry = type === 'line'
      ? { x1: 20, y1: 20, x2: 60, y2: 20 }
      : type === 'polygon'
        ? { points: [{ x: 20, y: 50 }, { x: 40, y: 20 }, { x: 60, y: 50 }] }
        : { x: 20, y: 20, w: 40, h: 30 };
    const node = M.createNode(type, {
      parentId: active.id,
      ...geometry,
      stroke: { width: 2, color: 1, style: 'short-dash' },
      ...(type === 'line' ? {} : { fill: { mode: 'transparent', color: 1 } }),
      ...props,
    });
    editor.exec(new C.AddNodesCommand([node], active.id));
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    return node.id;
  }, { type, props });
}

function sectionSnapshotScript() {
  return [...document.querySelectorAll('#properties .property-section')].map(section => ({
    title: section.querySelector(':scope > h4')?.textContent?.trim() || '',
    ids: [...section.querySelectorAll('[id]')].map(element => element.id),
    text: section.textContent.replace(/\s+/g, ' ').trim(),
  }));
}

test('line keeps geometry separate from one canonical stroke section', async ({ page }) => {
  await openEditor(page);
  await seedShape(page, 'line');
  const result = await page.evaluate(sectionSnapshotScript);

  const geometry = result.find(section => section.title === '直线');
  const strokeSections = result.filter(section => section.title === '描边');
  expect(geometry).toBeTruthy();
  expect(geometry.ids).toEqual(expect.arrayContaining(['propX1', 'propY1', 'propX2', 'propY2']));
  expect(geometry.ids).not.toContain('propStrokeWidth');
  expect(geometry.ids).not.toContain('propLineWidth');
  expect(strokeSections).toHaveLength(1);
  expect(strokeSections[0].ids).toEqual(expect.arrayContaining(['propStrokeWidth', 'propStrokeColor', 'propStrokeStyle']));
  expect(result.filter(section => section.title === '填充')).toHaveLength(0);
});

for (const type of ['rectangle', 'circle', 'polygon']) {
  test(`${type} has one stroke section and one canonical fill section`, async ({ page }) => {
    await openEditor(page);
    await seedShape(page, type);
    const result = await page.evaluate(() => ({
      sections: [...document.querySelectorAll('#properties .property-section')].map(section => ({
        title: section.querySelector(':scope > h4')?.textContent?.trim() || '',
        ids: [...section.querySelectorAll('[id]')].map(element => element.id),
      })),
      fillMode: document.querySelector('#propFill')?.value,
      fillColor: document.querySelector('#propFillColor')?.value,
      fillColorDisabled: document.querySelector('#propFillColor')?.disabled,
      fillOptions: [...(document.querySelector('#propFill')?.options || [])].map(option => option.value),
    }));

    const strokeSections = result.sections.filter(section => section.title === '描边');
    const fillSections = result.sections.filter(section => section.title === '填充');
    expect(strokeSections).toHaveLength(1);
    expect(strokeSections[0].ids).toEqual(expect.arrayContaining(['propStrokeWidth', 'propStrokeColor', 'propStrokeStyle']));
    expect(fillSections).toHaveLength(1);
    expect(fillSections[0].ids).toEqual(expect.arrayContaining(['propFill', 'propFillColor']));
    expect(result.fillOptions).toEqual(['transparent', 'solid', 'dither', 'pattern']);
    expect(result.fillMode).toBe('transparent');
    expect(result.fillColor).toBe('1');
    expect(result.fillColorDisabled).toBe(true);
    const geometrySections = result.sections.filter(section => !['描边', '填充'].includes(section.title));
    for (const section of geometrySections) {
      expect(section.ids).not.toContain('propStrokeWidth');
      expect(section.ids).not.toContain('propLineWidth');
    }
  });
}

test('stroke and solid fill controls write canonical fields with semantic history channels', async ({ page }) => {
  await openEditor(page);
  const id = await seedShape(page, 'rectangle');
  const result = await page.evaluate(nodeId => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const before = editor.bus.cursor;

    const change = (selector, value) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      element.value = String(value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    change('#propStrokeWidth', 4);
    const afterWidth1 = editor.bus.cursor;
    change('#propStrokeWidth', 6);
    const afterWidth2 = editor.bus.cursor;
    change('#propStrokeColor', 0);
    change('#propStrokeStyle', 'dash-dot');
    change('#propFill', 'solid');
    const fillColor = document.querySelector('#propFillColor');
    const solidColorEnabled = fillColor ? !fillColor.disabled : false;
    change('#propFillColor', 0);

    const node = M.nodeById(editor.activePage(), nodeId);
    return {
      before,
      afterWidth1,
      afterWidth2,
      stroke: structuredClone(node.stroke),
      fill: structuredClone(node.fill),
      solidColorEnabled,
      hasLegacyLineWidth: Object.hasOwn(node, 'lineWidth'),
      descriptors: editor.bus.entries.slice(before + 1).map(entry => entry.mergeDescriptor || null),
    };
  }, id);

  expect(result.afterWidth1 - result.before).toBe(1);
  expect(result.afterWidth2).toBe(result.afterWidth1);
  expect(result.stroke).toEqual({ width: 6, color: 0, style: 'dash-dot' });
  expect(result.fill).toEqual({ mode: 'solid', color: 0 });
  expect(result.solidColorEnabled).toBe(true);
  expect(result.hasLegacyLineWidth).toBe(false);
  expect(result.descriptors).toEqual(expect.arrayContaining([
    { operation: 'property', targets: [id], channel: 'stroke.width' },
    { operation: 'property', targets: [id], channel: 'stroke.color' },
    { operation: 'property', targets: [id], channel: 'stroke.style' },
    { operation: 'property', targets: [id], channel: 'fill.mode' },
    { operation: 'property', targets: [id], channel: 'fill.color' },
  ]));
});

test('dither and pattern modes keep their rendering independent from fill.color', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const R = window.PixelEditor.renderer.FramebufferRenderer;

    const render = (mode, color) => {
      editor.newProject({ force: true });
      const p = editor.activePage();
      const node = M.createNode('rectangle', {
        parentId: p.id,
        x: 30, y: 30, w: 40, h: 30,
        stroke: { width: 1, color: 1, style: 'solid' },
        fill: { mode, color },
        dither: { type: 'bayer', density: 45, matrix: 4, align: 'object', offsetX: 0, offsetY: 0 },
        pattern: { type: 'checkerboard', lineWidth: 1, gap: 1, align: 'object', offsetX: 0, offsetY: 0 },
      });
      p.nodes.push(node);
      return Array.from(R.renderPage(editor.state.project, p.id, editor.state.assets).slice(0));
    };

    return {
      dither0: render('dither', 0),
      dither1: render('dither', 1),
      pattern0: render('pattern', 0),
      pattern1: render('pattern', 1),
    };
  });

  expect(result.dither0).toEqual(result.dither1);
  expect(result.pattern0).toEqual(result.pattern1);
});
