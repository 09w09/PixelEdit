# PixelEdit Media, Text, Overlay Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor PixelEdit so selection helpers are pixel-accurate and zoom-independent, text uses real glyph metrics, source images and editable rasters have distinct semantics, and imported fonts can be removed safely.

**Architecture:** First extract the monolithic inline script into an ES-module entry without changing behavior, then move the touched responsibilities into focused modules. `image` stays source-backed; `raster` becomes a first-class 1-bit node with packed persistent pixel data. Playwright tests define behavior before each subsystem change and the same full suite runs against Vite dev and production preview.

**Tech Stack:** Vite 7, vanilla HTML/CSS/ES modules, Canvas 2D, SVG overlay, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-editor-media-text-overlay-design.md`

## Global Constraints

- Document size remains exactly 400×300, 1-bit.
- Existing `.pix` V15 files must keep loading; legacy `image` nodes remain source-image nodes.
- Do not add React/Vue/Angular or another UI framework.
- Do not commit `SmileySans-Oblique.otf` or any other user-supplied font binary.
- Existing SVG target-size rerasterization and exact flat-cap line rasterization must not regress.
- No compatibility layer is required for old internal implementation structure.
- Final production verification must run the complete Playwright suite against `dist/`, not only SVG/line tests.

## Review Focus

- A 1×1 object and objects touching x=399/y=299 must keep correct selection geometry without off-by-one clipping; Task 2 adds boundary tests.
- Empty text, whitespace-only text, descenders, italic overhang, and multiple wrapped lines must not produce invalid metrics; Task 3 adds cases for each class.
- A raster resized from west/north must translate/crop pixel data rather than resample or silently shift the visual anchor; Task 5 adds directional resize tests.
- Removing a font shared by multiple text nodes/pages must update all references and preserve undo/redo; Task 6 adds multi-page tests.
- Old serialized image assets, SVG hydration, and raster serialization must coexist without dangling asset references; Tasks 4–7 cover mixed-project round trips.

---

### Task 1: Establish the ES-module seam without behavior changes

**Files:**
- Modify: `index.html`
- Create: `src/main.js`
- Create: `src/rendering/pixel-stroke.js`
- Create: `src/media/image-runtime.js`
- Modify: `vite.config.js`
- Delete: `public/pixel-stroke-runtime.js`
- Delete: `public/svg-vector-runtime.js`
- Test: existing `tests/core-regression.spec.js`, `tests/line-stroke.spec.js`, `tests/svg-vector.spec.js`

**Interfaces:**
- `src/main.js` is the sole application script entry loaded by `index.html` with `type="module"`.
- `src/rendering/pixel-stroke.js` exports `rasterThinLine`, `forEachStrokePixel`, `lineStrokeBounds`.
- `src/media/image-runtime.js` exports `parseSvgMeta`, `createSvgRuntime`, `renderSourceImage`, `hydrateImageAsset`.
- Existing globals `window.PixelEditor` and `window.PixelEditorTest` remain available for the current tests/API.

- [ ] **Step 1: Record a baseline by running the current full suite**

Run: `npm test`
Expected: all existing tests pass before refactoring.

- [ ] **Step 2: Extract the inline `<script>` body from `index.html` into `src/main.js` with no behavior edits**

Keep markup/CSS in `index.html`; replace the inline application script with `<script type="module" src="./src/main.js"></script>`.

- [ ] **Step 3: Move exact line-stroke logic and SVG runtime logic out of Vite runtime overrides**

`src/main.js` must import and call normal functions from `pixel-stroke.js` and `image-runtime.js`; do not monkey-patch via `transformIndexHtml`.

- [ ] **Step 4: Simplify `vite.config.js` to normal static Vite config**

Keep `base: './'`; remove `pixeledit-runtime-overrides`.

- [ ] **Step 5: Run regression tests and production build**

Run: `npm test && npm run build && npm run test:preview`
Expected: same behavior as baseline.

- [ ] **Step 6: Commit**

```bash
git add index.html src vite.config.js public tests package.json
git commit -m "refactor: establish PixelEdit ES module entry"
```

### Task 2: Make selection overlays exact and zoom-independent

**Files:**
- Create: `src/rendering/selection-overlay.js`
- Modify: `src/main.js`
- Modify: `index.html` selection-handle CSS only if needed
- Create: `tests/selection-overlay.spec.js`

**Interfaces:**
- `boxEdges(bounds) -> { left, top, right, bottom }`, where right=`x+w`, bottom=`y+h` for SVG edge geometry.
- `boxHandlePoints(bounds) -> [{x,y,corner}]` uses edge coordinates, never mixed `w`/`w-1` conventions.
- `handleVisualSize(zoom, cssPx=10) -> logicalSize`.
- `handleHitTolerance(zoom, cssPx=8) -> logicalRadius`, yielding a ~16 CSS px target diameter.
- `selectionMarkup({ nodes, selectionRects, zoom, previewMove, smartGuides, marquee }) -> string`.
- `hitSelectionHandle(node, point, zoom, visualBounds) -> handle|null`.

- [ ] **Step 1: Write failing overlay tests**

`tests/selection-overlay.spec.js` must assert exact box edges/handles for 1×1 and 10×10 nodes at 100%, 800%, 1600%; visible handle CSS size stays approximately 10px; line has only two endpoint handles; polygon handles match every vertex; boundary objects at right/bottom canvas edges do not shift.

- [ ] **Step 2: Run the new file and verify failure**

Run: `npx playwright test tests/selection-overlay.spec.js`
Expected: current off-by-one/small-handle behavior fails.

- [ ] **Step 3: Implement overlay geometry and move Workspace overlay/hit logic to `selection-overlay.js`**

Use SVG edge coordinates consistently. Box outline spans `[x,x+w] × [y,y+h]`; framebuffer pixels remain `[x,x+w-1] × [y,y+h-1]`. Do not use an inflated rectangular outline for lines.

- [ ] **Step 4: Run overlay plus existing geometry tests**

Run: `npx playwright test tests/selection-overlay.spec.js tests/line-stroke.spec.js tests/core-regression.spec.js`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/selection-overlay.js src/main.js index.html tests/selection-overlay.spec.js
git commit -m "fix: make selection helpers pixel accurate"
```

### Task 3: Replace font-size-based text placement with measured glyph layout

**Files:**
- Create: `src/rendering/text-layout.js`
- Modify: `src/main.js`
- Create: `tests/text-layout.spec.js`
- Local-only test input: `/mnt/data/SmileySans-Oblique.otf` (never git-add)

**Interfaces:**
- `fontString(node) -> string`.
- `measureGlyphRun(ctx, text, letterSpacing) -> { advance, inkLeft, inkRight, ascent, descent }`.
- `layoutText(node, ctx) -> { lines, totalHeight }`; each line stores baseline, x, ascent/descent and per-glyph positions.
- `renderTextMask(node, { document }) -> { w, h, mask }`.
- Existing `PixelEditor.renderer.TextRenderer.mask(node)` delegates to `renderTextMask`.

- [ ] **Step 1: Write failing browser metric tests**

Cover top/middle/bottom alignment, italic overhang, descenders, empty/whitespace text, wrapping, letterSpacing, lineSpacing, bold/invert regression, and a sufficiently tall box where top-aligned ink must have no accidental top clipping.

- [ ] **Step 2: Run tests and confirm current renderer fails metric cases**

Run: `npx playwright test tests/text-layout.spec.js`
Expected: at least top/italic metric cases fail before implementation.

- [ ] **Step 3: Implement measured layout**

Use `actualBoundingBoxAscent/Descent/Left/Right`; if unavailable, fall back to font bounding metrics, then to the conservative existing fallback. Draw by calculated baseline, not `textBaseline='top'` assumptions.

- [ ] **Step 4: Run a local Smiley Sans regression using the supplied OTF**

Temporarily expose the font to the local test server or inject it as a data URL during the test run. Verify Chinese top strokes no longer clip. Do not commit the font or generated fixture.

- [ ] **Step 5: Run all text/core tests**

Run: `npx playwright test tests/text-layout.spec.js tests/core-regression.spec.js`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/rendering/text-layout.js src/main.js tests/text-layout.spec.js
git commit -m "fix: lay out text from actual glyph metrics"
```

### Task 4: Introduce explicit `image` and `raster` node models

**Files:**
- Create: `src/media/raster-layer.js`
- Modify: `src/media/image-runtime.js`
- Modify: `src/main.js`
- Create: `tests/media-model.spec.js`
- Modify: `tests/svg-vector.spec.js`

**Interfaces:**
- `image` keeps current source asset/source properties.
- `raster` shape: `{ type:'raster', x, y, w, h, raster:{ encoding:'bitset-base64-v1', data:string } }` plus common node metadata.
- `encodeRasterPixels(Uint8Array) -> string` packs 1 bit/pixel, row-major.
- `decodeRasterPixels(data,w,h) -> Uint8Array` returns exactly `w*h` binary values.
- `createRasterPayload(w,h,pixels?) -> { encoding, data }`.
- `renderRaster(node) -> Uint8Array`.
- Project serializer must preserve raster data directly; raster nodes do not reference image assets.

- [ ] **Step 1: Write failing model/serialization tests**

Assert PNG/SVG/XBM imports still create `image`; `createNode('raster')` creates valid packed white pixels; raster round-trip through `.pix` is byte-identical; legacy image round-trip still works; SVG hydration remains vector-backed.

- [ ] **Step 2: Run tests and confirm raster type is unsupported**

Run: `npx playwright test tests/media-model.spec.js tests/svg-vector.spec.js`
Expected: raster tests fail, existing SVG tests remain diagnostic.

- [ ] **Step 3: Add raster creation/render/serialization support and integrate source-image runtime**

Update node labels/tree/property type handling to recognize `raster`; source-image properties remain only for `image`.

- [ ] **Step 4: Run media/model/core regression**

Run: `npx playwright test tests/media-model.spec.js tests/svg-vector.spec.js tests/core-regression.spec.js`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/media src/main.js tests/media-model.spec.js tests/svg-vector.spec.js
git commit -m "feat: separate source images from raster layers"
```

### Task 5: Implement raster painting, rasterization, and non-resampling resize

**Files:**
- Modify: `src/media/raster-layer.js`
- Modify: `src/main.js`
- Create: `tests/raster-editing.spec.js`

**Interfaces:**
- `paintRaster(node, points, value) -> rasterPayload` returns updated packed data without mutating source images.
- `resizeRaster(node, { x, y, w, h }) -> { x, y, w, h, raster }` preserves/crops/translates pixels without interpolation.
- `rasterizeSubtree({ project, pageId, nodeId, assets }) -> { bounds, pixels }` uses the current 1-bit framebuffer result.
- Workspace `paintTarget()` returns page background or `raster` only.
- `Workspace.rasterizeSelected()` replaces eligible selected subtree with `type:'raster'`.

- [ ] **Step 1: Write failing editing tests**

Cover: image pencil/eraser rejection with notice; page background remains paintable; raster pencil and eraser change exact pixels; expanding right/bottom adds white; shrinking crops; west/north drag translates/crops without scaling; resizing a checker pattern never introduces new sampled values; rasterization of rectangle/circle/line/polygon/text/image/subtree is framebuffer-identical; already-flat raster is not redundantly rasterized.

- [ ] **Step 2: Run and verify failures**

Run: `npx playwright test tests/raster-editing.spec.js`
Expected: current image-overlay paint model and rasterization behavior fail the new contract.

- [ ] **Step 3: Implement painting and resize semantics**

Remove direct painting support from `image`. Update `setSelectionSize`, live corner resize, cancel/commit gesture logic, framebuffer rendering, hit testing, selection/property box-type lists, clipboard duplication, and subtree flattening for `raster`.

- [ ] **Step 4: Run all media/interaction tests**

Run: `npx playwright test tests/raster-editing.spec.js tests/media-model.spec.js tests/selection-overlay.spec.js tests/core-regression.spec.js tests/svg-vector.spec.js tests/line-stroke.spec.js`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/media/raster-layer.js tests/raster-editing.spec.js
git commit -m "feat: add editable non-resampling raster layers"
```

### Task 6: Add imported-font lifecycle and removal

**Files:**
- Create: `src/fonts/font-manager.js`
- Modify: `src/main.js`
- Create: `tests/font-management.spec.js`

**Interfaces:**
- `class FontManager { constructor({ assets, document }); importFiles(files, project); register(record); sync(projectFonts); unregister(record); }`.
- `isImportedFamily(project,family) -> boolean`.
- `RemoveImportedFontCommand(family)` updates every page's text references and `project.fonts` transactionally; effective `fontSize` is preserved when clearing `fixedFontSize`.
- `Workspace.removeImportedFont(family)` rejects built-ins, executes the command, synchronizes `FontManager`, then rerenders.

- [ ] **Step 1: Write failing font lifecycle tests**

Cover import, duplicate import, remove unused, remove used on one node, remove used across multiple pages, fallback to `sans-serif`, fixed-size preservation, default-font rejection, asset cleanup only when unreferenced, undo, redo, save/open with no dangling font references.

- [ ] **Step 2: Run and verify failures**

Run: `npx playwright test tests/font-management.spec.js`
Expected: removal cases fail because only import/register exists today.

- [ ] **Step 3: Implement `FontManager`, removal command and properties UI**

Show remove action only for imported selected font. `document.fonts.delete()` and cache removal happen through `FontManager.sync`; undo/redo restores project state first and syncs faces before final render.

- [ ] **Step 4: Re-run local Smiley Sans render after import/remove/undo**

Use the supplied OTF only in the local execution environment; verify full top strokes before removal, `sans-serif` after removal, and Smiley Sans again after undo.

- [ ] **Step 5: Run font/text/core tests**

Run: `npx playwright test tests/font-management.spec.js tests/text-layout.spec.js tests/core-regression.spec.js`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/fonts/font-manager.js src/main.js tests/font-management.spec.js
git commit -m "feat: support removable imported fonts"
```

### Task 7: Full branch regression, production parity, and cleanup

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml` only if required by the final commands
- Modify: `.github/workflows/pages.yml` only if required by the final commands
- Modify: `README.md` only if run instructions changed
- Delete obsolete code/runtime files discovered after extraction

**Interfaces:**
- `npm test` runs every committed Playwright spec against Vite dev.
- `npm run test:preview` runs the same complete suite against `npm run preview`/`dist`.
- `npm run build` must produce a deployable static `dist/` for GitHub Pages.

- [ ] **Step 1: Change `test:preview` from selected specs to the complete test directory**

Expected script: `playwright test --config playwright.preview.config.js`.

- [ ] **Step 2: Run complete development-server regression**

Run: `npm test`
Expected: every test in `tests/` passes, including old core/SVG/line tests and all new overlay/text/media/raster/font tests.

- [ ] **Step 3: Build and run the same complete suite against production output**

Run: `npm run build && npm run test:preview`
Expected: all tests pass from `dist`.

- [ ] **Step 4: Inspect repository for obsolete monkey-patch/runtime paths and user font artifacts**

Verify `public/svg-vector-runtime.js` and `public/pixel-stroke-runtime.js` are gone, Vite has no runtime injection plugin, and `git status`/tracked files contain no Smiley font binary.

- [ ] **Step 5: Commit final cleanup**

```bash
git add -A
git commit -m "test: complete PixelEdit editor regression coverage"
```

### Task 8: Verify branch, fast-forward `main`, and verify Pages

**Files:** no product changes expected.

- [ ] **Step 1: Run fresh verification immediately before integration**

Run: `npm test && npm run build && npm run test:preview`
Expected: all commands exit 0.

- [ ] **Step 2: Compare `main...refactor/editor-media-text-overlay`**

Review changed files for accidental unrelated changes, test-only shortcuts, temporary font data, or generated artifacts.

- [ ] **Step 3: Fast-forward `main` to the verified branch head**

Do not move `main` until Step 1 and Step 2 are clean.

- [ ] **Step 4: Wait for GitHub CI and Deploy GitHub Pages workflows on the new `main` commit**

Expected: CI test/build/preview all success; Pages build/upload/deploy success.

- [ ] **Step 5: Verify the deployed site**

Open `https://09w09.github.io/PixelEdit/` and verify boot plus representative selection/text/raster behavior after deployment.
