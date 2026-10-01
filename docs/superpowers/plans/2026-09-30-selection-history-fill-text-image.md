# PixelEdit V17 Selection, History, Text, Fill, and Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PixelEdit V17 with canonical transformed selection geometry, global native-context-menu suppression, persistent text creation defaults, correct final-1-bit image inversion, semantic history coalescing, normalized black/white fill semantics, and consistent stroke/fill property grouping.

**Architecture:** Move version/schema ownership out of editor preferences, then make selection geometry, history coalescing, binary-image conversion, font-option resolution, and shape-style UI each have one canonical module. Existing runtime modules may install these capabilities into the current app, but they must delegate to the canonical implementation and remove duplicate/legacy paths rather than layering independent fallback behavior.

**Tech Stack:** Vite 7, vanilla ES modules/DOM, Playwright, Canvas/SVG, localStorage, GitHub Actions/Pages.

**Spec:** `docs/superpowers/specs/2026-09-30-selection-history-fill-text-image-design.md`

## Global Constraints

- Project format is **V17**; opening any non-V17 `.pix` project fails explicitly.
- No migration or compatibility layer for V16 or older project data.
- Production node/style paths must not depend on deprecated `lineWidth`, `fill.value`, or V15/V16 fallback semantics.
- Page size remains exactly `400 × 300`; final framebuffer/export remains opaque 1-bit black/white.
- Page background may never be transparent.
- Stroke styles remain exactly `solid`, `short-dash`, `long-dash`, `dot`, `dash-dot`.
- Shape tool creation defaults expose dither/pattern **only after creation**; the second toolbar exposes only transparent/solid fill and black/white solid color.
- Image inversion is applied once to the final binary result; source RGBA and alpha are not inverted.
- Repeated semantic edits have **no time-based merge window**; only semantic boundaries end a merge chain.
- Editor preferences, including text tool defaults, use a V17 localStorage namespace and are not saved in `.pix`.
- Browser-native context menus are suppressed everywhere in the PixelEdit document; only PixelEdit's custom canvas/layer menu may appear.
- Final delivery requires full dev Playwright, production build, full production-preview Playwright, branch review, squash merge, `main` CI, and Pages verification.

## Review Focus

- **Degenerate transformed geometry:** zero-length lines, nearly-zero boxes, and small polygons must not emit self-intersecting/NaN selection geometry; Task 2 pins these cases.
- **Context-menu descendants:** right-clicking nested SVG paths, buttons, inputs, and textareas must still prevent the browser menu while preserving the correct PixelEdit source region; Task 3 pins these cases.
- **Merge identity stability:** selecting the same targets in a different order must normalize to the same target set, while any intervening unmatched command or selection/page/tool boundary must split history; Task 6 pins these cases.
- **Removed fixed-size font still selected by the text tool:** removing that font must fall back to the default scalable family and restore `lastScalableFontSize` without mutating unrelated text; Task 4 pins this case.
- **Transparent/padded image inversion:** contain/cover padding and transparent source pixels must remain transparent through threshold/dither inversion and match preview/framebuffer/export; Task 5 pins this case.

---

## File Structure

### New canonical modules

- `src/model/v17-schema.js` — V17 project/node/fill/stroke validation and project-format ownership.
- `src/selection/selection-geometry.js` — transformed outlines, semantic handles, control points, local/world mapping, visual bounds.
- `src/ui/context-menu-boundary.js` — document-wide native context-menu suppression and region routing.
- `src/fonts/font-options.js` — one font-option/fixed-size resolver shared by tool and element properties.
- `src/tools/text-tool-options.js` — text creation-default controls and fixed/scalable size transitions.
- `src/rendering/binary-image.js` — RGBA-to-binary conversion, coverage, and single final invert stage.
- `src/history/command-coalescing.js` — normalized merge descriptors and explicit merge-chain boundaries.
- `src/tools/shape-style-options.js` — creation-time stroke/fill controls for line/rectangle/circle/polygon.
- `src/properties/shape-style-properties.js` — element-side stroke/fill grouping and bindings.

### Existing modules to consolidate

- `src/preferences/editor-preferences.js` — local preferences only; no project-schema ownership.
- `src/rendering/selection-overlay.js` — consume `selection-geometry`, remove duplicate corner/transform calculations.
- `src/transforms/transform-model.js` — remain the affine transform primitive used by selection geometry.
- `src/transforms/selection-transform.js` — consume canonical visual geometry; no independent handle geometry.
- `src/rendering/stroke-style.js` — render canonical `stroke`; remove legacy `lineWidth` adaptation.
- `src/tools/tool-state.js` / `src/tools/tool-options-bar.js` — delegate text/shape controls to focused modules.
- `src/fonts/font-manager.js` — consume shared font options and compact action row.
- `src/media/image-runtime.js` and framebuffer image branch in `index.html` — consume canonical binary-image result.
- `src/ui/context-menu.js` — custom menu command registry only; native suppression moves to boundary module.
- `src/ui/history-properties.js` and relevant command/property bindings — provide semantic merge descriptors.
- `src/main.js` — install V17 modules in dependency order.
- `index.html` — remove/replace remaining production V15/V16 model/render/history assumptions used by the active runtime.

---

### Task 1: Establish the V17 schema and preference namespace

**Files:**
- Create: `src/model/v17-schema.js`
- Modify: `src/preferences/editor-preferences.js`
- Modify: `src/main.js`
- Modify: `index.html`
- Test: `tests/v17-schema.spec.js`
- Update: `tests/core-regression.spec.js`

**Interfaces:**
- Produces: `normalizeStroke(input) -> { width, color, style }`.
- Produces: `normalizeFill(input, { background = false } = {}) -> { mode, color }` with `color` normalized to `0|1` and no transparent page background.
- Produces: `validateV17Project(project) -> project`.
- Produces: `installV17SchemaRuntime(target = globalThis)` and `PixelEditor.schemaV17` exposing the three functions above.
- Produces preference constants `pixeledit:v17:preferences`, `pixel-editor-v17-autosave`, `pixel-project-v17.pix`.
- Later tasks consume canonical fill/stroke shapes and V17 preference defaults.

- [ ] **Step 1: Write V17 schema RED tests**

Add tests asserting:

```js
expect(editor.state.project.version).toBe(17);
expect(editor.getToolDefaults('text')).toMatchObject({
  fontFamily: 'sans-serif', fontSize: 16, lastScalableFontSize: 16,
});
expect(editor.getToolDefaults('rectangle').fill).toEqual({ mode: 'transparent', color: 1 });
expect(() => ProjectSerializer.deserialize(v16Raw)).toThrow(/V17/);
```

Also assert V17 serialization rejects a node containing top-level `lineWidth`, any fill containing `value`, and a page with `fill.mode === 'transparent'`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx playwright test tests/v17-schema.spec.js tests/core-regression.spec.js`

Expected: new V17 assertions fail because current runtime is V16 and preferences/schema ownership is still V16.

- [ ] **Step 3: Implement `src/model/v17-schema.js`**

Implement the exact interfaces above. Move project creation/validation/serialization version ownership out of `editor-preferences.js`; V17 creation must emit canonical `stroke`, canonical `fill`, tri-state raster, and existing canonical `transform`, and must not emit deprecated style fields.

- [ ] **Step 4: Convert editor preferences to V17-only local state**

Update `defaultEditorPreferences()` to include:

```js
tools.text = { fontFamily: 'sans-serif', fontSize: 16, lastScalableFontSize: 16 };
tools.rectangle.fill = tools.circle.fill = tools.polygon.fill = { mode: 'transparent', color: 1 };
```

Use the V17 keys above. Do not read V16 preference/autosave keys.

- [ ] **Step 5: Remove active V15/V16 project-schema assumptions from `index.html` and install V17 first in `src/main.js`**

Project/bootstrap/version strings used by the active app must report V17. Remove active creation/validation reliance on `fill.value` or top-level `lineWidth`; do not introduce aliases.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run: `npx playwright test tests/v17-schema.spec.js tests/core-regression.spec.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/model/v17-schema.js src/preferences/editor-preferences.js src/main.js index.html tests/v17-schema.spec.js tests/core-regression.spec.js
git commit -m "refactor: establish V17 schema"
```

---

### Task 2: Replace duplicated selection math with canonical selection geometry

**Files:**
- Create: `src/selection/selection-geometry.js`
- Modify: `src/rendering/selection-overlay.js`
- Modify: `src/transforms/selection-transform.js`
- Modify: `src/transforms/transform-model.js` only if a missing affine primitive is required
- Modify: `src/main.js`
- Test: `tests/selection-geometry.spec.js`
- Update: `tests/selection-overlay.spec.js`
- Update: `tests/selection-points.spec.js`
- Update: `tests/selection-transform.spec.js`
- Update: `tests/transform-branches.spec.js`

**Interfaces:**
- Consumes: `PixelEditor.transformModel.nodeTransformMatrix(node, bounds)`, `transformPoint(matrix, point)`, `inverseTransformPoint(matrix, point)`.
- Produces: `sourceGeometryBounds(node) -> Bounds`.
- Produces: `selectionGeometry(node) -> { outline, handles, controlPoints, visualBounds }`.
- `outline` for box-like nodes is always perimeter order `NW, NE, SE, SW`.
- `handles` for box-like nodes is `{ nw, ne, sw, se }` regardless of outline order.
- Produces: `localToWorld(node, point) -> Point` and `worldToLocal(node, point) -> Point`.
- Produces: `hitHandle(node, worldPoint, zoom) -> { type, corner/index } | null`.
- `selection-overlay` and resize/hit-test logic must consume these functions rather than derive corners independently.

- [ ] **Step 1: Write transform-matrix RED tests for the screenshot bug and full transform composition**

Cover box-like node types `rectangle`, `circle`, `text`, `image`, `raster` for identity, H-flip, V-flip, both flips, 90/180/270, arbitrary 23°, rotate→flip, flip→rotate. Assertions must verify:

```js
expect(outline).toEqual([handles.nw, handles.ne, handles.se, handles.sw]);
expect(polygonSelfIntersects(outline)).toBe(false);
```

Also cover line endpoints and polygon vertices through the same matrix.

- [ ] **Step 2: Add Review Focus RED tests for degenerate geometry**

Test zero-length line, `1×1` box, and a minimal triangle after arbitrary transform. Assert every emitted coordinate is finite and outlines/control points do not contain NaN/Infinity or self-intersect.

- [ ] **Step 3: Run focused selection tests and verify RED**

Run: `npx playwright test tests/selection-geometry.spec.js tests/selection-overlay.spec.js tests/selection-points.spec.js tests/selection-transform.spec.js tests/transform-branches.spec.js`

Expected: screenshot-case outline fails because current box polygon consumes semantic handle order directly.

- [ ] **Step 4: Implement `selection-geometry.js` and migrate overlay rendering**

Make `renderOverlay()` use `selectionGeometry(node).outline` for drawing and `.handles`/`.controlPoints` for handles. No `boxOutlinePoints()`/independent transformed-point implementation may remain in `selection-overlay.js`.

- [ ] **Step 5: Migrate hit testing and resize mapping to `worldToLocal`/semantic handles**

Preserve existing resize behavior, including transformed raster editing, but derive pointer mapping from the canonical geometry module.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 3. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/selection/selection-geometry.js src/rendering/selection-overlay.js src/transforms/selection-transform.js src/transforms/transform-model.js src/main.js tests/selection-geometry.spec.js tests/selection-overlay.spec.js tests/selection-points.spec.js tests/selection-transform.spec.js tests/transform-branches.spec.js
git commit -m "fix: unify transformed selection geometry"
```

---

### Task 3: Suppress the native context menu across the entire editor

**Files:**
- Create: `src/ui/context-menu-boundary.js`
- Modify: `src/ui/context-menu.js`
- Modify: `src/main.js`
- Test: `tests/context-menu-boundary.spec.js`
- Update: `tests/clipboard-context.spec.js`

**Interfaces:**
- Consumes: existing `editor.openContextMenu({ source, nodeId, clientX, clientY })` and shared context-command registry.
- Produces: `classifyContextRegion(eventTarget) -> 'canvas' | 'layers' | 'none'`.
- Produces: `installNativeContextMenuBoundary(editor, documentRef = document) -> cleanupFn`.
- The boundary always calls `preventDefault()`; it opens PixelEdit's menu only for canvas/layer sources and otherwise closes any open PixelEdit menu.

- [ ] **Step 1: Write document-wide context-menu RED tests**

Dispatch cancellable `contextmenu` events against body/document, global toolbar, second toolbar, tool dock, canvas/stage, layer dock, properties, history, status, ruler, splitter, blank workspace, input, select, and textarea. Assert `event.defaultPrevented === true` everywhere and custom menu opens only for canvas/layer contexts.

- [ ] **Step 2: Add Review Focus tests for nested descendants**

Right-click an SVG `<path>` inside a toolbar button, a nested layer label, an `<input>`, and a `<textarea>`. Assert classification walks ancestors correctly and the browser menu remains suppressed.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx playwright test tests/context-menu-boundary.spec.js tests/clipboard-context.spec.js`

Expected: non-canvas/non-layer regions still allow the browser-native menu.

- [ ] **Step 4: Implement the single document-level boundary and simplify `context-menu.js`**

`context-menu.js` must own only menu contents/commands/open-close state. Remove competing native-event prevention listeners from specific regions so there is exactly one suppression boundary.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run Step 3 command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/context-menu-boundary.js src/ui/context-menu.js src/main.js tests/context-menu-boundary.spec.js tests/clipboard-context.spec.js
git commit -m "fix: own all editor context menus"
```

---

### Task 4: Add text creation defaults and consolidate font controls

**Files:**
- Create: `src/fonts/font-options.js`
- Create: `src/tools/text-tool-options.js`
- Create: `src/properties/text-font-actions.js`
- Modify: `src/tools/tool-state.js`
- Modify: `src/tools/tool-options-bar.js`
- Modify: `src/fonts/font-manager.js`
- Modify: `src/main.js`
- Test: `tests/text-tool-options.spec.js`
- Update: `tests/font-management.spec.js`
- Update: `tests/font-import.spec.js`
- Update: `tests/text-layout.spec.js`

**Interfaces:**
- Consumes: V17 `editorPreferences.tools.text` from Task 1.
- Produces: `fontOptions(project) -> Array<{ value, label, imported, fixedSize }>` used by both tool and element properties.
- Produces: `fontRecordForFamily(project, family) -> FontRecord | null`.
- Produces: `resolveTextToolSelection(preferences, project, family) -> { fontFamily, fontSize, lastScalableFontSize, fixed }`.
- Produces: `renderTextToolOptions(editor, container)` with controls `#toolOptionFont` and `#toolOptionFontSize`.
- Produces: `renderTextFontActions(properties, nodes, locked)` placing `#importFontBtn` and conditional `#removeFontBtn` inside one `.font-actions` row.
- New text nodes snapshot the current tool defaults at creation; existing nodes do not change when defaults change.

- [ ] **Step 1: Write text-tool default RED tests**

Assert scalable font/size persistence, new text snapshot behavior, and that changing tool defaults after creation does not mutate an existing text node.

- [ ] **Step 2: Write fixed-size font and font-action RED tests**

Cover imported scalable and fixed-size fonts. Assert fixed font disables size, switching back restores `lastScalableFontSize`, button copy is exactly `导入字体`, and import/remove buttons share one row when removal is applicable.

- [ ] **Step 3: Add Review Focus test for removing the font currently selected in the text tool**

After selecting a fixed-size imported font in the text tool, remove it. Assert tool preference falls back to `sans-serif`, size becomes enabled, and the previous `lastScalableFontSize` is restored. Existing unrelated text nodes must remain unchanged.

- [ ] **Step 4: Run focused tests and verify RED**

Run: `npx playwright test tests/text-tool-options.spec.js tests/font-management.spec.js tests/font-import.spec.js tests/text-layout.spec.js`

Expected: text tool has no font/size controls and current font-action markup/copy fails.

- [ ] **Step 5: Implement shared font option provider and text tool controls**

`tool-options-bar.js` delegates `tool === 'text'` to `renderTextToolOptions()`. Use `setToolDefault()` so text defaults remain local preferences and never add history entries.

- [ ] **Step 6: Snapshot text defaults on creation and consolidate font action markup**

Use the same provider for `propFont` and `toolOptionFont`. Remove the old `导入字体（可多选）` wording; file input remains `multiple`.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run Step 4 command. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/fonts/font-options.js src/tools/text-tool-options.js src/properties/text-font-actions.js src/tools/tool-state.js src/tools/tool-options-bar.js src/fonts/font-manager.js src/main.js tests/text-tool-options.spec.js tests/font-management.spec.js tests/font-import.spec.js tests/text-layout.spec.js
git commit -m "feat: add text creation font defaults"
```

---

### Task 5: Replace image inversion with one final binary stage

**Files:**
- Create: `src/rendering/binary-image.js`
- Modify: `src/media/image-runtime.js`
- Modify: `index.html` framebuffer image branch
- Modify: `src/transforms/transform-model.js` only to consume the same binary/composited image result if needed
- Modify: `src/main.js`
- Test: `tests/image-invert.spec.js`
- Update: existing image/SVG tests that inspect binary output

**Interfaces:**
- Consumes: `ImageRenderer.render(node, assets) -> { width, height, data: RGBA }` without inversion.
- Produces: `thresholdToBinary(rgba, width, height, threshold) -> { bits, alpha }`.
- Produces: `ditherToBinary(rgba, width, height, options) -> { bits, alpha }` where options select Bayer/Blue Noise/Floyd-Steinberg/Atkinson but do **not** invert.
- Produces: `applyFinalBinaryInvert(result, invert) -> { bits, alpha }`; when `invert === true`, only covered bits are toggled.
- Produces: `binaryImageForNode(node, assets) -> { width, height, bits, alpha }` as the one image-to-1-bit entry point used by preview/framebuffer/subtree/export.

- [ ] **Step 1: Write threshold/dither RED matrix**

For threshold plus Bayer, Blue Noise, Floyd-Steinberg, and Atkinson, assert normal and inverted outputs are exact complements only where alpha is covered.

- [ ] **Step 2: Add source edge cases and Review Focus padding/alpha tests**

Cover all-white, all-black, grayscale, transparent pixels, and `contain` padding. Assert transparent/padded pixels remain uncovered after invert.

- [ ] **Step 3: Add path-consistency RED assertions**

For one threshold and one dither case, assert editor preview, framebuffer/subtree result, and exported PNG produce the same binary pixels.

- [ ] **Step 4: Run focused tests and verify RED**

Run: `npx playwright test tests/image-invert.spec.js tests/svg-vector.spec.js`

Expected: current threshold/dither branches apply invert separately and at least the reported all-white regression fails.

- [ ] **Step 5: Implement `binary-image.js` and remove invert from threshold/dither algorithms**

Source image decode/crop/fit/interpolation produces RGBA only. All binary consumers call `binaryImageForNode()` and then composite using `alpha` coverage.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run Step 4 command. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/rendering/binary-image.js src/media/image-runtime.js src/transforms/transform-model.js src/main.js index.html tests/image-invert.spec.js tests/svg-vector.spec.js
git commit -m "fix: unify final binary image inversion"
```

---

### Task 6: Replace timed history merging with semantic coalescing

**Files:**
- Create: `src/history/command-coalescing.js`
- Modify: `index.html` command bus / move and update command definitions
- Modify: `src/ui/history-properties.js`
- Modify: `src/transforms/selection-transform.js`
- Modify: `src/ui/context-menu.js` where create/delete/paste/transform boundaries are routed
- Modify: `src/main.js`
- Test: `tests/history-coalescing.spec.js`
- Update: `tests/history-properties.spec.js`

**Interfaces:**
- Produces: `normalizeMergeDescriptor({ operation, targets, channel }) -> { operation, targets: sortedUniqueIds, channel }`.
- Produces: `mergeDescriptorKey(descriptor) -> string`.
- Extends `CommandBus` with `breakMergeChain(reason = '') -> void`.
- Mergeable commands expose `mergeDescriptor` as either an object or zero-argument function returning the normalized semantic descriptor.
- `MoveSelectionCommand` descriptor: `{ operation: 'move', targets, channel: 'geometry' }`.
- Property updates use `{ operation: 'property', targets, channel: '<property-key>' }`.
- A nonmatching/nonmergeable command, undo, redo, jump, new/open/reset, page/tool/selection change calls/causes `breakMergeChain()`.

- [ ] **Step 1: Write history-coalescing RED tests**

Cover three repeated moves → one entry, three X edits → one entry, X→Y → two entries, move→rotate → two entries, selection/page/tool change → new entry, create/delete/paste → boundary, undo/redo/jump → boundary, and Undo→edit truncates redo and starts a fresh chain.

- [ ] **Step 2: Add no-time-window and Review Focus target-order tests**

Use a mocked/advanced clock or explicit wait >500ms between matching edits and assert they still merge. Execute the same operation with target arrays `[b,a]` then `[a,b]` and assert one chain; changing the target set must split it.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx playwright test tests/history-coalescing.spec.js tests/history-properties.spec.js`

Expected: current 500ms merge rule and merge-key behavior fail the semantic tests.

- [ ] **Step 4: Implement canonical descriptor matching in the command bus**

Delete the time comparison entirely. When descriptors match the active chain, replace the current history snapshot while retaining the original pre-operation history predecessor; otherwise append normally and establish/clear the chain as required.

- [ ] **Step 5: Route explicit boundaries and property channels**

Selection changes, `setTool`, page activation, project new/open/reset, history navigation, and nonmatching commands must break the chain. Property bindings must supply stable property channels rather than one generic label.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run Step 3 command. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/history/command-coalescing.js src/ui/history-properties.js src/transforms/selection-transform.js src/ui/context-menu.js src/main.js index.html tests/history-coalescing.spec.js tests/history-properties.spec.js
git commit -m "refactor: coalesce history semantically"
```

---

### Task 7: Normalize shape creation and element stroke/fill UI

**Files:**
- Create: `src/tools/shape-style-options.js`
- Create: `src/properties/shape-style-properties.js`
- Modify: `src/tools/tool-options-bar.js`
- Modify: `src/tools/tool-state.js`
- Modify: `src/rendering/stroke-style.js`
- Modify: `index.html` fill/render/property base paths
- Modify: `src/main.js`
- Test: `tests/shape-tool-options.spec.js`
- Test: `tests/shape-style-properties.spec.js`
- Update: `tests/line-stroke.spec.js`
- Update: `tests/stroke-branches.spec.js`
- Update: `tests/core-regression.spec.js`

**Interfaces:**
- Consumes: Task 1 `normalizeStroke()`/`normalizeFill()` and V17 shape tool preferences.
- Produces: `renderShapeToolOptions(editor, container, tool)`:
  - line: `stroke.width/color/style` only;
  - rectangle/circle/polygon: same stroke controls plus `fill.mode` (`transparent|solid`) and `fill.color` (`0|1`, enabled only for solid).
- Produces: `shapeStylePropertyMarkup(properties, nodes, locked) -> string` with separate geometry sections and one `描边` section containing width/color/style plus one `填充` section.
- Produces: `bindShapeStyleProperties(properties, nodes, locked)` using semantic property-history channels from Task 6.
- Renderer uses `fill.color` for `mode === 'solid'`; dither/pattern behavior remains independent of `fill.color`.
- `stroke-style.js` must render canonical stroke directly and must not create/use top-level `lineWidth` as an adapter.

- [ ] **Step 1: Write shape-tool RED tests**

Assert line has exactly stroke controls; rectangle/circle/polygon have stroke + fill type/color; fill color is disabled/hidden as specified when transparent and enabled for solid; creation snapshots defaults and changing defaults does not mutate existing nodes.

- [ ] **Step 2: Write element-property grouping RED tests**

For line, rectangle, circle, polygon, assert `线宽/颜色/样式` appear together under one `描边` section and no line-width control remains in the geometry section. For fillable shapes assert transparent/solid/dither/pattern and solid black/white editing.

- [ ] **Step 3: Write rendering combinatoric RED tests**

Cover all five stroke styles with black/white colors, widths 1 and >1, and rectangle/circle/polygon transparent/solid-black/solid-white fills. Add representative dither/pattern checks to prove those modes ignore `fill.color`.

- [ ] **Step 4: Run focused tests and verify RED**

Run: `npx playwright test tests/shape-tool-options.spec.js tests/shape-style-properties.spec.js tests/line-stroke.spec.js tests/stroke-branches.spec.js`

Expected: missing creation fill controls, old property grouping, and solid-fill color semantics fail.

- [ ] **Step 5: Implement focused shape tool/property modules and canonical rendering**

Remove obsolete shape-style markup/bindings from the large base `Properties.typeFields()` path as ownership moves to `shape-style-properties.js`. Do not leave a second hidden copy of stroke controls.

- [ ] **Step 6: Remove remaining legacy style adapters**

`stroke-style.js` and active framebuffer/fill code must no longer depend on top-level `lineWidth` or `fill.value`; pattern's nested `pattern.lineWidth` remains valid and must not be confused with the removed node field.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run Step 4 command. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/tools/shape-style-options.js src/properties/shape-style-properties.js src/tools/tool-options-bar.js src/tools/tool-state.js src/rendering/stroke-style.js src/main.js index.html tests/shape-tool-options.spec.js tests/shape-style-properties.spec.js tests/line-stroke.spec.js tests/stroke-branches.spec.js tests/core-regression.spec.js
git commit -m "refactor: normalize shape stroke and fill controls"
```

---

### Task 8: Cross-subsystem V17 E2E, legacy-path audit, and complete regression gate

**Files:**
- Create: `tests/v17-editor-e2e.spec.js`
- Modify only if E2E exposes a real defect: the owning source/test file from Tasks 1–7
- Review: all changed production files and `index.html`

**Interfaces:**
- Consumes every public/runtime interface produced by Tasks 1–7.
- Produces no new feature API; this task is the integration/verification gate.

- [ ] **Step 1: Add one cross-subsystem E2E**

The test must execute through real editor APIs/DOM controls in this order:

1. start a V17 project;
2. create a solid-white filled, styled-stroke shape from tool defaults;
3. mirror and arbitrarily rotate it, then assert non-self-intersecting selection outline/handles;
4. move it at least three times and assert one semantic history entry, then perform a different operation and assert a new entry;
5. create text using text-tool font/size defaults, including fixed→scalable transition;
6. create/import an image fixture with transparent pixels, enable invert, and assert binary output is correct;
7. dispatch right-clicks in canvas and a non-menu UI region and assert only the PixelEdit menu can appear;
8. serialize to V17, deserialize, and assert style/transform/text/image state survives;
9. export PNG and assert pixels are opaque and only black/white.

- [ ] **Step 2: Run the new E2E alone**

Run: `npx playwright test tests/v17-editor-e2e.spec.js`

Expected: PASS before proceeding.

- [ ] **Step 3: Run the complete dev suite**

Run: `npm test`

Expected: all Playwright tests PASS; record the exact test count from this run.

- [ ] **Step 4: Build production**

Run: `npm run build`

Expected: Vite build exits 0 with no unresolved imports or build errors.

- [ ] **Step 5: Run the complete production-preview suite**

Run: `npm run test:preview`

Expected: the same complete Playwright suite PASS against `dist`; record the exact test count.

- [ ] **Step 6: Audit for forbidden/duplicated production paths**

Inspect the branch diff and production source. There must be:

- no V15/V16 compatibility or migration branch used by active production code;
- no top-level node `lineWidth` reads/writes; `pattern.lineWidth` is explicitly allowed;
- no `fill.value` reads/writes;
- no 500ms/history-time comparison;
- no duplicate image inversion implementation outside `binary-image.js`;
- no duplicate transformed box-corner calculation outside `selection-geometry.js`;
- no TODO/debug/temporary console output added by this refactor.

If the audit finds a violation, add a regression assertion where practical, fix it in the owning module, and rerun Steps 2–5.

- [ ] **Step 7: Commit the integration test/audit fixes**

```bash
git add tests/v17-editor-e2e.spec.js <any owning files changed by verified integration fixes>
git commit -m "test: cover V17 editor end to end"
```

- [ ] **Step 8: Open/review the branch PR and verify branch CI**

Confirm the branch is based on current `main`, is not behind, and GitHub Actions reports the same dev/build/preview success. Do not merge if branch CI differs from local/branch evidence.

- [ ] **Step 9: Squash merge to `main` and verify post-merge delivery**

Use squash merge so `main` receives exactly one formal commit for this refactor. Verify the resulting `main` workflow and GitHub Pages build/deploy both succeed before claiming completion.
