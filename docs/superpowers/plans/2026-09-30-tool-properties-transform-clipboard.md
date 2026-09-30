# PixelEdit Tool Properties, Transform, Transparency, and Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PixelEdit V16 with separate global/tool/element controls, deterministic stroke styling, editable transforms, tri-state raster transparency, structured cross-page clipboard behavior, newest-first history, and local-only editor preferences.

**Architecture:** Keep `index.html` as the existing application shell/core while moving every new reusable responsibility into focused ES modules installed from `src/main.js`. V16 is a deliberate breaking project format: artwork state stays in `.pix`, editor/workspace preferences move to a V16 localStorage namespace, and no V15 migration branches remain. Rendering, hit testing, selection geometry, commands, clipboard, and raster editing share canonical transform/stroke/raster helpers instead of maintaining parallel math.

**Tech Stack:** Vite 7, vanilla HTML/CSS/ES modules, Canvas 2D, SVG overlay, localStorage, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-tool-properties-transform-clipboard-design.md`

## Global Constraints

- Project format is exactly V16; projects whose `version !== 16` are rejected with a clear incompatibility error.
- Do not add a V15-to-V16 project migration or dual-format compatibility path.
- Document size remains exactly 400×300; exported framebuffer/PNG remains opaque black/white.
- Raster pixels use exactly three meaningful states: transparent, white, black; `11` stays reserved in packed storage.
- Page/background pixels are never transparent; erasing the page writes white.
- Transparency preview is a uniform translucent light-blue editor overlay only for the currently selected raster; no dots/checker pattern.
- Tool defaults, dock widths/splits, and transparency-preview preference are local editor state and never serialize into `.pix` or mark the project dirty.
- Pointer/select own alignment, distribution, flip, 90° rotation, and arbitrary delta-rotation commands.
- Stroke styles are exactly `solid`, `short-dash`, `long-dash`, `dot`, `dash-dot`; gaps are transparent/no-op, not white.
- Single-element transforms use its visual center; multi-selection transforms use the union visual-bounds center and preserve relative layout.
- Locked nodes may be selected but every mutating batch operation skips them.
- First paste after copy keeps original coordinates; repeated pastes offset cumulatively by `+8,+8`.
- Final verification runs the complete Playwright suite against both Vite dev and production `dist/` preview.
- Do not add a UI framework or external icon package; toolbar icons are inline SVG.

## Review Focus

- Corrupt, missing, or out-of-range V16 localStorage preferences must fall back/clamp safely without dirtying artwork; Task 1 adds malformed-storage and splitter-boundary tests.
- Arbitrary rotation near canvas boundaries, repeated 90° rotations, mixed locked/unlocked selections, and transformed raster painting must use one canonical inverse/forward transform path; Tasks 5 and 6 pin these cases.
- Transparent and white raster pixels must remain observably different through paint, erase, resize, serialization, preview, compositing, and export; Task 4 tests every boundary.
- Dashed closed contours and even-width strokes must keep deterministic phase/coverage and must not turn dash gaps into white paint; Task 3 adds line/rectangle/circle/polygon pixel tests.
- Nested parent/child selections, cross-page paste, resource references, repeated paste offsets, and context-menu selection preservation must not duplicate descendants or create dangling IDs; Task 7 adds end-to-end hierarchy tests.

---

### Task 1: Establish V16 project boundaries and local editor preferences

**Files:**
- Create: `src/preferences/editor-preferences.js`
- Modify: `src/main.js`
- Modify: `index.html` project model/serializer/autosave/workspace-layout integration
- Create: `tests/v16-preferences.spec.js`
- Modify: `tests/core-regression.spec.js`

**Interfaces:**
- `PREFERENCE_KEY = 'pixeledit:v16:preferences'`.
- `defaultEditorPreferences() -> { workspace:{leftWidth,rightWidth,leftSplit,rightSplit}, tools:{...}, transparencyPreview:boolean }`.
- `loadEditorPreferences(storage=localStorage) -> preferences` parses, validates, merges defaults, and clamps layout values.
- `saveEditorPreferences(preferences, storage=localStorage) -> boolean` writes only the V16 preference key and returns false rather than throwing when storage is unavailable.
- `updateEditorPreferences(current, patch) -> preferences` returns a normalized copy.
- Project model: `project.version === 16`, width `400`, height `300`, and no `workspaceLayout` property.
- Autosave key becomes `pixel-editor-v16-autosave`; default filename becomes `pixel-project-v16.pix`.
- `Workspace.editorPreferences` owns local preferences; `applyLayout()` reads `editorPreferences.workspace` only.

- [ ] **Step 1: Write failing V16/preferences tests**

Create `tests/v16-preferences.spec.js` covering: new projects serialize as V16; serialized JSON has no `workspaceLayout`; a V15 fixture is rejected; a V16 file loads; splitter changes survive reload through `pixeledit:v16:preferences`; splitter changes leave `state.dirty` unchanged; malformed JSON falls back to defaults; widths outside supported bounds clamp to `170..520`; split ratios preserve the existing minimum-pane constraint; old V15 preference/autosave keys are ignored.

- [ ] **Step 2: Run the new test and verify current behavior fails**

Run: `npx playwright test tests/v16-preferences.spec.js`
Expected: FAIL because current project is V15 and layout lives in `project.workspaceLayout`.

- [ ] **Step 3: Implement `src/preferences/editor-preferences.js` and install it from `src/main.js`**

Export the interfaces above. The module must not mutate project state and must tolerate missing/throwing storage.

- [ ] **Step 4: Convert inline project/persistence/workspace layout code to V16**

Update `PixelEditor.version`, status/title/test API version, serializer validation, ProjectFiles suggested names, Autosave key, and workspace splitters. Remove `defaultWorkspaceLayout()` and every project read/write of `workspaceLayout`; splitter pointer moves save preferences but do not call a project command and do not set dirty.

- [ ] **Step 5: Run V16 plus core regression**

Run: `npx playwright test tests/v16-preferences.spec.js tests/core-regression.spec.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/preferences/editor-preferences.js src/main.js index.html tests/v16-preferences.spec.js tests/core-regression.spec.js
git commit -m "refactor: separate V16 project and editor preferences"
```

### Task 2: Add the two-row toolbar and persistent per-tool creation defaults

**Files:**
- Create: `src/tools/tool-state.js`
- Create: `src/tools/tool-options-bar.js`
- Create: `src/ui/icon-toolbar.js`
- Modify: `src/main.js`
- Modify: `index.html` toolbar markup/CSS, Properties title, Workspace setup/setTool integration
- Create: `tests/tool-options.spec.js`

**Interfaces:**
- `toolDefaults(preferences, tool) -> normalized tool settings`.
- `setToolDefault(preferences, tool, key, value) -> preferences` writes through Task 1 preference persistence.
- Tool defaults exactly: pencil `{width:1,color:1}`, eraser `{width:1}`, and line/rectangle/circle/polygon `{width:1,color:1,style:'solid'}`.
- `installToolOptionsBar(workspace, rootElement)` renders controls for the active tool and exposes `render()`/`destroy()`.
- `iconButton({ action, title, svg, pressed? }) -> HTMLElement` creates an icon-only control with `title` and `aria-label`; toggle controls also set `aria-pressed`.
- Row 1 keeps New/Open/Save/Export PNG/Undo/Redo/transparency-preview/Zoom only.
- Row 2 shows selection commands for pointer/select, pencil properties, eraser width, or stroke defaults for line/rectangle/circle/polygon.
- Right dock title changes from `属性` to `元素属性`.

- [ ] **Step 1: Write failing toolbar/tool-state tests**

Create `tests/tool-options.spec.js` asserting: two toolbar rows exist; row 1 has no align/distribute actions; all alignment/distribution/transform controls are icon-only and expose exact human-readable titles; switching tools changes row-2 controls; changing line defaults does not mutate an existing line; switching away/back preserves defaults; browser reload restores defaults; image/text do not show unrelated shape controls; pointer/select show alignment/distribution/flip/rotation controls.

- [ ] **Step 2: Run the test and verify failure**

Run: `npx playwright test tests/tool-options.spec.js`
Expected: FAIL because alignment is currently text buttons in row 1 and no tool-state subsystem exists.

- [ ] **Step 3: Implement tool state and icon helpers**

Wire `tool-state.js` to the preference service from Task 1. Use inline SVG only; no external asset dependency.

- [ ] **Step 4: Replace the one-row toolbar with global row + tool-options row**

Update `.app` grid rows, keep both rows horizontally usable at narrow widths, and have `Workspace.setTool(tool)` re-render row 2. Creation code for pencil/eraser/line/rectangle/circle/polygon reads current tool defaults at gesture start so later preference changes do not retroactively alter a gesture/node.

- [ ] **Step 5: Run toolbar and core regression**

Run: `npx playwright test tests/tool-options.spec.js tests/core-regression.spec.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools src/ui/icon-toolbar.js src/main.js index.html tests/tool-options.spec.js
git commit -m "feat: separate global and tool option controls"
```

### Task 3: Replace legacy line width fields with the unified deterministic stroke model

**Files:**
- Create: `src/rendering/stroke-style.js`
- Modify: `src/rendering/pixel-stroke.js`
- Modify: `src/main.js`
- Modify: `index.html` createNode, framebuffer/vector renderer, Properties integration
- Create: `tests/stroke-style.spec.js`
- Modify: `tests/line-stroke.spec.js`
- Modify: `tests/core-regression.spec.js`

**Interfaces:**
- Stroke shape: `{ width:number, color:0|1, style:'solid'|'short-dash'|'long-dash'|'dot'|'dash-dot' }`.
- `normalizeStroke(stroke) -> stroke` clamps width to the editor-supported positive integer range and validates enum/color.
- `strokePattern(style) -> number[]|null` returns logical on/off run lengths; exact presets are fixed in this task and shared by every primitive.
- `forEachStyledPathPoint(points, style, callback)` applies one continuous phase over an ordered path; closed shape contours must not restart dash phase on each edge.
- Existing `forEachStrokePixel(...)` remains the authoritative exact-width coverage expansion and accepts the selected stroke color at compositing time.
- V16 line/rectangle/circle/polygon nodes contain `stroke` and do not contain top-level `lineWidth`.

- [ ] **Step 1: Write failing stroke-model/render tests**

Create `tests/stroke-style.spec.js` to assert all five styles for line/rectangle/circle/polygon; black and white strokes; widths 1, 2, 3, and 4; dash gaps preserve the lower layer rather than painting white; closed contours keep continuous dash phase across corners; element Properties modify `stroke.width/color/style`; newly created nodes inherit Task 2 defaults; serialized V16 nodes have no `lineWidth`.

- [ ] **Step 2: Run stroke tests and verify failure**

Run: `npx playwright test tests/stroke-style.spec.js tests/line-stroke.spec.js`
Expected: FAIL on color/style/model cases while existing exact-width line tests remain a regression reference.

- [ ] **Step 3: Implement shared stroke-style helpers and integrate primitive rendering**

Choose and freeze logical run lengths in `strokePattern()` for `short-dash`, `long-dash`, `dot`, and `dash-dot`; use the same helper for every primitive. White is an opaque stroke color; a dash gap has no coverage.

- [ ] **Step 4: Replace V16 node/property creation fields**

Delete `lineWidth` from V16 `createNode()` branches and Properties controls. Do not add a fallback reader for V15 `lineWidth`.

- [ ] **Step 5: Run stroke/core tests**

Run: `npx playwright test tests/stroke-style.spec.js tests/line-stroke.spec.js tests/core-regression.spec.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/rendering/stroke-style.js src/rendering/pixel-stroke.js src/main.js index.html tests/stroke-style.spec.js tests/line-stroke.spec.js tests/core-regression.spec.js
git commit -m "feat: add unified pixel stroke styles"
```

### Task 4: Replace binary raster data with tri-state pixels and selected-raster transparency preview

**Files:**
- Create: `src/raster/tristate-raster.js`
- Create: `src/rendering/transparency-overlay.js`
- Modify: `src/media/raster-layer.js`
- Modify: `src/media/raster-sizing.js`
- Modify: `src/rendering/selection-overlay.js`
- Modify: `src/main.js`
- Modify: `index.html` framebuffer/compositing, paint gesture, row-1 preview toggle integration
- Create: `tests/tristate-raster.spec.js`
- Modify: `tests/raster-editing.spec.js`
- Modify: `tests/raster-branches.spec.js`
- Modify: `tests/raster-mixed.spec.js`

**Interfaces:**
- Constants: `RASTER_TRANSPARENT=0`, `RASTER_WHITE=1`, `RASTER_BLACK=2`, `RASTER_ENCODING='tristate-packed-v1'`.
- `encodeTriStatePixels(Uint8Array) -> string` packs four 2-bit pixels per byte.
- `decodeTriStatePixels(data,w,h) -> Uint8Array` returns exactly `w*h` state values and rejects/normalizes reserved `3` according to a single explicit validation rule.
- `createTriStateRaster(w,h,pixels?, defaultValue=RASTER_TRANSPARENT) -> {encoding,data}`.
- `paintTriStateRaster(node, points, value) -> rasterPayload`.
- `resizeTriStateRaster(node, geometry) -> {x,y,w,h,raster}` preserves/crops/translates states without interpolation; newly exposed raster area is transparent.
- `rasterPixelToComposite(state) -> {covered:boolean,color:0|1}` where transparent is uncovered, white is covered/color 0, black is covered/color 1.
- `transparencyPreviewRects(node, transform?)` or equivalent helper returns only transparent pixel coverage for editor overlay rendering; overlay color is one uniform light blue with alpha and never enters framebuffer/export.

- [ ] **Step 1: Write failing tri-state tests**

Create `tests/tristate-raster.spec.js` asserting exact pack/unpack round-trip; white differs from transparent; black/white pencil writes opaque states; eraser on raster writes transparent; eraser on page writes white; page never stores transparent; resize/crop preserves all three states; new resize area is transparent; serialization round-trip is byte-identical; selected raster preview shows uniform translucent blue only over transparent pixels; unselected raster and disabled toggle show no blue; framebuffer/export remains opaque binary.

- [ ] **Step 2: Run raster tests and verify current binary model fails**

Run: `npx playwright test tests/tristate-raster.spec.js tests/raster-editing.spec.js tests/raster-branches.spec.js tests/raster-mixed.spec.js`
Expected: FAIL on transparency/white distinction and preview.

- [ ] **Step 3: Implement packed tri-state storage and remove binary compatibility paths**

`src/media/raster-layer.js` must stop accepting `bitset-base64-v1`; V16 raster creation accepts only `tristate-packed-v1`. Replace the current opaque-image adaptation semantics with coverage-aware compositing so transparent pixels reveal lower nodes and white pixels actively cover lower black pixels.

- [ ] **Step 4: Integrate pencil/eraser semantics and page exception**

Pencil reads Task 2 color (`0` maps to `RASTER_WHITE`, `1` maps to `RASTER_BLACK`). Raster eraser writes transparent. Page/background paint retains its opaque black/white representation and eraser explicitly writes white.

- [ ] **Step 5: Implement selected-raster transparency overlay and row-1 toggle**

Store only the boolean preference from Task 1. Overlay is a single translucent light-blue fill per transparent pixel/merged region; it must use editor overlay DOM/SVG/canvas state rather than framebuffer data.

- [ ] **Step 6: Run all raster plus core regression tests**

Run: `npx playwright test tests/tristate-raster.spec.js tests/raster-editing.spec.js tests/raster-branches.spec.js tests/raster-mixed.spec.js tests/core-regression.spec.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/raster src/rendering/transparency-overlay.js src/rendering/selection-overlay.js src/media/raster-layer.js src/media/raster-sizing.js src/main.js index.html tests
git commit -m "feat: add tri-state raster transparency"
```

### Task 5: Introduce one canonical editable transform model for every visual node

**Files:**
- Create: `src/transforms/transform-model.js`
- Modify: `src/rendering/selection-overlay.js`
- Modify: `src/rendering/text-layout.js` only where transformed bounds integration is required
- Modify: `src/media/image-runtime.js` only where transformed rendering integration is required
- Modify: `src/main.js`
- Modify: `index.html` createNode, FramebufferRenderer, HitTest, SnapEngine/visualBounds integration
- Create: `tests/transform-model.spec.js`
- Modify: `tests/selection-overlay.spec.js`
- Modify: `tests/selection-points.spec.js`

**Interfaces:**
- Every visual V16 node gets `transform:{ rotation:0, flipX:false, flipY:false }`; translation remains in its existing geometry (`x/y`, line endpoints, polygon points) rather than duplicated in transform state.
- `nodeLocalBounds(node, assets?) -> {x,y,w,h}` returns untransformed source bounds in document coordinates.
- `nodeTransformMatrix(node, bounds?) -> DOMMatrix-compatible six-number affine representation` rotates/flips around the node visual center.
- `transformPoint(matrix,{x,y}) -> {x,y}` and `inverseTransformPoint(matrix,{x,y}) -> {x,y}` are the only point-conversion primitives used by render/hit/edit code.
- `transformedBounds(node, assets?) -> {x,y,w,h}` returns world-axis-aligned bounds of transformed visible geometry.
- `normalizeRotation(deg) -> number` keeps a stable canonical range and avoids cumulative 360° drift.
- Rendering rasterizes at final 400×300 pixel resolution but never replaces source node type merely because rotation is non-zero.

- [ ] **Step 1: Write failing transform-model tests**

Create `tests/transform-model.spec.js` covering rectangle/circle/polygon/line/text/image/raster defaults; 90° and arbitrary 23° transformed bounds; flip X/Y; four repeated 90° rotations return to original geometry/orientation; hit testing follows visible transformed position; marquee/intersection and selection overlay use transformed geometry; transformed nodes still expose their normal editable Properties; objects touching/outside canvas edges clip only at framebuffer render, not in model math.

- [ ] **Step 2: Run transform tests and verify failure**

Run: `npx playwright test tests/transform-model.spec.js tests/selection-overlay.spec.js tests/selection-points.spec.js`
Expected: FAIL because current render/hit/overlay math is untransformed.

- [ ] **Step 3: Implement `transform-model.js` and add V16 default transforms**

Do not create type-specific independent rotation algorithms. Lines/polygons may keep their existing source coordinates, but they pass through the same matrix/bounds helpers as box nodes.

- [ ] **Step 4: Route rendering, hit testing, visual bounds, overlay, snapping, marquee, export, and subtree rasterization through canonical transform helpers**

Keep source geometry editable. Ensure white strokes/fills and source image/text coverage still composite correctly after transformation.

- [ ] **Step 5: Run transform, selection, media, text, and core regression tests**

Run: `npx playwright test tests/transform-model.spec.js tests/selection-overlay.spec.js tests/selection-points.spec.js tests/text-layout.spec.js tests/svg-vector.spec.js tests/core-regression.spec.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/transforms/transform-model.js src/rendering src/media src/main.js index.html tests/transform-model.spec.js tests/selection-overlay.spec.js tests/selection-points.spec.js
git commit -m "feat: add editable element transforms"
```

### Task 6: Add group transform/alignment commands and transformed-raster editing

**Files:**
- Create: `src/transforms/selection-transform.js`
- Modify: `src/media/raster-layer.js`
- Modify: `src/tools/tool-options-bar.js`
- Modify: `src/main.js`
- Modify: `index.html` commands, Workspace transform actions, alignment/distribution integration
- Create: `tests/selection-transform.spec.js`
- Modify: `tests/raster-editing.spec.js`
- Modify: `tests/edit-boundaries.spec.js`

**Interfaces:**
- `modifiableSelectionRoots(page, selectionIds) -> string[]` removes descendant duplicates and every effectively locked root/subtree from mutation targets.
- `selectionVisualBounds(project,pageId,ids,assets) -> bounds|null` uses Task 5 transformed bounds.
- `rotateSelection(project,pageId,ids,deltaDegrees,assets) -> node patches` rotates the group around union-bounds center and updates each node position/orientation.
- `flipSelection(project,pageId,ids,axis,assets) -> node patches` flips around group center.
- `alignSelection(..., mode) -> node patches` supports left/hcenter/right/top/vcenter/bottom using transformed visual bounds.
- `distributeSelection(..., axis) -> node patches` requires at least three modifiable roots.
- `screenPointToRasterPixel(node, point) -> {x,y}|null` inverse-transforms through Task 5 and maps to the raster's untransformed local pixel grid.
- Selection commands create one undoable history entry per user action; no-op/insufficient selections create none.

- [ ] **Step 1: Write failing selection-transform tests**

Create `tests/selection-transform.spec.js` asserting: single node rotates around self; two left/right nodes become top/bottom after 90° group rotation; arbitrary 23° is a delta; horizontal/vertical group flips preserve spacing around group center; align/distribute use transformed bounds; one locked + one unlocked selection mutates only unlocked; all-locked and too-small selections are disabled/no-op without history; undo/redo restores whole batch atomically.

- [ ] **Step 2: Add failing transformed-raster paint tests**

Extend `tests/raster-editing.spec.js`: rotate raster 90° and 23°, paint/erase at visible screen coordinates, then assert the intended local pixel changed through inverse mapping; test an edge pixel and a point outside the transformed raster.

- [ ] **Step 3: Run tests and verify failure**

Run: `npx playwright test tests/selection-transform.spec.js tests/raster-editing.spec.js tests/edit-boundaries.spec.js`
Expected: FAIL because commands and raster painting do not yet share transform math.

- [ ] **Step 4: Implement selection transforms and replace old align/distribute geometry**

Wire pointer/select row-2 controls to these commands, including numeric arbitrary delta input. Disable commands when their modifiable selection cardinality is insufficient.

- [ ] **Step 5: Inverse-transform raster editing coordinates**

Update raster paint gesture mapping only; do not bake the transform into raster data and do not resample the raster merely to edit it.

- [ ] **Step 6: Run transform/raster/selection regressions**

Run: `npx playwright test tests/selection-transform.spec.js tests/transform-model.spec.js tests/raster-editing.spec.js tests/edit-boundaries.spec.js tests/selection-overlay.spec.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/transforms/selection-transform.js src/media/raster-layer.js src/tools/tool-options-bar.js src/main.js index.html tests/selection-transform.spec.js tests/raster-editing.spec.js tests/edit-boundaries.spec.js
git commit -m "feat: add group transforms and transformed raster editing"
```

### Task 7: Replace duplicate semantics with structured clipboard, Ctrl+A, and one shared context menu

**Files:**
- Create: `src/clipboard/element-clipboard.js`
- Create: `src/ui/context-menu.js`
- Modify: `src/main.js`
- Modify: `index.html` Clipboard/clipboard commands, keyboard handling, canvas context handling, PageLayerDock integration, context-menu markup
- Create: `tests/clipboard-context.spec.js`
- Modify: `tests/core-regression.spec.js`

**Interfaces:**
- `ElementClipboard.copy({project,pageId,selection,assets}) -> payload` stores outermost selected roots once, complete descendant subtrees, referenced resource IDs/data needed by those nodes, original positions, and resets paste index to `0`.
- `ElementClipboard.nextPaste() -> {payload,offsetIndex}|null` returns `0` for first paste, then `1`, `2`, ... without resetting when active page changes.
- `cloneClipboardPayload(payload,targetPage,{offsetIndex,assets}) -> {nodes,rootIds,idMap}` remaps every node ID/parent link and offsets root subtree geometry by `8*offsetIndex` on each axis.
- `selectAllOnPage(page, selection)` selects every ordinary node ID including hidden/locked nodes and excludes page/background.
- `openContextMenu({source:'canvas'|'layers',nodeId,event})` preserves current multi-selection when `nodeId` is already selected; otherwise selects only that node before opening.
- Canvas and layer dock use the same command registry for Copy/Paste/Delete/Flip X/Flip Y/Rotate CW 90/Rotate CCW 90/Rotate arbitrary/Rasterize and applicable image-only actions.
- User-facing `复制` means copy-to-clipboard only. Remove the context-menu `duplicate` action and remove `Ctrl+D` immediate duplicate behavior. Existing explicit Alt-drag duplication may remain as a separate gesture but must reuse structured clone helpers rather than a second hierarchy algorithm.

- [ ] **Step 1: Write failing clipboard/Ctrl+A/context tests**

Create `tests/clipboard-context.spec.js` covering: Ctrl+A selects visible+hidden+locked ordinary nodes but not background; copying selected parent+child serializes child once; first paste same coordinates; second/third `+8/+16`; switching page preserves clipboard and paste count; pasted hierarchy has fresh IDs and correct parent IDs; referenced image/font/raster resources remain valid; context Copy creates nothing until Paste; right-click selected member preserves multi-selection; right-click unselected node replaces selection; layer-dock and canvas menus expose/execute the same shared commands; delete/transform skip locked selected nodes; undo/redo of one paste/delete is atomic.

- [ ] **Step 2: Run the new test and verify failure**

Run: `npx playwright test tests/clipboard-context.spec.js`
Expected: FAIL because current first paste offsets immediately, context `duplicate` creates a node, canvas right-click always replaces selection, and layer dock has separate/no shared menu.

- [ ] **Step 3: Implement structured clipboard module and replace inline Clipboard/Paste payload logic**

Reuse Task 5/6 geometry helpers for offsets and transformed nodes. Do not duplicate descendants when parent+child are both selected.

- [ ] **Step 4: Add Ctrl+A and change copy/paste keyboard semantics**

Ctrl/Cmd+A executes only when focus is not in editable input/select/textarea/contenteditable. Ctrl/Cmd+C writes the internal clipboard; Ctrl/Cmd+V pastes. Remove Ctrl+D direct duplicate shortcut.

- [ ] **Step 5: Implement one context-menu registry for canvas and Page/Layer dock**

Build enabled/hidden state from current selection and command validity. Context menu actions must call the same command functions used by keyboard/tool options, not reimplement transform/delete logic.

- [ ] **Step 6: Run clipboard/core hierarchy regressions**

Run: `npx playwright test tests/clipboard-context.spec.js tests/core-regression.spec.js tests/raster-branches.spec.js tests/font-management.spec.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/clipboard src/ui/context-menu.js src/main.js index.html tests/clipboard-context.spec.js tests/core-regression.spec.js
git commit -m "feat: unify clipboard and context commands"
```

### Task 8: Reverse history presentation and complete element-properties integration

**Files:**
- Modify: `index.html` HistoryDock and Properties UI
- Modify: `src/tools/tool-options-bar.js` only if command enabled-state refresh needs integration
- Create: `tests/history-properties.spec.js`
- Modify: `tests/tool-options.spec.js`
- Modify: `tests/stroke-style.spec.js`

**Interfaces:**
- `HistoryDock.render()` presents command entries newest-first while preserving the CommandBus's chronological storage/index semantics.
- Clicking/jumping to a displayed history item maps the reversed display index back to the original command index exactly.
- Current history state remains visibly active after undo; redo entries stay visible above/below according to newest-first chronological ordering rather than being discarded by rendering.
- Existing line/rectangle/circle/polygon element Properties show stroke width/color/style; transform-capable nodes expose current rotation/flip state only where an editable property control is useful, without conflating those values with tool defaults.

- [ ] **Step 1: Write failing history/property tests**

Create `tests/history-properties.spec.js`: create three commands and assert newest label is first; undo once leaves all entries visible and highlights the correct state; redo restores highlight; branching after undo follows existing CommandBus semantics but display order remains newest-first; changing selected element stroke/property creates history and does not change Task 2 tool defaults; changing tool defaults creates no command-history entry.

- [ ] **Step 2: Run the new tests and verify failure**

Run: `npx playwright test tests/history-properties.spec.js tests/tool-options.spec.js tests/stroke-style.spec.js`
Expected: FAIL on history ordering and any incomplete property separation.

- [ ] **Step 3: Reverse HistoryDock presentation without reversing CommandBus storage**

Keep command execution data chronological internally; reverse only the render mapping and all click/highlight index conversions.

- [ ] **Step 4: Finish Properties/UI enabled-state integration**

Ensure selected-element edits are undoable artwork state, tool preference edits are not history, and row-2 command enabled states refresh when selection/lock state changes.

- [ ] **Step 5: Run history/tool/stroke/core tests**

Run: `npx playwright test tests/history-properties.spec.js tests/tool-options.spec.js tests/stroke-style.spec.js tests/core-regression.spec.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html src/tools/tool-options-bar.js tests/history-properties.spec.js tests/tool-options.spec.js tests/stroke-style.spec.js
git commit -m "refactor: separate history and element property state"
```

### Task 9: Full workflow regression, production verification, and release-ready branch

**Files:**
- Create: `tests/v16-full-workflow.spec.js`
- Modify: any tests/code only for defects uncovered by full regression
- Modify: `.github/workflows/ci.yml` only if it does not already run the complete dev + build + production-preview suite
- Modify: `.github/workflows/pages.yml` only if deployment verification requires the same production build path

**Interfaces:**
- One end-to-end V16 workflow must exercise creation defaults → styled vector → tri-state raster → transform → multi-select → copy across pages → undo/redo → save/deserialize → export.
- `npm test` is the authoritative complete dev-browser suite.
- `npm run build` must produce `dist/` without warnings/errors that indicate broken assets/modules.
- `npm run test:preview` is the authoritative complete production-preview suite.

- [ ] **Step 1: Write the cross-subsystem workflow test**

`tests/v16-full-workflow.spec.js` must: set tool defaults; create styled line/closed shape; create/edit raster with black/white/transparent pixels; enable/disable transparency preview; rotate at least one raster and vector; Ctrl+A with a locked node present; copy a nested subtree; paste on another page twice and verify `0/+8` offsets; undo/redo; serialize and deserialize V16; verify no workspace/tool preferences in JSON; compare framebuffer before/after round-trip; verify PNG alpha is 255 and pixels are black/white only.

- [ ] **Step 2: Run the entire dev suite**

Run: `npm test`
Expected: every Playwright test passes; do not proceed while any test is skipped unexpectedly or failing.

- [ ] **Step 3: Build production output**

Run: `npm run build`
Expected: exit 0 and valid `dist/` output.

- [ ] **Step 4: Run the complete suite against production preview**

Run: `npm run test:preview`
Expected: every Playwright test passes against `dist/`.

- [ ] **Step 5: Inspect project format and local preference boundary manually through test API**

Confirm a saved V16 `.pix` contains artwork/transforms/strokes/raster/assets but no dock layout, tool defaults, or transparency-preview preference. Reload and confirm local preferences survive independently.

- [ ] **Step 6: Commit any final regression test/fix set**

```bash
git add tests/v16-full-workflow.spec.js .github src index.html
git commit -m "test: verify complete PixelEdit V16 workflow"
```

- [ ] **Step 7: Final branch verification before claiming completion**

Run: `npm test && npm run build && npm run test:preview`
Expected: all commands exit 0. Then compare the feature branch against `main` and verify only the approved V16 refactor/spec/plan/test changes are present.

- [ ] **Step 8: Integrate as one formal main commit**

After review approval, squash-merge the feature branch into `main` so the implementation lands as one formal main-branch commit, matching the user's “提交一次代码” requirement. Preserve the detailed task commits on the feature branch/PR history for reviewability.
