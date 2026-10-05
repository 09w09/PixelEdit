import { expect, test } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PixelEditorTest?.editor));
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function properIntersect(a, b, c, d) {
  const ab1 = orientation(a, b, c), ab2 = orientation(a, b, d);
  const cd1 = orientation(c, d, a), cd2 = orientation(c, d, b);
  return ab1 * ab2 < -1e-9 && cd1 * cd2 < -1e-9;
}

function selfIntersects(points) {
  if (points.length !== 4) return false;
  return properIntersect(points[0], points[1], points[2], points[3]) || properIntersect(points[1], points[2], points[3], points[0]);
}

const transforms = [
  { name: 'identity', rotation: 0, flipX: false, flipY: false },
  { name: 'hflip', rotation: 0, flipX: true, flipY: false },
  { name: 'vflip', rotation: 0, flipX: false, flipY: true },
  { name: 'both', rotation: 0, flipX: true, flipY: true },
  { name: 'r90', rotation: 90, flipX: false, flipY: false },
  { name: 'r180', rotation: -180, flipX: false, flipY: false },
  { name: 'r270', rotation: -90, flipX: false, flipY: false },
  { name: 'r23', rotation: 23, flipX: false, flipY: false },
  { name: 'r23h', rotation: 23, flipX: true, flipY: false },
  { name: 'r-37v', rotation: -37, flipX: false, flipY: true },
];

test('box selection outline is perimeter ordered for every visual box type and transform', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(transforms => {
    const M = window.PixelEditorDebug.services.model;
    const G = window.PixelEditorDebug.services.selectionGeometry;
    const types = ['rectangle', 'circle', 'text', 'image', 'raster'];
    return types.flatMap((type, typeIndex) => transforms.map((transform, index) => {
      const props = {
        id: `${type}-${index}`,
        parentId: 'p', type,
        x: 20 + typeIndex * 5, y: 30, w: 20, h: 12,
        transform,
      };
      const node = M.createNode(type, props);
      const geometry = G?.selectionGeometry?.(node);
      return { type, name: transform.name, geometry };
    }));
  }, transforms);

  expect(result.length).toBe(50);
  for (const item of result) {
    expect(item.geometry, `${item.type}/${item.name}`).toBeTruthy();
    const { outline, handles } = item.geometry;
    expect(outline).toHaveLength(4);
    expect(outline).toEqual([handles.nw, handles.ne, handles.se, handles.sw]);
    expect(selfIntersects(outline)).toBe(false);
    for (const point of outline) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  }
});

test('canonical selection geometry maps line endpoints and polygon vertices through transforms', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const M = window.PixelEditorDebug.services.model;
    const G = window.PixelEditorDebug.services.selectionGeometry;
    const line = M.createNode('line', {
      parentId: 'p', x1: 10, y1: 10, x2: 30, y2: 20,
      stroke: { width: 1, color: 1, style: 'solid' },
      transform: { rotation: 37, flipX: true, flipY: false },
    });
    const polygon = M.createNode('polygon', {
      parentId: 'p', points: [{ x: 40, y: 10 }, { x: 70, y: 12 }, { x: 55, y: 40 }],
      stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'transparent', color: 1 },
      transform: { rotation: -23, flipX: false, flipY: true },
    });
    return {
      line: G?.selectionGeometry?.(line),
      polygon: G?.selectionGeometry?.(polygon),
    };
  });
  expect(result.line.controlPoints).toHaveLength(2);
  expect(result.polygon.controlPoints).toHaveLength(3);
  for (const geometry of [result.line, result.polygon]) {
    for (const point of geometry.controlPoints) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  }
});

test('world/local mapping is reversible and semantic handle hit-testing survives mirror and rotation', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const M = window.PixelEditorDebug.services.model;
    const G = window.PixelEditorDebug.services.selectionGeometry;
    const node = M.createNode('rectangle', {
      parentId: 'p', x: 100, y: 80, w: 40, h: 20,
      transform: { rotation: 31, flipX: true, flipY: false },
    });
    const local = { x: 107.25, y: 88.5 };
    const world = G?.localToWorld?.(node, local);
    const back = G?.worldToLocal?.(node, world);
    const geometry = G?.selectionGeometry?.(node);
    return {
      local, world, back, geometry,
      nwHit: G?.hitHandle?.(node, geometry.handles.nw, 1),
      seHit: G?.hitHandle?.(node, geometry.handles.se, 1),
    };
  });
  expect(result.back.x).toBeCloseTo(result.local.x, 8);
  expect(result.back.y).toBeCloseTo(result.local.y, 8);
  expect(result.nwHit).toMatchObject({ type: 'resize', corner: 'nw' });
  expect(result.seHit).toMatchObject({ type: 'resize', corner: 'se' });
});

test('degenerate geometry stays finite and non-self-intersecting', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const M = window.PixelEditorDebug.services.model;
    const G = window.PixelEditorDebug.services.selectionGeometry;
    const nodes = [
      M.createNode('line', { parentId: 'p', x1: 20, y1: 20, x2: 20, y2: 20, stroke: { width: 1, color: 1, style: 'solid' }, transform: { rotation: 43 } }),
      M.createNode('rectangle', { parentId: 'p', x: 30, y: 30, w: 1, h: 1, transform: { rotation: 67, flipX: true } }),
      M.createNode('polygon', { parentId: 'p', points: [{ x: 50, y: 50 }, { x: 51, y: 50 }, { x: 50, y: 51 }], stroke: { width: 1, color: 1, style: 'solid' }, fill: { mode: 'transparent', color: 1 }, transform: { rotation: -41, flipY: true } }),
    ];
    return nodes.map(node => G?.selectionGeometry?.(node));
  });
  for (const geometry of result) {
    expect(geometry).toBeTruthy();
    const points = [...(geometry.outline || []), ...(geometry.controlPoints || [])];
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    if (geometry.outline?.length === 4) expect(selfIntersects(geometry.outline)).toBe(false);
  }
});

test('rendered transformed selection polygon follows canonical perimeter order after mirror', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(() => {
    const editor = window.PixelEditorTest.editor;
    const M = window.PixelEditorDebug.services.model;
    const C = window.PixelEditorDebug.services.commands;
    editor.newProject({ force: true });
    const p = editor.activePage();
    const node = M.createNode('rectangle', { parentId: p.id, x: 100, y: 80, w: 60, h: 30, transform: { rotation: 23, flipX: true, flipY: false } });
    editor.exec(new C.AddNodesCommand([node], p.id));
    editor.state.selection.replace([node.id]);
    editor.renderOverlay();
    const geometry = window.PixelEditorDebug.services.selectionGeometry?.selectionGeometry(node);
    const polygon = editor.overlay.querySelector('polygon.selection-box');
    const points = (polygon?.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).map(pair => {
      const [x, y] = pair.split(',').map(Number); return { x, y };
    });
    return { points, expected: geometry?.outline };
  });
  expect(result.points).toHaveLength(4);
  result.points.forEach((point, index) => {
    expect(point.x).toBeCloseTo(result.expected[index].x, 8);
    expect(point.y).toBeCloseTo(result.expected[index].y, 8);
  });
  expect(selfIntersects(result.points)).toBe(false);
});
