import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

async function logicalToClient(page, point) {
  return page.locator('#screenCanvas').evaluate((canvas, p) => {
    const box = canvas.getBoundingClientRect();
    return {
      x: box.left + p.x * box.width / 400,
      y: box.top + p.y * box.height / 300,
    };
  }, point);
}

async function handleCenters(page) {
  return page.locator('#overlaySvg').evaluate(svg => [...svg.querySelectorAll('rect.selection-handle:not(.selection-edge-handle)')].map(el => ({
    x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
    y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
  })));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test('recorded 90 degree resize keeps the grabbed corner under the real pointer through a continuous drag', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    editor.setZoom(2);
    const p = editor.activePage();
    const node = M.createNode('rectangle', {
      parentId: p.id,
      x: 115,
      y: 94,
      w: 109,
      h: 106,
      fill: { mode: 'transparent', color: 1 },
      stroke: { width: 1, color: 1, style: 'solid' },
    });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.runSelectionTransform('rotate-cw-90');
    editor.renderAll();
  });

  const startHandles = await handleCenters(page);
  expect(startHandles).toHaveLength(4);
  const start = startHandles.reduce((best, point, index) => {
    const score = point.x + point.y;
    return !best || score < best.score ? { point, index, score } : best;
  }, null);

  const oppositeIndex = [3, 2, 1, 0][start.index];
  const fixedStart = startHandles[oppositeIndex];
  const startClient = await logicalToClient(page, start.point);
  await page.mouse.move(startClient.x, startClient.y);
  await page.mouse.down();

  const gestureCorner = await page.evaluate(() => window.PixelEditorTest.editor.customGesture?.corner);
  expect(gestureCorner).toBeTruthy();

  // Relative trajectory reconstructed from the user's recording status bar.
  // It starts at the grabbed visual top-left corner and stays inside the canvas.
  const recorded = [
    { x: 114, y: 94 },
    { x: 105, y: 88 },
    { x: 97, y: 84 },
    { x: 90, y: 83 },
    { x: 80, y: 82 },
    { x: 67, y: 101 },
    { x: 65, y: 122 },
    { x: 70, y: 120 },
    { x: 93, y: 94 },
    { x: 100, y: 73 },
    { x: 110, y: 64 },
    { x: 165, y: 44 },
    { x: 157, y: 52 },
    { x: 159, y: 65 },
  ];
  const origin = recorded[0];

  for (const sample of recorded.slice(1)) {
    const logical = {
      x: start.point.x + sample.x - origin.x,
      y: start.point.y + sample.y - origin.y,
    };
    const client = await logicalToClient(page, logical);
    await page.mouse.move(client.x, client.y);
    const handles = await handleCenters(page);
    expect(distance(handles[start.index], logical), `dragged handle drift at ${JSON.stringify(sample)}`).toBeLessThanOrEqual(1.5);
    expect(distance(handles[oppositeIndex], fixedStart), `opposite handle drift at ${JSON.stringify(sample)}`).toBeLessThanOrEqual(1.5);
  }

  await page.mouse.up();
});
