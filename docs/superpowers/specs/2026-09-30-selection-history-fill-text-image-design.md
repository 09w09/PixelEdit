# PixelEdit V17 Selection, History, Text, Fill, and Image Design

## Status

Approved in-chat design, written specification pending user review.

## Intent

This refactor fixes a cluster of interaction and rendering bugs while removing remaining model/UI inconsistencies introduced by the V16 transition. The goal is not to patch each symptom independently, but to consolidate selection geometry, command coalescing, tool defaults, fill/stroke semantics, text tooling, font actions, and image binary conversion into shared primitives with complete regression coverage.

Success means:

- transformed selections always draw, hit-test, resize, and preview from one canonical geometry model;
- the browser-native context menu never appears anywhere inside PixelEdit;
- text creation has persistent font and size defaults;
- font import/remove actions are compact and consistent;
- image inversion is correct and identical across threshold/dither/preview/export paths;
- repeated edits of the same semantic operation coalesce into one history entry until a real operation boundary occurs;
- fillable shapes support black/white solid fill at creation and editing time;
- stroke controls are grouped consistently;
- the project format is breaking and has no compatibility/migration layer;
- the whole application is re-tested, not only the changed paths.

## Non-goals

- No compatibility with older `.pix` project versions.
- No migration of deprecated model fields.
- No new scene-graph/group abstraction beyond what is required for the requested behavior.
- No arbitrary custom dash editor.
- No extra fill-color semantics for dither or pattern modes.
- No source-image RGB inversion mode; inversion is a final 1-bit operation only.

## Versioning

This is a breaking model cleanup. The project format advances from V16 to **V17**.

Opening any project whose version is not V17 must fail explicitly. There is no conversion path for V16 or earlier files.

The V17 model removes remaining deprecated fields rather than preserving fallbacks. In particular, production paths must not depend on legacy `lineWidth`, `fill.value`, or old V15/V16 compatibility branches.

## 1. Canonical Selection Geometry

### Problem

The current transformed box overlay mixes two different corner orders. Semantic handles are ordered `NW, NE, SW, SE`, while an SVG polygon needs perimeter order `NW, NE, SE, SW`. Reusing handle order for polygon drawing produces the crossed "bow-tie/X" outline visible after mirror/rotation operations.

The deeper issue is duplicated geometry logic between selection rendering, transforms, resize hit testing, and visual bounds.

### Design

Introduce a shared selection geometry module that derives all editor-facing selection geometry from the same node transform.

Conceptual API:

```js
SelectionGeometry = {
  outline(node),          // perimeter order: NW -> NE -> SE -> SW
  handles(node),          // semantic handles keyed NW/NE/SW/SE
  controlPoints(node),    // line endpoints / polygon vertices
  visualBounds(node),     // transformed AABB for arrange operations
  localToWorld(node, p),
  worldToLocal(node, p),
}
```

Rules:

- Box outlines always use clockwise perimeter order.
- Handle semantics are independent from outline order.
- `line` and `polygon` control points use the same transform matrix as rendering.
- Hit testing uses world-to-local mapping rather than duplicating transformed coordinates.
- Resize uses the same semantic handle map before mapping pointer input back to local coordinates.
- Move preview uses the canonical world geometry plus preview translation.
- Multi-selection may still use an aggregate bounds rectangle where appropriate, but individual transformed nodes must never fall back to an incorrect source-axis box.

The following combinations must remain correct:

- identity;
- horizontal flip;
- vertical flip;
- horizontal + vertical flip;
- 90°/180°/270°;
- arbitrary angle;
- rotate then flip;
- flip then rotate;
- repeated transform composition.

## 2. Global Native Context Menu Suppression

PixelEdit owns right-click behavior while the application is active.

A single document-level `contextmenu` boundary must call `preventDefault()` for every event inside the editor document.

Behavior by region:

- Canvas/stage: show PixelEdit context menu when applicable.
- Layer dock: show the same PixelEdit context-command registry when applicable.
- All other areas: suppress the browser-native menu and show no replacement menu.

This includes toolbar, tool-options row, sidebars, properties, history, status bar, inputs, selects, textareas, rulers, splitters, and blank workspace areas.

This suppression must not interfere with left-click interaction, keyboard editing, or Ctrl/Cmd-based copy/paste shortcuts.

## 3. Text Tool Creation Defaults

The text tool gains creation-time properties in the second toolbar row:

```text
Font [select]
Size [number]
```

These are editor preferences, not project content, and are persisted in the V17 localStorage preference namespace.

Conceptual preference state:

```js
tools.text = {
  fontFamily,
  fontSize,
  lastScalableFontSize,
}
```

Rules:

- Changing text tool defaults affects newly created text only.
- Existing text nodes are not modified.
- The tool and element property panels consume one shared font-option provider.
- Imported fonts are immediately available in the text tool selector after import.
- Removing an imported font updates both selectors.

### Fixed-size font behavior

When the chosen font record has a fixed size:

- the size field shows that fixed size;
- the size field is disabled;
- new text nodes receive the font's fixed size.

When switching back to a scalable font:

- the size field is enabled;
- the previous scalable size is restored from `lastScalableFontSize`.

## 4. Font Action Layout

In text element properties:

```text
[Import font] [Remove current font]
```

must appear on one row.

Button wording changes from `导入字体（可多选）` to `导入字体`. The underlying file input remains multi-select.

`移除当前字体` is visible only when all selected text elements share the same imported font family. It follows existing locking rules.

Removing an imported font keeps the existing semantic behavior: affected text nodes fall back to the default scalable font while preserving an effective size.

## 5. Unified Final 1-bit Image Inversion

### Required semantic

Image inversion acts only after the image has been converted to its final 1-bit representation.

Pipeline:

```text
source RGBA
  -> crop / fit / resize / interpolation
  -> binary conversion
       -> threshold
       OR
       -> Bayer / Blue Noise / Floyd-Steinberg / Atkinson
  -> final binary invert (optional)
  -> framebuffer composition
```

The inversion rule is:

- black -> white;
- white -> black;
- transparent -> transparent.

`invert` must not independently alter source RGB values or alpha.

### Shared implementation

Threshold and dither conversion must output the same binary-result structure or compatible binary+coverage representation. A single final inversion helper is then applied.

Preview, editor framebuffer rendering, subtree rendering, transform-runtime rendering, and exported PNG must all consume the same binary result. No path may independently re-implement inversion.

This specifically prevents double-inversion or mismatched logic between threshold and dither branches.

## 6. Semantic History Coalescing

### Problem

The existing command bus merges only when two commands share `mergeKey` and arrive within 500 ms. This makes history dependent on typing/click speed and does not express the actual semantic editing session.

### Required behavior

Repeated commands merge indefinitely while they are still the same continuous semantic operation on the same targets/property channel.

Example:

```text
move selection A/B by +1
move selection A/B by +1
move selection A/B by +1
```

produces one history entry representing original state -> final state.

### Merge identity

Every mergeable command exposes a stable merge descriptor such as:

```js
{
  operation: 'move',
  targets: ['a', 'b'],
  channel: 'geometry'
}
```

or

```js
{
  operation: 'property',
  targets: ['a'],
  channel: 'x'
}
```

Commands merge only if their normalized descriptors match exactly and no semantic boundary has occurred.

There is **no time window**.

### Required merge boundaries

The active coalescing chain is broken by any of the following:

- selection change;
- page change;
- tool change;
- any nonmatching command;
- create;
- delete;
- paste;
- import;
- transform action of another kind;
- Undo;
- Redo;
- history jump;
- project open/new/reset.

A matching command after one of these boundaries starts a new history entry.

### Examples

- X: 10 -> 20 -> 30: one history entry.
- X changes followed by Y changes: two entries.
- move followed by rotate: two entries.
- three arrow nudges on the same selection/direction channel: one entry.
- same movement after changing selection: new entry.
- edit after Undo truncates the redo branch as today, and begins a new merge chain.

The command bus owns merge-state continuity; UI controls do not run independent timers.

## 7. V17 Fill Model

### Model

All fillable elements use:

```js
fill: {
  mode: 'transparent' | 'solid' | 'dither' | 'pattern',
  color: 0 | 1,
}
```

`color` is meaningful only when `mode === 'solid'`.

No `fill.value` compatibility alias remains.

Page background uses the same field naming:

```js
fill: {
  mode: 'solid' | 'dither' | 'pattern',
  color: 0 | 1,
}
```

A page can never use transparent fill.

### Tool properties

For rectangle, circle, and polygon creation:

```text
Stroke
  Width
  Color
  Style

Fill
  Type: Transparent / Solid
  Color: Black / White   (enabled only for Solid)
```

Dither and pattern are intentionally not exposed as creation defaults in the second toolbar row.

Line has stroke only.

### Element properties

For rectangle, circle, and polygon:

```text
Stroke
  Width
  Color
  Style

Fill
  Type: Transparent / Solid / Dither / Pattern
  Color: Black / White   (only for Solid)
```

Dither/pattern controls appear only for their matching modes.

Text retains its existing fill semantics but follows the normalized fill object where applicable.

## 8. Stroke Property Grouping

All shape element property panels use one explicit `描边` section containing:

- 线宽;
- 颜色;
- 样式.

Line geometry coordinates remain in a separate `直线` section.

Rectangle corner radii remain in `圆角`.

Polygon vertex editing remains in `多边形`.

No line width field is left in geometry sections.

The canonical node shape style remains:

```js
stroke: {
  width,
  color,
  style,
}
```

## 9. Refactor Boundaries

The implementation should consolidate rather than add more independent runtime patches.

Expected responsibilities:

```text
src/selection/
  selection-geometry.js        canonical outlines, handles, hit/resize mapping

src/history/
  command-coalescing.js        normalized merge identity / boundary state

src/tools/
  text-tool-options.js         text creation defaults UI
  shape-style-options.js       stroke/fill creation controls

src/rendering/
  binary-image.js              binary conversion + final invert

src/properties/
  shape-style-properties.js    stroke/fill grouping
  text-font-actions.js         font button row / shared font provider

src/ui/
  context-menu-boundary.js     global native-menu suppression
```

Exact file names may be adjusted during implementation if the repository's current module boundaries make a nearby placement cleaner, but each responsibility must have one canonical implementation rather than duplicated overrides.

## 10. Testing Strategy

Testing is whole-application regression, not a changed-code-only pass.

### Selection geometry matrix

For rectangle, circle, text, image, and raster nodes, cover:

- identity;
- horizontal flip;
- vertical flip;
- both flips;
- 90/180/270;
- arbitrary angle;
- rotate then flip;
- flip then rotate.

Validate:

- outline does not self-intersect;
- handle semantic positions;
- hit testing;
- resize mapping;
- move preview;
- transformed visual bounds;
- Undo/Redo round trip.

Line and polygon must additionally validate transformed endpoint/vertex handles.

### Native context menu

Dispatch `contextmenu` against:

- document/body;
- global toolbar;
- second toolbar;
- tool dock;
- canvas/stage;
- layer dock;
- properties;
- history;
- status bar;
- input;
- select;
- textarea;
- blank workspace/ruler/splitter areas.

Every event must have native behavior prevented. Canvas/layer dock must still expose the PixelEdit menu through the shared command registry.

### Text tools/fonts

Cover:

- scalable built-in font;
- imported scalable font;
- imported fixed-size font;
- switching fixed -> scalable restores last scalable size;
- new text snapshots tool defaults;
- changing tool defaults does not mutate existing text;
- import/remove actions share one row;
- imported font appears/disappears in both creation and element selectors.

### Image inversion

For threshold and every supported dither algorithm:

- normal output;
- inverted output;
- all-white source;
- all-black source;
- grayscale source;
- transparent pixels remain transparent;
- preview == framebuffer == exported PNG binary result.

### History coalescing

Cover:

- three repeated moves -> one entry;
- repeated property X updates -> one entry;
- X then Y -> two entries;
- move then rotate -> two entries;
- selection change breaks chain;
- page change breaks chain;
- tool change breaks chain;
- create/delete/paste breaks chain;
- Undo/Redo breaks chain;
- Undo then edit truncates redo branch and starts a new chain;
- slow repeated matching operations still merge because there is no time window.

### Stroke/fill combinatorics

For rectangle, circle, polygon:

- stroke black/white;
- all five stroke styles;
- representative widths including 1 and >1;
- transparent fill;
- solid black fill;
- solid white fill;
- dither fill in element properties;
- pattern fill in element properties.

Line covers the stroke matrix only.

### Full regression gate

Before completion:

1. run the entire Playwright suite against Vite dev;
2. run the production build;
3. run the entire Playwright suite against production preview;
4. add a cross-subsystem E2E exercising transform -> history merge -> shape fill -> text defaults -> image inversion -> context menu -> save/load/export;
5. inspect the branch diff for legacy compatibility fallbacks, TODO/debug output, and duplicated implementation paths;
6. verify GitHub Actions;
7. after squash merge, rerun/verify `main` CI and Pages deployment.

## 11. Delivery / Git Strategy

Implementation occurs on `refactor/selection-history-fill-text-image` with small task-level commits and RED/GREEN evidence.

The final integration into `main` must use squash merge so `main` receives exactly one formal code commit for this refactor.

## Acceptance Criteria

The work is accepted only when all of the following are true:

- the screenshot's mirrored-selection outline bug is eliminated for all transform compositions;
- browser-native context menus never appear anywhere in PixelEdit;
- text tool font/size defaults work, persist locally, and respect fixed-size fonts;
- font import/remove actions are on one row and use the requested wording;
- image invert is a single final binary operation and works for all conversion modes;
- semantic repeated operations coalesce without a timeout and break only at explicit operation boundaries;
- fillable shapes support solid black/white creation defaults and editable solid fill color;
- stroke fields are consistently grouped;
- V17 has no old-project migration/compatibility path;
- all dev and production-preview tests pass, including full existing regression coverage and new branch/E2E coverage;
- `main` receives one squash commit and Pages deploy succeeds.
