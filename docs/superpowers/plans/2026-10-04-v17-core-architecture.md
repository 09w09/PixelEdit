# PixelEdit V17 Core Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PixelEdit 从“V15 单体 Core + V17 Runtime Patch Stack”重构为唯一、原生、可显式组合的 V17 Core，同时保持现有 400×300 1-bit 编辑器的全部用户行为。

**Architecture:** 先把 `index.html` 中的 V15 JavaScript core 迁移为 `src/` 下的 V17 原生模块，再依次建立 NodeRenderer pipeline、PropertyProvider、原生 CommandBus/EditSession、Tool Registry 和 Overlay Layer pipeline。每一阶段都必须删除其对应 runtime patch，而不是在新实现外继续保留兼容 wrapper；阶段完成后以现有 Playwright 回归测试和新增架构约束测试共同验收。

**Tech Stack:** JavaScript ES Modules、Vite 7、Playwright 1.55、Canvas 2D、SVG Overlay、浏览器 File/Clipboard/Font API。

**Spec:** `docs/superpowers/specs/2026-10-04-v17-core-architecture-design.md`

## Global Constraints

- 项目唯一持久化格式保持 V17；不迁移、不兼容 V17 之前的工程文件。
- 画布固定 `400×300`，最终像素语义保持 1-bit，元素可编辑几何必须为整数像素。
- 不新增用户功能；重构目标是保持现有行为并消除 patch-on-core 架构。
- `index.html` 最终只保留静态 DOM/CSS shell 和一个正式 ES module 入口。
- 不允许以 `originalXxx = prototype.xxx` 后再覆写同一方法的 runtime wrapper 作为新架构扩展方式。
- Raster、Image、Text、Rectangle、Circle、Line、Polygon 都必须是一等 node type；不得为复用 renderer 临时改写 `node.type`。
- `renderPage()` / `renderSubtree()` 不得通过 `structuredClone(project)` 适配旧 renderer。
- 属性实时预览必须继续支持键盘输入、ArrowUp/ArrowDown、native spinner、focused number wheel、IME、Undo 合并和失焦提交。
- 所有 Git 提交说明使用中文 Conventional Commit 风格。
- 开发分支允许按任务产生审查用提交；合入 `main` 前将产品变更压缩为一个正式 `refactor:` 提交，设计/计划文档不进入最终产品提交，除非用户另行要求。

## Review Focus

- **旋转/翻转后的图片与栅格坐标命中：** pointer、bucket、paint 必须统一使用 world→local 映射；Task 2 和 Task 5 增加 rotated image/raster 交互测试。
- **嵌套父子节点同时存在 clipping + transform：** 子节点不能越过父节点可视区域，且 visual bounds 必须正确；Task 2 增加嵌套组合测试。
- **结构型属性实时编辑：** polygon 点数、fill mode、image BW/dither mode 改变 property DOM 时不得丢历史边界或产生重复 listener；Task 3 增加结构切换与焦点测试。
- **工具切换历史边界：** pointer/image/bucket/pencil/text 等全部必须经过同一 `ToolController.setTool()`，连续属性 session 不能跨工具合并；Task 5 增加全工具矩阵测试。
- **大项目 render 性能：** renderer 不得因 transform/raster/stroke 产生整项目 clone 链；Task 2 增加 clone guard 与多节点 render 性能回归测试。

---

### Task 1: 建立原生 V17 Core 与纯 HTML Shell

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`
- Create: `src/app/bootstrap.js`
- Create: `src/app/workspace.js`
- Create: `src/model/project.js`
- Create: `src/model/node.js`
- Create: `src/model/tree-model.js`
- Create: `src/model/selection-set.js`
- Create: `src/model/asset-store.js`
- Create: `src/commands/command-bus.js`
- Create: `src/commands/node-commands.js`
- Create: `src/commands/page-commands.js`
- Create: `src/persistence/project-serializer.js`
- Create: `src/persistence/project-files.js`
- Create: `src/persistence/autosave.js`
- Modify/Delete after migration: `src/model/v17-schema.js`
- Test: `tests/v17-core-architecture.spec.js`
- Existing regression: `tests/core-regression.spec.js`, `tests/save-workflow.spec.js`, `tests/project-v17.spec.js`

**Interfaces:**
- Consumes: existing pure helpers from `src/model/fill-values.js`, `src/model/stroke-values.js`, raster encoding helpers and browser DOM already present in `index.html`.
- Produces: `createProject(name)`, `createPage(name)`, `createNode(type, props)`, `TreeModel`, `SelectionSet`, `AssetStore`, `CommandBus`, `Workspace`, `bootstrapPixelEdit()`, and canonical `PixelEditor` namespace exports used by later tasks.

- [ ] **Step 1: Write the failing architecture tests**

Add tests asserting:

```js
expect(indexHtml).not.toContain('PE.version=15');
expect(indexHtml).not.toContain('class Workspace');
expect(indexHtml).not.toContain('class CommandBus');
expect(window.PixelEditor.version).toBe(17);
expect(window.PixelEditorTest.version).toBe(17);
```

Also assert V17 `createProject()` contains no `workspaceLayout` and page fill uses `{mode, color}` rather than `fill.value`.

- [ ] **Step 2: Run the targeted tests and confirm RED**

Run: `npx playwright test tests/v17-core-architecture.spec.js tests/core-regression.spec.js tests/project-v17.spec.js`

Expected: architecture assertions fail because `index.html` still boots V15 core.

- [ ] **Step 3: Extract canonical model classes/functions**

Implement exact public exports:

```js
createPage(name = '页面') -> Page
createNode(type, props = {}) -> Node
createProject(name = '未命名工程') -> Project
class TreeModel { ... }
class SelectionSet { ... }
class AssetStore { ... }
```

The new node factory must directly support `line|rectangle|circle|polygon|text|image|raster` including canonical `stroke`, `fill`, `transform`, raster payload and integer geometry defaults.

- [ ] **Step 4: Extract canonical command/persistence core without feature wrappers**

Implement:

```js
class CommandBus
class AddNodesCommand
class UpdateNodesCommand
class DeleteNodesCommand
class UpdatePageCommand
ProjectSerializer.validate(project)
ProjectSerializer.serialize(project, assets)
ProjectSerializer.deserialize(raw)
```

At this stage preserve existing behavior; advanced merge/session logic remains Task 4.

- [ ] **Step 5: Extract Workspace and bootstrap**

`bootstrapPixelEdit()` constructs the canonical namespace and one `Workspace` instance. `src/main.js` becomes composition-only imports plus `bootstrapPixelEdit()`; do not call any `install*Runtime()` for model/core behaviors migrated in this task.

- [ ] **Step 6: Reduce `index.html` to shell**

Remove all inline JavaScript core definitions. Keep existing DOM/CSS markup, hidden file inputs and a single module entry. Vite must no longer need to inject `src/main.js` conditionally; update `vite.config.js` if required so the entry is explicit and identical in dev/build.

- [ ] **Step 7: Remove V17 upgrade installer**

Delete or convert `src/model/v17-schema.js` into pure exports only. No runtime reassignment of `M.createPage/createNode/createProject` may remain.

- [ ] **Step 8: Run task regression suite**

Run:

```bash
npm test -- tests/v17-core-architecture.spec.js tests/core-regression.spec.js tests/project-v17.spec.js tests/save-workflow.spec.js
npm run build
```

Expected: PASS, V17 boot direct, no V15 bootstrap.

- [ ] **Step 9: Commit Task 1**

```bash
git add index.html src tests vite.config.js
git commit -m "refactor: 建立原生 V17 核心入口"
```

---

### Task 2: 重构 Renderer 为显式 NodeRenderer Pipeline

**Files:**
- Create: `src/rendering/renderer.js`
- Create: `src/rendering/render-context.js`
- Create: `src/rendering/framebuffer.js`
- Create: `src/rendering/node-renderers/rectangle-renderer.js`
- Create: `src/rendering/node-renderers/circle-renderer.js`
- Create: `src/rendering/node-renderers/line-renderer.js`
- Create: `src/rendering/node-renderers/polygon-renderer.js`
- Create: `src/rendering/node-renderers/text-renderer.js`
- Create: `src/rendering/node-renderers/image-renderer.js`
- Create: `src/rendering/node-renderers/raster-renderer.js`
- Create: `src/rendering/effects/transform.js`
- Create: `src/rendering/effects/clipping.js`
- Create: `src/rendering/effects/stroke.js`
- Create: `src/rendering/effects/fill.js`
- Refactor/Delete compatibility portions: `src/rendering/stroke-style.js`, `src/rendering/hierarchy-clipping.js`, `src/transforms/transform-model.js`, `src/media/raster-layer.js`, `src/rendering/binary-image.js`
- Preserve pure algorithms: `src/rendering/pixel-stroke.js`, `src/rendering/text-layout.js`, `src/raster/tristate-raster.js`
- Test: `tests/renderer-pipeline.spec.js`
- Existing regression: rendering, hierarchy, transform, image, raster and stroke specs.

**Interfaces:**
- Consumes: canonical V17 nodes from Task 1, `TreeModel`, asset store, pure stroke/text/raster algorithms.
- Produces:

```js
class Renderer {
  renderPage(project, pageId, assets) -> Uint8Array
  renderSubtree(project, pageId, nodeId, assets, base = 0) -> Uint8Array
  subtreeRgba(project, pageId, nodeId, assets) -> {x,y,w,h,data}
  visualBounds(nodeId, context) -> Bounds
}
class RenderContext
NodeRenderer.render(node, context)
NodeRenderer.visualBounds(node, context)
```

- [ ] **Step 1: Write renderer architecture RED tests**

Assert no production renderer path contains:

```js
node.type = 'image'
structuredClone(project)
R.plotPixel =
```

Behavior tests must compare framebuffer snapshots for representative rectangle/circle/line/polygon/text/image/raster nodes before migration.

- [ ] **Step 2: Add Review Focus tests for nested transform/clipping and clone guard**

Create a parent with child, transform both, clip child through parent, then assert framebuffer and `visualBounds`. Instrument/guard `structuredClone` during `renderPage()` so cloning the full project fails the test.

- [ ] **Step 3: Implement `Framebuffer` and `RenderContext`**

`RenderContext` owns framebuffer, page, tree, assets, transform stack and clip state. Pixel plotting receives context explicitly; no renderer may mutate a global plot function.

- [ ] **Step 4: Implement direct node renderers**

Each canonical node type gets one renderer. Raster renderer reads tri-state pixels directly; image renderer uses image runtime directly; shape renderers consume canonical fill/stroke directly; no overlay pre-raster adapter.

- [ ] **Step 5: Implement transform and clipping as context effects**

Transform maps node-local/world coordinates through an explicit matrix. Clipping pushes/pops clip state around subtree traversal. Neither effect creates a temporary project.

- [ ] **Step 6: Route `renderPage/renderSubtree/subtreeRgba/visualBounds` through the new pipeline**

Replace old static renderer chain in one ownership point. Preserve external method names temporarily only as direct facades, not wrappers.

- [ ] **Step 7: Remove renderer compatibility adapters**

Delete black-background→pattern conversion, shape→overlay conversion, raster→image adaptation, transform→image adaptation, and temporary `plotPixel` replacement.

- [ ] **Step 8: Add rotated image/raster coordinate regression**

Assert rotated/flipped image and raster framebuffer pixels and visual bounds remain correct. These snapshots become the coordinate-system reference for Task 5 tools.

- [ ] **Step 9: Run renderer and full existing rendering suites**

Run targeted renderer tests first, then `npm test` and `npm run build`.

Expected: all pass; architecture guard confirms zero whole-project clone on render path.

- [ ] **Step 10: Commit Task 2**

```bash
git add src/rendering src/media src/transforms tests
git commit -m "refactor: 重构 V17 渲染管线"
```

---

### Task 3: 用 PropertyProvider / PropertySession 替换属性补丁栈

**Files:**
- Create: `src/properties/property-panel.js`
- Create: `src/properties/property-session.js`
- Create: `src/properties/property-registry.js`
- Create: `src/properties/providers/common-provider.js`
- Create: `src/properties/providers/transform-provider.js`
- Create: `src/properties/providers/rectangle-provider.js`
- Create: `src/properties/providers/line-provider.js`
- Create: `src/properties/providers/polygon-provider.js`
- Create: `src/properties/providers/text-provider.js`
- Create: `src/properties/providers/image-provider.js`
- Create: `src/properties/providers/raster-provider.js`
- Create: `src/properties/providers/page-provider.js`
- Delete after migration: `src/properties/live-property-runtime.js`, `live-position-properties.js`, `live-text-properties.js`, `live-image-structural-properties.js`, `live-transform-properties.js`, `page-fill-properties.js`, `text-font-actions.js`
- Convert/remove patch code: `src/properties/shape-style-properties.js`, `src/ui/history-properties.js`
- Test: `tests/property-provider-architecture.spec.js`
- Existing regression: all live-property, corner-radius, history-properties, image and font management specs.

**Interfaces:**
- Consumes: canonical commands and model, Renderer refresh APIs.
- Produces:

```js
class PropertyRegistry { register(provider); providersFor(context); }
class PropertyPanel { render(context); refresh(structural = false); }
class PropertySession { begin(descriptor); preview(value); commit(); cancel(); }
PropertyDescriptor = { id, type, label, read, normalize, createCommand, refresh, structural, historyChannel }
```

- [ ] **Step 1: Write architecture RED tests**

Assert property production code contains no `cloneNode`, no regex removal of font buttons, no `Properties.prototype.render = wrapper`, and no duplicate DOM ID ownership across providers.

- [ ] **Step 2: Add full behavior matrix tests**

For every enabled writable property, assert input/select/checkbox updates canonical model immediately. Keep current 235-style matrix semantics and add provider ownership checks.

- [ ] **Step 3: Add Review Focus structural-edit tests**

Test polygon point-count changing its point list, fill-mode switching dither/pattern controls, and image BW/dither structural selectors. Assert no duplicate listeners, no lost Undo boundary, and the active structural action yields exactly one logical history entry.

- [ ] **Step 4: Implement Registry and descriptors**

Providers return descriptors/sections only. Provider modules must not attach listeners directly to arbitrary pre-existing controls.

- [ ] **Step 5: Implement `PropertySession`**

Number inputs support typed input, wheel, spinner/arrow changes, Enter/blur. Textarea supports IME composition. Session schedules targeted canvas/overlay/preview refresh while preserving focused DOM.

- [ ] **Step 6: Implement `PropertyPanel` as sole DOM owner**

Render markup and bind descriptor controls exactly once. Structural fields may rerender the necessary panel section; non-structural live preview may not replace the focused input.

- [ ] **Step 7: Migrate providers in order**

Migrate common → transform → line/rectangle/circle/polygon → text → image → raster → page. After each provider, run its existing tests before deleting the legacy binder it replaces.

- [ ] **Step 8: Remove all property compatibility modules**

Delete clone-control listener clearing, page fill post-render edits, regex font-button removal, duplicate live-position command implementation and history module transform property ownership.

- [ ] **Step 9: Run property/full suites and performance regression**

Run targeted property specs, then full `npm test`, `npm run build`, and preview tests. Keep the 100 rapid-input performance test and assert property DOM is not rebuilt per keystroke.

- [ ] **Step 10: Commit Task 3**

```bash
git add src/properties src/ui tests
git commit -m "refactor: 统一 V17 属性提供器与编辑会话"
```

---

### Task 4: 将 History、Edit Session 与整数几何归入原生 CommandBus

**Files:**
- Modify: `src/commands/command-bus.js`
- Modify: `src/commands/node-commands.js`
- Modify: `src/commands/page-commands.js`
- Create: `src/commands/edit-session.js`
- Create: `src/model/invariants.js`
- Delete after migration: `src/history/command-coalescing.js`, `src/model/integer-geometry.js`
- Modify: property session from Task 3 to call bus sessions directly.
- Test: `tests/command-bus-architecture.spec.js`
- Existing regression: `tests/history-coalescing.spec.js`, integer geometry/history/undo suites.

**Interfaces:**
- Consumes: canonical project/model from Task 1 and property session from Task 3.
- Produces:

```js
bus.execute(command)
bus.beginSession(descriptor)
bus.updateSession(command)
bus.commitSession()
bus.cancelSession()
bus.breakMergeChain(reason)
bus.undo()
bus.redo()
bus.jump(index)
normalizeCommittedProject(project)
assertProjectInvariants(project)
```

- [ ] **Step 1: Write CommandBus architecture RED tests**

Assert no runtime redefinition of `CommandBus.prototype.execute`, `UpdateNodesCommand` constructor replacement, `SelectionSet.prototype.*` wrappers, or temporary replacement of `normalizeTransform`.

- [ ] **Step 2: Pin existing merge semantics**

Test same property/session merges, focus/property/tool/selection/page changes break merging, Undo/Redo restore correct snapshots, and nonmergeable commands remain separate.

- [ ] **Step 3: Implement explicit edit session state in CommandBus**

A session owns descriptor, starting snapshot and latest committed preview snapshot. `commitSession()` produces one history entry; cancel restores the starting snapshot.

- [ ] **Step 4: Implement model invariant boundary**

At the one command/session commit boundary normalize integer geometry, positive box dimensions, transform translation/rotation and hierarchy validity. Commands may calculate temporary floating values during preview but committed state must validate.

- [ ] **Step 5: Remove history/integer patch installers**

Delete `command-coalescing.js` and `integer-geometry.js` runtime wrappers. Selection/page/tool code calls `breakMergeChain()` explicitly through owned lifecycle boundaries instead of patched SelectionSet methods.

- [ ] **Step 6: Run history and full suites**

Run targeted history/integer tests, full test suite, production build and preview suite.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/commands src/model src/history src/properties tests
git commit -m "refactor: 将事务与模型约束收敛到 CommandBus"
```

---

### Task 5: 建立统一 Tool Registry 与 ToolController

**Files:**
- Create: `src/tools/tool.js`
- Create: `src/tools/tool-registry.js`
- Create: `src/tools/tool-controller.js`
- Create: `src/tools/pointer-tool.js`
- Create: `src/tools/pencil-tool.js`
- Create: `src/tools/eraser-tool.js`
- Create: `src/tools/bucket-tool.js`
- Create: `src/tools/line-tool.js`
- Create: `src/tools/rectangle-tool.js`
- Create: `src/tools/circle-tool.js`
- Create: `src/tools/polygon-tool.js`
- Create: `src/tools/text-tool.js`
- Create: `src/tools/image-tool.js`
- Refactor: `src/tools/tool-options-bar.js`, `shape-style-options.js`, `fill-tool-options.js`, `text-tool-options.js`, `tool-state.js`, `canvas-cursor.js`
- Delete compatibility behavior: `src/media/edit-boundaries.js`, paint/bucket Workspace prototype routing in raster modules.
- Test: `tests/tool-registry-architecture.spec.js`
- Existing regression: cursor, bucket, paint, text, drawing, image import tests.

**Interfaces:**
- Consumes: canonical Workspace, CommandBus, Renderer coordinate conversion, preferences.
- Produces:

```js
class ToolRegistry { register(id, tool); get(id); }
class ToolController { setTool(id); pointerDown(e); pointerMove(e); pointerUp(e); keyDown(e); renderOptions(container); cursor(); }
class Tool { activate(ctx); deactivate(ctx); pointerDown(event, ctx); pointerMove(event, ctx); pointerUp(event, ctx); keyDown(event, ctx); renderOptions(container, ctx); cursor(ctx); }
```

- [ ] **Step 1: Write architecture RED tests**

Assert `Workspace.setTool()` has one implementation and every supported tool is registered. Production tool files must not patch `Workspace.prototype.setTool/onPointerDown/beginPaint`.

- [ ] **Step 2: Add full tool-switch history matrix**

Start an active property/history session, switch to each tool (`pointer`, `select`, `pencil`, `eraser`, `bucket`, `line`, `rectangle`, `circle`, `polygon`, `image`, `text`) and assert the previous session cannot merge across the tool boundary.

- [ ] **Step 3: Implement ToolController lifecycle**

`setTool()` always performs deactivate → history boundary → assign → activate → options/cursor refresh. No individual tool may directly assign `workspace.tool`.

- [ ] **Step 4: Migrate drawing/editing tools**

Move pointer/drawing/paint/bucket/image/text routing out of Workspace wrappers into tools. `PaintTarget` capability decides raster/page editability; remove separate edit-boundary wrapper.

- [ ] **Step 5: Unify options providers**

`renderOptions()` belongs to active tool. Remove `fill-tool-options` override of `ToolOptionsBar.render`; shape/text/bucket options render directly from tool implementation or shared pure helpers.

- [ ] **Step 6: Add rotated/flipped image/raster interaction tests**

Use renderer/selection world→local mapping for bucket/paint hit coordinates. Assert rotated/flipped raster edits the expected source pixel and rotated image bucket region starts at the expected local pixel.

- [ ] **Step 7: Run all tool/interaction suites and full regression**

Run targeted tests, full suite, build and preview.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/tools src/media src/raster tests
git commit -m "refactor: 建立统一工具注册与交互生命周期"
```

---

### Task 6: 建立 Overlay Layer Pipeline

**Files:**
- Create: `src/overlay/overlay-renderer.js`
- Create: `src/overlay/layers/selection-layer.js`
- Create: `src/overlay/layers/handle-layer.js`
- Create: `src/overlay/layers/smart-guide-layer.js`
- Create: `src/overlay/layers/marquee-layer.js`
- Create: `src/overlay/layers/transparency-layer.js`
- Create: `src/overlay/layers/tool-cursor-layer.js`
- Refactor/delete patch ownership: `src/rendering/selection-overlay.js`, `src/transforms/photopea-transform-ui.js`, `src/rendering/transparency-overlay.js`, cursor overlay portions in `src/tools/canvas-cursor.js`
- Test: `tests/overlay-pipeline.spec.js`
- Existing regression: selection handles, Photopea transform UI, guides, cursor and transparency specs.

**Interfaces:**
- Consumes: selection geometry, ToolController cursor state, canonical renderer visual bounds.
- Produces:

```js
class OverlayRenderer { render(editor, context) -> void }
OverlayLayer.render(editor, context) -> string | DocumentFragment
```

- [ ] **Step 1: Write overlay architecture RED tests**

Assert only `OverlayRenderer` writes final overlay DOM and production modules do not wrap `Workspace.renderOverlay()`.

- [ ] **Step 2: Pin visual layer order**

Test deterministic order: selection outline → handles → smart guides/marquee → transparency visualization → tool cursor, with pointer-events disabled where appropriate.

- [ ] **Step 3: Implement OverlayRenderer and layers**

Each layer is pure relative to editor/context and returns markup/fragment. The renderer concatenates/commits once per frame.

- [ ] **Step 4: Make eight-handle transform canonical**

Move Photopea edge/corner handle geometry and cursor-direction logic into `HandleLayer`/selection geometry. Delete four-handle base + eight-handle wrapper duality.

- [ ] **Step 5: Move transparency and brush cursor into layers**

No module may call `insertAdjacentHTML()` after the overlay renderer finishes.

- [ ] **Step 6: Run overlay/full suites**

Run targeted overlay specs, full suite, build and preview.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/overlay src/rendering src/transforms src/tools tests
git commit -m "refactor: 统一画布 Overlay 渲染管线"
```

---

### Task 7: 删除剩余 Runtime Patch、建立架构守卫并完成全量验收

**Files:**
- Modify: `src/main.js`
- Delete any now-unused `install*Runtime` compatibility modules identified by repository search.
- Create: `tests/architecture-guards.spec.js`
- Modify: `package.json` only if a dedicated architecture test script improves CI clarity.
- Modify: CI workflow only if required to run architecture guards in both dev and preview paths.

**Interfaces:**
- Consumes: all canonical systems from Tasks 1–6.
- Produces: one explicit application composition root with no runtime patch ordering semantics.

- [ ] **Step 1: Write final repository-level guard tests**

Guards search production `src/` and `index.html` and fail on:

```text
originalXxx = SomeClass.prototype.someMethod + wrapper reassignment pattern
cloneNode used to clear listeners
node.type = 'image' adaptation
structuredClone(project) in renderer path
V15 bootstrap/version markers
regex removal of property UI controls
```

Allow normal class method definitions and intentional test fixtures only.

- [ ] **Step 2: Audit every `install*Runtime` symbol**

Classify each remaining installer as pure namespace registration or obsolete patch. Convert pure modules to normal imports/constructors where practical; delete obsolete wrappers. `src/main.js` must read as dependency composition, not ordered patch application.

- [ ] **Step 3: Verify no duplicate domain ownership remains**

Repository searches must show one owner for:

- node creation
- project serialization
- command execution/history
- property panel rendering/binding
- tool switching/pointer routing
- overlay DOM commit
- renderPage/subtree/visualBounds

- [ ] **Step 4: Run complete development regression**

Run: `npm test`

Expected: all existing and new tests pass with zero unexpected `pageerror`.

- [ ] **Step 5: Run production build and production preview regression**

Run:

```bash
npm run build
npm run test:preview
```

Expected: production bundle and all preview tests pass.

- [ ] **Step 6: Run performance checks**

Verify property rapid input, large multi-node render, transform/raster rendering and overlay pointer-move tests remain under their recorded regression thresholds; confirm no whole-project clone in render path.

- [ ] **Step 7: Review final branch diff against spec**

Compare branch to `7cd95163563eac9c821c2e7edbed2bee12af3365`. No unrelated feature changes, compatibility shims or abandoned WIP files may remain.

- [ ] **Step 8: Commit final cleanup**

```bash
git add -A
git commit -m "refactor: 清理旧运行时补丁与重复实现"
```

- [ ] **Step 9: Whole-branch code review**

Review specifically for behavior bypasses, direct model mutation outside preview sessions, hidden prototype reassignment, installation-order dependencies and missing transformed-coordinate tests. Fix findings before main integration.

- [ ] **Step 10: Produce final main commit**

Create a clean tree from the verified branch product files relative to original main, excluding `docs/superpowers/specs` and `docs/superpowers/plans` unless requested. Advance `main` by fast-forward to one squashed commit:

```text
refactor: 重构为原生 V17 核心架构
```

Then run fresh `main` CI and only report completion after dev tests, build and preview tests pass on that exact SHA.
