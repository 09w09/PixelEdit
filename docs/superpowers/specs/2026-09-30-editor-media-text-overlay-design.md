# PixelEdit Media, Text, Overlay Refactor Design

## Goal

Refactor PixelEdit so selection overlays remain precise and usable at all zoom levels, imported fonts render by their actual glyph metrics without clipping, source images and editable rasters have explicit and different editing semantics, and user-added fonts can be removed safely.

## Scope

This change covers four related editor subsystems:

1. Selection/resize/point overlay geometry and interaction.
2. Text layout and rasterization for browser and imported fonts.
3. Separation of source image nodes from editable raster nodes.
4. Lifecycle management for imported fonts.

No compatibility layer is required for old implementation internals. Existing `.pix` projects must still load correctly, with legacy image nodes interpreted as source-image nodes unless explicitly marked as raster nodes.

## 1. Selection Overlay

### Geometry

The visual selection rectangle must match the node's logical pixel extent exactly.

For a box node at `(x, y, w, h)`, the logical covered pixels are `x..x+w-1` and `y..y+h-1`. The screen-space selection outline therefore uses the same edge convention throughout rendering, hit-testing and handle placement; it must not mix `w` with `w-1` calculations.

Lines use their own geometry: a line segment plus two endpoint handles. They are not represented by an inflated rectangular selection box.

Polygons use vertex handles at each polygon point.

### Zoom-independent interaction size

Selection outlines remain approximately 1 CSS px on screen. Resize/point handles remain visually about 10 CSS px regardless of editor zoom, with a minimum interaction target of about 16 CSS px. Logical hit tolerance is derived from screen pixels divided by zoom, so controls remain usable at 100%, 800%, 1600%, and higher zoom levels.

### Acceptance criteria

- A 1×1, 10×10, and arbitrary box node has no one-pixel selection offset.
- Corners visually coincide with the exact node boundaries.
- Handles do not shrink as zoom increases.
- Handle hit areas remain usable without making the visible square excessively large.
- Line endpoint handles remain centered on `x1/y1` and `x2/y2`.

## 2. Text Layout and Font Metrics

### Problem

The existing renderer assumes `textBaseline = top` and `lineHeight = fontSize`. This is invalid for fonts whose ascender, descender, italic overhang, or actual glyph box extends outside those assumptions. The supplied `SmileySans-Oblique.otf` exposes this issue at the top edge.

### Layout model

Text layout uses actual Canvas `TextMetrics` where available:

- `actualBoundingBoxAscent`
- `actualBoundingBoxDescent`
- `actualBoundingBoxLeft`
- `actualBoundingBoxRight`

Each line is measured before rasterization. The renderer computes a baseline from the measured ink bounds instead of using `textBaseline = top` as a proxy for glyph geometry.

Horizontal layout accounts for italic left/right overhang so glyph ink is not silently clipped at the text box edge when there is room inside the box.

Vertical alignment (`top`, `middle`, `bottom`) is based on measured ink/line metrics. `lineSpacing` is applied between lines after metric measurement.

When actual bounding-box metrics are unavailable, the renderer falls back to font bounding metrics or the existing conservative fallback path.

### Clipping semantics

The text node's rectangle remains the intentional clipping region. Ink that genuinely lies outside the user-defined text rectangle is clipped; however, a glyph must not be clipped merely because the renderer placed its baseline incorrectly.

### Test font

`SmileySans-Oblique.otf` is used only as a test input in the execution environment. The font binary is not committed to the public repository.

### Acceptance criteria

- Smiley Sans Oblique Chinese text placed at the top of a sufficiently tall text box renders its full top strokes.
- Top/middle/bottom alignment remains stable.
- Italic glyph overhang is accounted for.
- Existing system fonts and imported fixed-size fonts still render.
- Wrapping, letter spacing, line spacing, bold, invert, and fill modes continue to work.

## 3. Source Image vs Raster Node

### Node types

The model introduces two explicit concepts:

#### `image`

A source-backed image node. It may originate from PNG, JPG, WebP, XBM, or SVG.

It keeps source-aware properties:

- source asset
- source dimensions
- source type
- SVG vector rerasterization behavior
- fit mode (`original`, `contain`, `cover`, `stretch`)
- crop rectangle
- interpolation for bitmap sources
- threshold/dither conversion
- invert

An `image` node is not directly paintable by pencil or eraser.

#### `raster`

An editable 1-bit pixel canvas. It owns fixed pixel content corresponding one-to-one with its logical `w × h` bounds.

A raster node:

- is paintable by pencil and eraser;
- has no source fit, crop, interpolation, threshold, dither-conversion, or SVG-source properties;
- does not dynamically reinterpret its contents when resized;
- behaves like a local whiteboard.

### Raster resize semantics

Changing a raster node from `oldW × oldH` to `newW × newH` never rescales pixels.

- Existing pixels keep their coordinates relative to the raster's top-left corner.
- Expanding adds white pixels to the newly exposed right/bottom area.
- Shrinking clips pixels outside the new bounds.
- Resizing from west/north through drag operations preserves the visual anchor implied by the drag; pixel data is translated/cropped consistently with the moved top-left edge rather than resampled.

No interpolation is ever used for raster resizing.

### Rasterization command

`Rasterize` converts the selected visual subtree into one `raster` node at the exact rendered 1-bit result and bounds.

It is valid for:

- rectangle
- circle
- polygon
- line
- text
- image
- a node with children / subtree

It is not offered for an already-raster node with no child content requiring flattening.

After conversion, source-specific editability is intentionally lost.

### Painting rules

Pencil/eraser may paint:

- the page background, preserving existing behavior;
- `raster` nodes.

Pencil/eraser must refuse direct edits to:

- `image`
- text
- vector shape nodes
- other source-backed nodes

The editor gives a concise notice when painting is blocked because the selected object must first be rasterized.

### Legacy projects

Legacy nodes with `type: image` load as source image nodes. Existing source metadata remains valid. Newly rasterized content uses `type: raster`, making the distinction persistent in `.pix` serialization.

### Acceptance criteria

- PNG/JPG/WebP/XBM/SVG imports create `image` nodes.
- Image nodes cannot receive pencil/eraser overlays.
- Rasterizing an image produces visually identical 1-bit pixels in a `raster` node.
- Raster pixels can be edited.
- Raster resize never scales existing pixels.
- `.pix` save/open preserves raster pixels and type.
- SVG source images retain target-size vector rerasterization until rasterized.

## 4. Imported Font Removal

### Default fonts

Built-in/system font choices are static application options and are never removable.

### Imported fonts

Every imported font record may be removed through the text-properties UI.

Removal performs one transaction:

1. Find all text nodes using the imported family.
2. Replace their `fontFamily` with `sans-serif`.
3. Clear imported-font-only fixed-size metadata where needed while retaining the node's effective font size and all other text layout properties.
4. Remove the font record from `project.fonts`.
5. Remove the associated `FontFace` from `document.fonts` and local caches where supported.
6. Remove the font asset only when no remaining project reference uses it.

The operation participates in editor history so undo/redo restores/removes the font and text-family references coherently. If browser font registration cannot be restored synchronously, undo restores the project record first and re-registers the face asynchronously before the next full render.

### UI

The font field continues to provide an import action. When the selected font is a user-imported font, a clearly labeled remove action is shown. For default/system fonts, no remove action is displayed or it is disabled.

### Acceptance criteria

- Imported font can be removed.
- Default/system fonts cannot be removed.
- Removing an unused imported font removes its project record and unreferenced asset.
- Removing a font currently used by text safely switches affected text to `sans-serif`.
- Font removal can be undone/redone without corrupting the project.
- Save/open after removal contains no dangling font or asset reference.

## 5. Refactor Boundaries

The current project contains substantial logic embedded in `index.html` plus runtime patches loaded by Vite. This change moves the touched responsibilities into focused ES modules rather than adding more patches.

Target responsibilities:

- `src/rendering/selection-overlay.js` — screen/logical overlay geometry and handles.
- `src/rendering/text-layout.js` — text measurement, baseline calculation and mask rasterization.
- `src/media/image-runtime.js` — source image rendering, including SVG vector runtime.
- `src/media/raster-layer.js` — raster storage, resize/crop/paint operations and rasterization helpers.
- `src/fonts/font-manager.js` — import/register/remove/hydrate imported fonts.
- `src/main.js` — installs/initializes modules and application integration only.

Exact filenames may be adjusted during implementation if the existing extraction boundaries make another split materially clearer, but the responsibilities above must remain separate.

## 6. Testing Strategy

The change is developed test-first where practical. Existing Playwright regression tests remain green and new tests cover both development-server and production-preview builds.

Required coverage:

- selection box geometry at 100%, 800%, 1600%;
- zoom-independent visible handle size and hit target;
- line and polygon point handles;
- Smiley Sans Oblique top-glyph clipping regression using the provided local font;
- system font text regression;
- image import for PNG/SVG/XBM;
- image paint rejection;
- image/vector/text/shape/subtree rasterization;
- raster pencil/eraser editing;
- raster enlarge = white extension, shrink = crop, never resample;
- raster save/open serialization;
- imported-font add, duplicate handling, remove-unused, remove-in-use, fallback, undo/redo;
- default-font non-removability;
- existing page/layer/history/clipboard/shapes/dither/SVG/line-width tests;
- `npm run build`;
- production preview test suite;
- GitHub Pages workflow after merge to `main`.

The supplied font is copied only into a temporary test fixture/location during local or execution testing and is not added to Git history.

## 7. Definition of Done

The work is complete only when:

- all four requested behaviors are implemented;
- the affected code has clear module boundaries instead of additional monolithic patches;
- the complete regression suite and all new branch/path tests pass;
- the production Vite build and preview tests pass;
- the final changes are merged/fast-forwarded to `main` only after verification;
- GitHub Pages deployment for the resulting `main` commit succeeds.
