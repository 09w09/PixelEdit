import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

const STYLES = ['solid', 'short-dash', 'long-dash', 'dot', 'dash-dot'];

for (const style of STYLES) {
  for (const width of [1, 3]) {
    for (const color of [0, 1]) {
      test(`line renders ${style} width ${width} color ${color}`, async ({ page }) => {
        await openEditor(page);
        const result = await page.evaluate(({ style, width, color }) => {
          const editor = window.PixelEditorTest.editor;
          const M = window.PixelEditorDebug.services.model;
          const R = window.PixelEditorDebug.services.renderer;
          editor.newProject({ force: true });
          const p = editor.activePage();
          p.fill = { mode: 'solid', color: color ? 0 : 1 };
          const node = M.createNode('line', {
            parentId: p.id,
            x1: 20, y1: 20, x2: 80, y2: 20,
            stroke: { width, color, style },
          });
          p.nodes.push(node);
          const pixels = window.PixelEditorDebug.services.strokeStyle.styledStrokePixels(node, R, window.PixelEditorDebug.services.pixelStroke);
          const framebuffer = R.FramebufferRenderer.renderPage(editor.state.project, p.id, editor.state.assets);
          const first = pixels[0];
          return {
            count: pixels.length,
            pixel: first ? framebuffer[first.y * 400 + first.x] : null,
            stroke: structuredClone(node.stroke),
            hasLegacyLineWidth: Object.hasOwn(node, 'lineWidth'),
          };
        }, { style, width, color });

        expect(result.count).toBeGreaterThan(0);
        expect(result.pixel).toBe(color);
        expect(result.stroke).toEqual({ width, color, style });
        expect(result.hasLegacyLineWidth).toBe(false);
      });
    }
  }
}

for (const type of ['rectangle', 'circle', 'polygon']) {
  test(`${type} transparent and solid black/white fills use fill.color`, async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(type => {
      const editor = window.PixelEditorTest.editor;
      const M = window.PixelEditorDebug.services.model;
      const R = window.PixelEditorDebug.services.renderer.FramebufferRenderer;
      const geometry = type === 'polygon'
        ? { points: [{ x: 40, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 80 }, { x: 40, y: 80 }] }
        : { x: 40, y: 40, w: 41, h: 41 };
      const sample = { x: 60, y: 60 };

      const render = (pageColor, fill) => {
        editor.newProject({ force: true });
        const p = editor.activePage();
        p.fill = { mode: 'solid', color: pageColor };
        p.nodes.push(M.createNode(type, {
          parentId: p.id,
          ...geometry,
          stroke: { width: 1, color: pageColor, style: 'solid' },
          fill,
        }));
        const fb = R.renderPage(editor.state.project, p.id, editor.state.assets);
        return fb[sample.y * 400 + sample.x];
      };

      return {
        transparentOnWhite: render(0, { mode: 'transparent', color: 1 }),
        transparentOnBlack: render(1, { mode: 'transparent', color: 0 }),
        blackOnWhite: render(0, { mode: 'solid', color: 1 }),
        whiteOnBlack: render(1, { mode: 'solid', color: 0 }),
      };
    }, type);

    expect(result).toEqual({
      transparentOnWhite: 0,
      transparentOnBlack: 1,
      blackOnWhite: 1,
      whiteOnBlack: 0,
    });
  });
}
