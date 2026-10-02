# Bucket Fill, Transform Handles, and Text Defaults

## Goal

Keep PixelEdit strictly integer/pixel-oriented while adding a reusable flood-fill tool and making transformed selection interaction consistent with desktop image editors.

## Design

### Shared fill settings

- Centralize tool fill, dither, and pattern normalization in `src/model/fill-values.js`.
- Keep the existing V17 node fill schema unchanged.
- Persist bucket settings locally alongside the other tool defaults.
- Expose the same fill modes and dither/pattern parameters that element fill properties already use.

### Bucket tool

- Add the bucket to the 编辑 tool group at runtime so the legacy HTML shell does not gain another source of tool behavior.
- Use four-neighbor flood fill so diagonally touching regions remain separate.
- Treat raster black, white, and transparent as distinct source states.
- Support solid, transparent, dither, and pattern output.
- Record page, image-overlay, and raster changes through existing history commands.

### Transform interaction

- Preserve integer source geometry and integer transform translations.
- Round visual property bounds before displaying X/Y/W/H.
- Extend box selections from four corner handles to eight resize handles.
- Derive the cursor from each handle's transformed world-space direction, so rotation and mirroring also rotate the resize cursor.
- Keep transformed resize operations in local coordinates and round before writing geometry.

### Text defaults

- Add `alignH` and `alignV` to text tool preferences.
- Expose both controls in the text tool options bar.
- Snapshot these defaults when a new text node is created.

## Verification

- Add browser regression coverage for bucket controls, flood-fill boundaries and history, integer transformed properties/cursors, and text alignment defaults.
- Run the full Playwright suite.
- Run the production build.
- Run the production-preview Playwright suite.
