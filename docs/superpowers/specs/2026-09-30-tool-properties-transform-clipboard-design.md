# PixelEdit Tool Properties, Transform, Transparency, and Clipboard Refactor Design

## Goal

Refactor PixelEdit so global actions, active-tool options, and selected-element properties are clearly separated; add icon-based alignment/transform controls, editable transforms, deterministic pixel stroke styles, tri-state raster transparency, cross-page clipboard semantics, reverse-chronological history, and local-only workspace/tool preferences.

This is a breaking V16 design. No compatibility or migration layer is required for older `.pix` projects.

## Product Intent

PixelEdit remains a 400×300 black/white pixel editor whose exported framebuffer is strictly binary. The editor may use transparency and colored editing overlays internally, but those are editing semantics only and must not leak into the final framebuffer.

The main interaction model is:

- row 1 = global editor/project actions;
- row 2 = options for the currently active tool;
- right Properties dock = properties of already-created selected elements;
- localStorage = editor preferences and workspace layout;
- `.pix` = artwork/project content only.

## 1. Project Version and Compatibility

The project format becomes V16.

```js
project.version = 16
```

There is no V15-to-V16 migration path.

When opening a project whose version is not exactly 16, PixelEdit rejects it with a clear incompatibility message. It does not attempt to infer old `lineWidth`, old raster data, old workspace layout, or any other legacy fields.

The implementation must remove compatibility branches instead of supporting both models in parallel.

## 2. Two-Row Toolbar Architecture

### 2.1 Global toolbar: row 1

The first toolbar contains only editor/project-wide actions:

- New
- Open
- Save
- Export PNG
- Undo
- Redo
- Toggle transparency preview
- Zoom

Existing alignment/distribution controls are removed from this row.

Action buttons use recognizable SVG icons rather than text where appropriate. Every icon-only control must provide a human-readable tooltip/title, for example:

- Undo
- Redo
- Left align
- Horizontal center align
- Right align
- Top align
- Vertical center align
- Bottom align
- Distribute horizontally
- Distribute vertically
- Flip horizontally
- Flip vertically
- Rotate clockwise 90°
- Rotate counter-clockwise 90°
- Show/Hide transparent pixels

The tooltip is part of the functional requirement, not decorative metadata.

### 2.2 Tool-options toolbar: row 2

A new second toolbar is driven only by the active tool. It edits defaults for future creation or selection-tool commands. It never implicitly edits existing elements unless the active command is explicitly a selection transform/alignment command.

#### Pointer and marquee/select tools

Show:

- left align
- horizontal center align
- right align
- top align
- vertical center align
- bottom align
- horizontal distribute
- vertical distribute
- flip horizontal
- flip vertical
- rotate clockwise 90°
- rotate counter-clockwise 90°
- numeric arbitrary rotation input/action

These controls operate on the current selection only.

#### Pencil

Show:

- width
- color: black or white

#### Eraser

Show:

- width

#### Line

Show:

- stroke width
- stroke color: black or white
- stroke style: solid, short dash, long dash, dot, dash-dot

#### Rectangle / Circle / Polygon

Show the same creation stroke defaults as Line:

- stroke width
- stroke color
- stroke style

Fill settings are intentionally excluded from the tool toolbar. Fill, corners, polygon points, and other object-specific settings remain selected-element properties.

#### Image / Text

No new creation-specific options are required in this phase. Existing creation behavior remains unless changed by another section of this spec.

## 3. Tool State and Local Preferences

Tool defaults are editor preferences, not project content.

Introduce a dedicated tool-state/preferences subsystem. Conceptually:

```js
preferences = {
  workspace: {
    leftWidth: 260,
    rightWidth: 320,
    leftSplit: 0.5,
    rightSplit: 0.5
  },
  tools: {
    pencil: { width: 1, color: 1 },
    eraser: { width: 1 },
    line: { width: 1, color: 1, style: 'solid' },
    rectangle: { width: 1, color: 1, style: 'solid' },
    circle: { width: 1, color: 1, style: 'solid' },
    polygon: { width: 1, color: 1, style: 'solid' }
  },
  transparencyPreview: false
}
```

Preferences are stored under a V16-specific localStorage namespace such as `pixeledit.v16.preferences`. Invalid/corrupt local preference data falls back to defaults; it is not treated as project data and does not trigger project migration.

Preferences survive tool changes, page changes, project changes, and browser restarts.

They do not appear in `.pix` serialization.

### 3.1 Workspace layout moves out of project data

Remove `workspaceLayout` from the project model completely.

Dock widths and upper/lower split ratios are read from and written to local preferences only.

Dragging a dock splitter must no longer make the project dirty or change save-file content.

No migration from project-contained V15 workspace data is required.

## 4. Element Stroke Model

Line, rectangle, circle, and polygon use one shared stroke model:

```js
stroke: {
  width: 1,
  color: 1,
  style: 'solid'
}
```

`color` values:

- `0` = white
- `1` = black

`style` values:

- `solid`
- `short-dash`
- `long-dash`
- `dot`
- `dash-dot`

The legacy top-level `lineWidth` field is removed from V16 nodes.

### 4.1 Stroke rendering

Stroke styles are rasterized deterministically in logical pixel space. Do not rely on browser CSS/SVG dash rendering as the authoritative framebuffer result.

Dashed gaps are transparent/no-op portions of the stroke, not white paint.

White stroke pixels are actual white pixels and therefore cover black pixels from lower layers where normal layer compositing says that element is on top.

Stroke width must retain the exact-width flat-cap behavior already established by the current pixel-stroke implementation.

### 4.2 Existing element properties

The Properties dock for already-created line/rectangle/circle/polygon elements exposes:

- stroke width
- stroke color
- stroke style

Rectangle/circle/polygon retain their existing fill controls. Rectangle retains corners. Polygon retains point editing.

## 5. Editable Transform Model

Rotation and flipping never rasterize an element.

All normal visual node types participate, including vector shapes, lines, text, source images, and raster nodes.

The logical model must preserve source/local geometry separately from the transform.

At minimum expose semantic state equivalent to:

```js
transform: {
  rotation: 0,
  flipX: false,
  flipY: false,
  translateX: 0,
  translateY: 0
}
```

The exact internal representation may use an affine matrix, but there must be one canonical transform implementation shared by rendering, hit testing, selection overlays, geometry commands, painting coordinate mapping, and export.

Transform math may use floating-point coordinates internally to avoid cumulative rounding. Final pixel rendering is rasterized deterministically to the 400×300 logical grid.

### 5.1 Transform origin

For one selected element:

- rotate/flip around that element's own visual center.

For multiple selected elements:

- compute the union visual bounds of the modifiable selected elements;
- rotate/flip the entire selection around the union-bounds center;
- update each element's position/transform so relative layout changes as a group;
- also update each element's own orientation.

Example: two elements arranged left/right become top/bottom after a group 90° rotation.

Locked elements may be selected but are excluded from mutating transform/alignment/distribution commands.

### 5.2 Rotation commands

Support:

- clockwise 90°
- counter-clockwise 90°
- arbitrary numeric angle

The arbitrary angle is a delta rotation applied to the current selection, not an absolute rewrite of every element to one common angle.

### 5.3 Geometry integration

The following must all use the same transform semantics:

- framebuffer rendering
- selection overlay
- resize/point handles where applicable
- hit testing
- marquee selection intersection
- alignment and distribution bounds
- raster paint coordinate mapping
- copy/paste
- PNG export
- rasterization of transformed subtrees

A rotated element must remain selectable at its visible location and remain editable through its normal Properties controls.

## 6. Tri-State Raster Transparency

Raster pixels become three-state values:

- transparent
- white
- black

Use a compact packed representation, conceptually:

```js
raster: {
  encoding: 'tristate-packed-v1',
  data: '...'
}
```

Two bits per pixel are sufficient:

- `00` transparent
- `01` white
- `10` black
- `11` reserved

A 400×300 full-screen raster therefore uses 30,000 raw bytes before Base64 overhead.

The old binary raster encoding is removed. No compatibility decoder is required.

### 6.1 Pencil behavior

On an editable raster:

- black pencil writes black pixels;
- white pencil writes white pixels.

On the page background:

- black pencil writes black;
- white pencil writes white.

Source images, text, and vector shapes are not directly paintable; explicit rasterization is still required before pixel painting.

### 6.2 Eraser behavior

On a normal raster:

- eraser writes transparent.

On the page background:

- eraser writes white.

The page background can never contain transparent pixels.

### 6.3 Painting transformed rasters

A raster may be rotated/flipped non-destructively and must remain paintable.

Pencil/eraser pointer coordinates are inverse-transformed from canvas/world space into the raster's local pixel grid before modifying tri-state pixels. Painting changes the local raster data only; it does not bake or reset the transform.

Out-of-bounds inverse-mapped points do nothing. The visible brush footprint must remain consistent with the active brush width after transform mapping.

### 6.4 Vector fill transparency remains distinct

Existing vector `fill.mode = 'transparent'` continues to mean "no interior paint" for closed vector shapes. It is not the same storage mechanism as tri-state raster pixels.

## 7. Transparency Preview

Row 1 contains a toggle icon for transparent-pixel preview.

The preview applies only when the currently selected primary element is a raster.

For transparent pixels inside that selected raster, render a uniform translucent light-blue overlay. Do not use dots or checker patterns.

The preview follows the raster's transform, so the blue area stays aligned with rotated/flipped transparent pixels.

The preview layer:

- is editor-only;
- does not alter raster data;
- is not added to command history;
- is not serialized into `.pix`;
- is not exported to PNG;
- never enters the framebuffer;
- does not affect hit testing.

Black and white raster pixels are shown normally without blue overlay.

The user's preview toggle preference is stored in localStorage.

## 8. History Dock Ordering

History is displayed newest-first.

The latest command appears at the top and older commands move downward.

Undo does not destroy the visible redo branch. The list remains reverse chronological while the current history pointer/highlight moves to show the active state.

Redo restores the pointer appropriately.

History ordering is a presentation change only; command execution semantics remain transactional.

## 9. Select All

`Ctrl+A` / `Cmd+A` selects all ordinary elements on the active page.

It includes:

- visible elements;
- hidden elements;
- locked elements.

It excludes the page background.

Locked nodes may be selected but mutating operations skip them.

Selection must not duplicate descendants or otherwise corrupt the selection model merely because parent and child nodes are both selected.

## 10. Structured Clipboard and Cross-Page Paste

Copy writes to PixelEdit's internal structured clipboard. Copy does not immediately create a duplicate.

Clipboard content preserves:

- selected root subtrees;
- all descendants of those roots;
- node hierarchy;
- element styles and transforms;
- raster payloads;
- referenced project assets/resources required by copied nodes;
- original logical positions;
- source page metadata needed for paste offset tracking.

### 10.1 Root deduplication

If a parent and one or more of its descendants are selected together, only the outermost selected root is copied. Descendants are included exactly once through that subtree.

### 10.2 Paste placement

The first paste after a copy uses the original coordinates.

Repeated pastes from the same clipboard payload are offset cumulatively:

- second paste: `+8,+8`
- third paste: `+16,+16`
- etc.

Changing active page does not clear the clipboard or reset its paste count. This enables cross-page paste.

New IDs are generated for every pasted node and parent links are rebuilt against the new IDs.

### 10.3 Asset semantics

Within the same open project, pasted nodes reuse compatible project assets by reference rather than duplicating identical asset data unnecessarily.

Clipboard behavior must remain valid across pages of the same project.

## 11. Shared Context Menu

Canvas right-click and Page/Layer dock right-click use the same context-menu model and command handlers.

The menu must work for multi-selection.

At minimum it provides contextually valid versions of:

- Copy
- Paste
- Delete
- Flip horizontal
- Flip vertical
- Rotate clockwise 90°
- Rotate counter-clockwise 90°
- Rotate arbitrary angle
- Rasterize, when valid

Existing image-specific actions may remain where relevant, but shared commands must not be implemented twice.

Right-clicking a layer row first establishes the expected selection semantics before opening the shared menu: if the clicked node is not currently selected, it becomes the selection; if it is already part of a multi-selection, preserve that multi-selection.

Delete and transform commands skip locked nodes.

## 12. Alignment and Distribution

Alignment/distribution commands belong only to pointer/select tool options.

They use transformed visual bounds, not untransformed source geometry.

Supported commands:

- left
- horizontal center
- right
- top
- vertical center
- bottom
- distribute horizontally
- distribute vertically

Locked selected nodes are excluded from mutation. If there are too few modifiable nodes for a command, the command is disabled/no-op rather than creating a meaningless history entry.

## 13. Element Properties vs Tool Properties

The separation is strict:

### Tool options

- configure future creation defaults;
- or invoke selection commands for pointer/select;
- stored in local preferences where applicable.

### Element Properties dock

- edits already-created selected nodes;
- participates in undo/redo;
- persists in `.pix` when it is artwork state.

Changing the Line tool from black solid width 1 to white dash-dot width 3 does not alter any existing line.

Selecting an existing line and changing its Properties does not alter the Line tool's remembered defaults.

## 14. Project vs Local State Boundary

### `.pix` project content

Contains only artwork/project state such as:

- V16 version
- pages
- layer hierarchy
- node geometry
- transforms
- strokes
- fills
- image/font assets
- raster data
- page background content

### localStorage editor preferences

Contains editor-only settings such as:

- left/right dock widths
- upper/lower dock split ratios
- per-tool defaults
- transparency-preview toggle

Workspace preference writes never mark the project dirty.

## 15. Suggested Module Boundaries

Do not add another large runtime patch. Extend the current `src/` module direction with focused responsibilities.

Suggested structure:

```text
src/
├── preferences/
│   └── editor-preferences.js
├── tools/
│   ├── tool-state.js
│   └── tool-options-bar.js
├── transforms/
│   ├── transform-model.js
│   └── selection-transform.js
├── clipboard/
│   └── element-clipboard.js
├── rendering/
│   ├── stroke-style.js
│   └── transparency-overlay.js
├── raster/
│   └── tristate-raster.js
└── ui/
    ├── icon-toolbar.js
    └── context-menu.js
```

Existing modules such as selection overlay, text layout, raster layer, image runtime, and font manager should be reused and adapted rather than duplicated.

The exact file split may change during implementation planning if current code coupling requires it, but responsibility boundaries must remain equivalent.

## 16. Testing Requirements

Testing is full regression, not smoke-only testing.

### Toolbar and preferences

- row 1 contains only global actions;
- row 2 changes with tool;
- alignment/transform controls appear only for pointer/select;
- icon controls expose correct tooltips;
- tool defaults persist in localStorage;
- invalid local preference data falls back to defaults;
- tool defaults do not change existing nodes;
- dock layout persists in localStorage;
- dock changes do not dirty project;
- workspace layout is absent from V16 serialization.

### Stroke

For line, rectangle, circle, and polygon:

- black/white stroke;
- all five styles;
- multiple widths including even widths;
- exact-width flat-cap behavior;
- element Properties updates;
- tool defaults on newly-created nodes;
- dashed gaps do not paint white.

### Transform

- single-element flip horizontal/vertical;
- single 90° CW/CCW;
- arbitrary angle;
- raster, image, text, line, and closed-shape transforms;
- multi-selection rotation around group bounds center;
- relative positions rotate as a group;
- locked selected nodes remain unchanged;
- transformed hit testing;
- transformed selection overlay;
- transformed alignment/distribution bounds;
- transformed rasterization/export;
- transformed elements remain editable.

### Tri-state raster

- transparent/white/black encode/decode;
- black pencil;
- white pencil;
- eraser to transparent on raster;
- eraser to white on background;
- background never transparent;
- paint rotated/flipped raster through inverse coordinate mapping;
- paint does not bake/reset raster transform;
- save/open V16 raster;
- no legacy raster compatibility path.

### Transparency preview

- only selected raster gets preview;
- transparent pixels receive uniform translucent blue overlay;
- transformed raster preview remains spatially aligned;
- black/white pixels do not;
- preview off removes overlay;
- preview not present in framebuffer/PNG/project/history;
- preference persists locally.

### History

- newest command appears first;
- older commands move downward;
- undo pointer is correct;
- redo branch remains visible;
- redo pointer is correct.

### Selection and clipboard

- Ctrl/Cmd+A selects all current-page ordinary nodes;
- includes hidden and locked;
- excludes background;
- selected parent+child copy deduplicates root;
- copy does not create nodes;
- same-page first paste preserves coordinates;
- repeated paste offsets by +8,+8 cumulatively;
- page change preserves clipboard;
- cross-page paste preserves subtree hierarchy;
- pasted nodes receive new IDs;
- assets remain valid;
- undo/redo works for paste.

### Shared context menu

- canvas and layer dock expose the same shared commands;
- right-click selection behavior is correct;
- multi-delete;
- multi-copy;
- multi-transform;
- locked-node skip behavior;
- rasterize availability.

### Existing regression

All prior page/layer hierarchy, font management, image/SVG import, rasterization, text metrics, guides, resize handles, dither/pattern, line exact-width rasterization, save/open, export, undo/redo, and dock resizing behavior must continue to pass under V16 semantics unless this spec intentionally replaces that behavior.

Run the same complete Playwright suite against both development server and built production preview.

Required final verification:

```bash
npm test
npm run build
npm run test:preview
```

After merge, `main` CI and GitHub Pages build/deploy must also succeed.

## 17. Delivery / Commit Policy

Implementation work happens on an isolated feature branch.

Development may use multiple small commits for TDD and reviewability. Final integration into `main` must use a squash merge so `main` receives exactly one formal code submission for this requested feature set.

Do not commit user-specific localStorage data, generated browser profiles, or temporary test artifacts.

## 18. Definition of Done

The change is complete only when:

1. global toolbar and tool-options toolbar have the responsibilities defined above;
2. icon-only controls are recognizable and have explicit tooltips;
3. history is newest-first without breaking undo/redo branches;
4. tool defaults and dock layout are local-only preferences;
5. V16 project serialization contains no workspace layout and no compatibility layer;
6. line/rectangle/circle/polygon support width, black/white color, and all five stroke styles in both tool defaults and element Properties;
7. flip and rotation remain editable for all visual node types and are respected by rendering, painting where applicable, hit testing, selection, alignment, export, and rasterization;
8. raster data supports transparent/white/black and eraser semantics are correct for raster vs page background;
9. transparency preview is a solid translucent blue editing overlay only;
10. Ctrl/Cmd+A, structured subtree copy, cross-page paste, paste offsets, and shared context menu behave as specified;
11. full development and production Playwright suites pass;
12. Vite build succeeds;
13. final squash merge produces one `main` commit and GitHub Pages deploy succeeds.
