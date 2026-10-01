import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

const shapeTypes = ['line', 'rectangle', 'circle', 'polygon'];

function geometryFor(type) {
  if (type === 'line') return { x1: 20, y1: 20, x2: 60, y2: 20 };
  if (type === 'polygon') return { points: [{ x: 20, y: 50 }, { x: 40, y: 20 }, { x: 60, y: 50 }] };
  return { x: 20, y: 20, w: 40, h: 30 };
}

test('all stroked shape models preserve zero width and transparent stroke color', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(({ shapeTypes }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const P = window.PixelEditor.persistence;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const geometry = type => {
      if (type === 'line') return { x1: 20, y1: 20, x2: 60, y2: 20 };
      if (type === 'polygon') return { points: [{ x: 20, y: 50 }, { x: 40, y: 20 }, { x: 60, y: 50 }] };
      return { x: 20, y: 20, w: 40, h: 30 };
    };
    const nodes = shapeTypes.map(type => M.createNode(type, {
      parentId: active.id,
      ...geometry(type),
      stroke: { width: 0, color: 'transparent', style: 'solid' },
      ...(type === 'line' ? {} : { fill: { mode: 'transparent', color: 1 } }),
    }));
    active.nodes.push(...nodes);
    const serialized = JSON.parse(P.ProjectSerializer.serialize(editor.state.project, editor.state.assets));
    return {
      nodes: nodes.map(node => ({ type: node.type, stroke: structuredClone(node.stroke) })),
      serialized: serialized.pages[0].nodes.map(node => ({ type: node.type, stroke: node.stroke })),
    };
  }, { shapeTypes });

  for (const item of [...result.nodes, ...result.serialized]) {
    expect(item.stroke).toEqual({ width: 0, color: 'transparent', style: 'solid' });
  }
});

test('zero width or transparent color produces no stroke pixels for every shape primitive', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(({ shapeTypes }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const R = window.PixelEditor.renderer.FramebufferRenderer;
    const geometry = type => {
      if (type === 'line') return { x1: 20, y1: 20, x2: 60, y2: 20 };
      if (type === 'polygon') return { points: [{ x: 20, y: 50 }, { x: 40, y: 20 }, { x: 60, y: 50 }] };
      return { x: 20, y: 20, w: 40, h: 30 };
    };
    const renderCount = (type, stroke) => {
      editor.newProject({ force: true });
      const active = editor.activePage();
      const node = M.createNode(type, {
        parentId: active.id,
        ...geometry(type),
        stroke,
        ...(type === 'line' ? {} : { fill: { mode: 'transparent', color: 1 } }),
      });
      active.nodes.push(node);
      return R.renderPage(editor.state.project, active.id, editor.state.assets).reduce((sum, pixel) => sum + pixel, 0);
    };
    return Object.fromEntries(shapeTypes.map(type => [type, {
      zeroWidth: renderCount(type, { width: 0, color: 1, style: 'solid' }),
      transparentColor: renderCount(type, { width: 4, color: 'transparent', style: 'dash-dot' }),
    }]));
  }, { shapeTypes });

  for (const type of shapeTypes) {
    expect(result[type]).toEqual({ zeroWidth: 0, transparentColor: 0 });
  }
});

test('element stroke properties and shape tool defaults expose zero width and transparent color', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(({ shapeTypes }) => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    const snapshots = {};

    for (const type of shapeTypes) {
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
        stroke: { width: 2, color: 1, style: 'solid' },
        ...(type === 'line' ? {} : { fill: { mode: 'transparent', color: 1 } }),
      });
      editor.exec(new C.AddNodesCommand([node], active.id));
      editor.state.selection.replace([node.id]);
      editor.pageSelectedId = null;
      editor.properties.render();

      const propWidth = document.querySelector('#propStrokeWidth');
      const propColor = document.querySelector('#propStrokeColor');
      const propertyMeta = {
        min: propWidth?.min,
        colors: [...(propColor?.options || [])].map(option => option.value),
      };
      propWidth.value = '0';
      propWidth.dispatchEvent(new Event('change', { bubbles: true }));
      const liveColor = document.querySelector('#propStrokeColor');
      liveColor.value = 'transparent';
      liveColor.dispatchEvent(new Event('change', { bubbles: true }));
      const propertyStroke = structuredClone(M.nodeById(editor.activePage(), node.id).stroke);

      editor.setTool(type);
      const toolWidth = document.querySelector('#toolOptionWidth');
      const toolColor = document.querySelector('#toolOptionColor');
      const toolMeta = {
        min: toolWidth?.min,
        colors: [...(toolColor?.options || [])].map(option => option.value),
      };
      toolWidth.value = '0';
      toolWidth.dispatchEvent(new Event('change', { bubbles: true }));
      const liveToolColor = document.querySelector('#toolOptionColor');
      liveToolColor.value = 'transparent';
      liveToolColor.dispatchEvent(new Event('change', { bubbles: true }));
      const defaults = structuredClone(editor.getToolDefaults(type));

      snapshots[type] = { propertyMeta, propertyStroke, toolMeta, defaults };
    }
    return snapshots;
  }, { shapeTypes });

  for (const type of shapeTypes) {
    expect(result[type].propertyMeta).toEqual({ min: '0', colors: ['1', '0', 'transparent'] });
    expect(result[type].propertyStroke).toEqual({ width: 0, color: 'transparent', style: 'solid' });
    expect(result[type].toolMeta).toEqual({ min: '0', colors: ['1', '0', 'transparent'] });
    expect(result[type].defaults).toMatchObject({ width: 0, color: 'transparent' });
  }
});

test('text property keeps focus across consecutive edits and coalesces them into one history entry', async ({ page }) => {
  await openEditor(page);
  const seed = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditor.model;
    const C = window.PixelEditor.commands;
    editor.newProject({ force: true });
    const active = editor.activePage();
    const node = M.createNode('text', {
      parentId: active.id,
      x: 20, y: 20, w: 120, h: 40,
      text: '', fontSize: 16,
    });
    editor.exec(new C.AddNodesCommand([node], active.id));
    editor.state.selection.replace([node.id]);
    editor.pageSelectedId = null;
    editor.properties.render();
    return { id: node.id, baseline: editor.bus.cursor };
  });

  const textarea = page.locator('#propText');
  await textarea.focus();
  await page.keyboard.type('abc');

  const afterLatin = await page.evaluate(id => {
    const editor = window.PixelEditorTest.editor;
    return {
      activeId: document.activeElement?.id || '',
      value: document.querySelector('#propText')?.value,
      text: window.PixelEditor.model.nodeById(editor.activePage(), id)?.text,
      cursor: editor.bus.cursor,
    };
  }, seed.id);

  expect(afterLatin.activeId).toBe('propText');
  expect(afterLatin.value).toBe('abc');
  expect(afterLatin.text).toBe('abc');
  expect(afterLatin.cursor - seed.baseline).toBe(1);

  await page.evaluate(() => {
    const el = document.querySelector('#propText');
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    el.value += '你';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '你', inputType: 'insertCompositionText', isComposing: true }));
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你' }));
  });

  const afterFirstComposition = await page.evaluate(() => ({
    activeId: document.activeElement?.id || '',
    value: document.querySelector('#propText')?.value,
  }));
  expect(afterFirstComposition).toEqual({ activeId: 'propText', value: 'abc你' });

  await page.evaluate(() => {
    const el = document.activeElement;
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    el.value += '好';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '好', inputType: 'insertCompositionText', isComposing: true }));
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '好' }));
  });

  const final = await page.evaluate(id => {
    const editor = window.PixelEditorTest.editor;
    return {
      activeId: document.activeElement?.id || '',
      value: document.querySelector('#propText')?.value,
      text: window.PixelEditor.model.nodeById(editor.activePage(), id)?.text,
      cursor: editor.bus.cursor,
      entries: editor.bus.entries.slice(-2).map(entry => entry.label),
    };
  }, seed.id);

  expect(final.activeId).toBe('propText');
  expect(final.value).toBe('abc你好');
  expect(final.text).toBe('abc你好');
  expect(final.cursor - seed.baseline).toBe(1);
  expect(final.entries.at(-1)).toBe('文字');
});
