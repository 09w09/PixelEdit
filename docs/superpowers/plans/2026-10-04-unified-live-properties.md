# Unified Live Properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every writable page and element property in PixelEdit update its model and visual result immediately while preserving focus, IME correctness, history boundaries, and performance.

**Architecture:** Introduce one `live-property-runtime` that owns Property Edit Session lifecycle, lightweight rendering, invalid-input handling, and history boundaries. Existing page, shape, text, image, generic transform, and raster compatibility bindings delegate to that runtime instead of each implementing separate `change/onchange` behavior. Structural properties may rebuild only the necessary property subtree or end the session and perform a controlled full property refresh.

**Tech Stack:** JavaScript ES modules, DOM events, existing PixelEditor command bus/history coalescing, Playwright, Vite.

**Spec:** `docs/superpowers/specs/2026-10-04-unified-live-properties-design.md`

## Global Constraints

- Do not change the project file format.
- Do not change toolbar/tool-default semantics or canvas-handle gesture semantics.
- Do not globally override `Workspace.exec()`.
- Do not synthesize DOM `change` events to reuse legacy bindings.
- Continuous property editing must not rebuild the full Properties DOM.
- Same focused continuous-edit session is one Undo step; new focus/property/selection starts a new step.
- Invalid intermediate numeric text must never write NaN into the model.
- `main` ultimately receives exactly one formal code commit based on `bb9ed923b1f930d7969041dfb879b180afe7b806`.

## Review Focus

- Empty/partially typed numeric values must remain safe and recover on blur without corrupting the model; Task 1 and Task 5 test this explicitly.
- Selection changes during an active edit must close the old history session and prevent cross-selection merging; Task 1 and Task 5 test this.
- Structural controls (`fill`, image BW mode, dither algorithm, polygon point count) must reveal new controls that are themselves immediately live; Task 4 tests this.
- IME composition must not commit partial composition strings or lose caret/focus; Task 3 tests this.
- High-frequency edits must not trigger per-input full Properties/Layer/History renders; Task 5 measures render counts and page errors.

---

### Task 1: Core Property Edit Session Runtime

**Files:**
- Create: `src/properties/live-property-runtime.js`
- Modify: `src/main.js`
- Create: `tests/live-property-runtime.spec.js`

**Interfaces:**
- Produces: `PixelEditor.liveProperties.bindNumber(control, options)`, `bindText`, `bindTextarea`, `bindSelect`, `bindCheckbox`, `execute(editor, command, refresh)`, `endEditorSession(editor, reason)`, and `normalizeNumber(value, {min,max,integer})`.
- Produces refresh flags `{canvas, overlay, previews, layers, properties, history}` and a requestAnimationFrame-coalesced visual scheduler.
- Consumes existing `editor.bus.execute`, `editor.bus.breakMergeChain`, render methods, and command `historyChannel` semantics.

- [ ] Write failing Playwright tests proving number input and wheel update before blur, keep the control focused, merge one focus session into one Undo, split a second focus session, reject empty/NaN intermediate input, and split sessions when selection changes.
- [ ] Run `npx playwright test tests/live-property-runtime.spec.js` and verify RED failures are caused by the missing runtime.
- [ ] Implement the runtime with synchronous model command execution and RAF-coalesced visual refresh; do not rebuild Properties during a continuous session.
- [ ] Install the runtime in `src/main.js` before property-specific modules.
- [ ] Run the focused test and then `npm test`; both must pass.
- [ ] Commit the task on the WIP branch.

### Task 2: Generic, Page, Shape, Dither and Pattern Properties

**Files:**
- Modify: `src/properties/shape-style-properties.js`
- Modify: `src/properties/page-fill-properties.js`
- Add or modify focused property binding module(s) if needed to wrap legacy `Properties.prototype.bind`, `bindPage`, `bindDither`, and `bindPattern`.
- Create: `tests/live-properties-shapes-page.spec.js`

**Interfaces:**
- Consumes Task 1 live binders and refresh scheduler.
- Covers page properties, generic name/visibility/lock/position/size/aspect, line geometry/stroke, rectangle/circle/polygon stroke/fill, dither and pattern values.
- Produces reusable registration helpers for Task 3/4 where appropriate.

- [ ] Write data-driven failing tests for page controls and line/rectangle/circle/polygon controls, including typing and wheel for every writable number control, immediate select/checkbox behavior, multi-select/mixed values, clamp behavior, and framebuffer/preview changes.
- [ ] Verify the new tests fail on the current implementation for non-corner fields.
- [ ] Migrate generic/page/shape/dither/pattern bindings to the live runtime; delete the corner-specific session helper so corners use the same path.
- [ ] Ensure visibility/lock/name changes update the necessary Layer Dock state without rebuilding Properties during text input.
- [ ] Run focused tests and the complete `npm test` suite.
- [ ] Commit the task on the WIP branch.

### Task 3: Text Properties and IME

**Files:**
- Modify: `src/properties/text-content-editing.js`
- Modify/extend the text property binding path in the relevant properties module.
- Create: `tests/live-properties-text.spec.js`

**Interfaces:**
- Consumes Task 1 `bindTextarea`, `bindNumber`, `bindSelect`, and `bindCheckbox`.
- Covers content, font, font size, letter spacing, line spacing, horizontal/vertical alignment, wrap, bold, invert, and text fill/dither/pattern controls.

- [ ] Write failing tests for all writable text controls, including real `input` before blur, wheel on all numeric typography fields, focus/caret preservation, compositionstart/input/compositionend behavior, framebuffer changes, and one-Undo-per-session semantics.
- [ ] Verify RED.
- [ ] Replace the standalone text-content transaction code with the shared runtime while retaining correct IME semantics.
- [ ] Run focused tests and full `npm test`.
- [ ] Commit the task on the WIP branch.

### Task 4: Image, Raster and Structural Property Changes

**Files:**
- Modify the image property binding path in Properties/runtime modules.
- Modify: `src/media/raster-layer.js` only if its compatibility wrapper needs an explicit live-binding hook.
- Create: `tests/live-properties-image-raster-structural.spec.js`

**Interfaces:**
- Consumes Task 1 runtime.
- Covers image fit/interpolation/crop/BW mode/threshold/dither algorithm/Bayer matrix/invert; raster generic transform controls; structural fill/BW/dither changes; polygon point-count dynamic list.

- [ ] Write failing tests for every image property and raster transform property.
- [ ] Write failing tests proving fill mode, BW mode and dither algorithm reveal fields that are live immediately after the structural change.
- [ ] Write failing tests proving polygon point count changes before blur, preserves the point-count control session, updates point-list structure, and new point X/Y fields are live.
- [ ] Implement controlled structural refresh and dynamic point-list rebinding without global event synthesis.
- [ ] Run focused tests and full `npm test`.
- [ ] Commit the task on the WIP branch.

### Task 5: Coverage Matrix, Undo/Redo and Performance Hardening

**Files:**
- Create: `tests/live-properties-coverage.spec.js`
- Modify earlier runtime/property modules only for defects exposed by the matrix.

**Interfaces:**
- Consumes all prior tasks.
- Produces a machine-readable or in-test property coverage matrix that enumerates all writable property IDs by page/element type and asserts each has the intended live behavior class.

- [ ] Add coverage tests that enumerate all writable property controls for page, line, rectangle, circle, polygon, text, image and raster and fail if a writable control is not assigned live behavior.
- [ ] Add Undo/Redo tests across numeric, text, select, checkbox, structural, multi-select and selection-switch scenarios.
- [ ] Add invalid/mixed/locked-state tests.
- [ ] Add performance test: 100 rapid numeric inputs must keep Properties DOM identity/focus stable, avoid per-input Layer/History renders, coalesce visual renders, produce no `pageerror`/unexpected console errors, and complete within a generous CI-safe synchronous threshold.
- [ ] Run focused tests, then `npm test`, `npm run build`, and `npm run test:preview`.
- [ ] Fix any discovered regression using RED→GREEN and rerun the full verification set.
- [ ] Commit the task on the WIP branch.

### Task 6: Final Review and Single Main Commit

**Files:**
- No additional product files unless review finds a defect.

**Interfaces:**
- Consumes the final verified WIP tree.
- Produces one formal commit whose parent is `bb9ed923b1f930d7969041dfb879b180afe7b806` and whose tree matches the verified implementation tree except WIP-only execution artifacts that should not ship.

- [ ] Review the final diff against the spec and coverage matrix; if any Critical/Important issue is found, add a failing test, fix it, and rerun full verification.
- [ ] Confirm the final WIP CI is green and read the logs for exact test counts/build result.
- [ ] Create a single formal commit from the verified final tree with Chinese conventional-commit message.
- [ ] Fast-forward `main` to that commit without force push.
- [ ] Run main CI again and verify browser regression tests, production build and production preview all pass.
