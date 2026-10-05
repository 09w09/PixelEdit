# PixelEdit 架构收口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 PixelEdit 从“旧实现 + V17 覆盖层 + runtime installer/capability”收敛为单一正式实现，并在不增加新功能的前提下保持全部现有行为通过测试。

**Architecture:** 保留现有浏览器端 ES Module 架构和 `globalThis.PixelEditor` 调试 API，但生产依赖改为显式 import/export 与明确对象调用。Workspace 只保留一份正式实现；Clipboard、Persistence、Property Preview、ToolController 等模块不再通过运行时覆盖已有类或方法接入。

**Tech Stack:** JavaScript ES Modules、Vite、Playwright、Browser File System Access API、localStorage。

**Spec:** `docs/superpowers/specs/2026-10-05-architecture-convergence-design.md`

## Global Constraints

- 不兼容 V15/V16，不新增旧工程迁移代码。
- 不新增 UI 或用户功能；只做架构收口和必要回归修复。
- `PROJECT_VERSION = 17` 继续作为当前工程格式版本。
- `PixelEditor` 全局对象可以暴露稳定 API，但不得充当 service locator 或运行时补丁注册表。
- 禁止通过后加载模块覆盖已有类、实例方法、provider 方法或 Workspace。
- 禁止建立新的字符串 dispatch/capability registry 替代 `workspaceCapabilities`。
- 每个任务必须遵循 Red → Green → Refactor：先补失败测试，再改生产代码，再跑相关测试后提交。
- 每个任务提交信息使用中文 Conventional Commits 风格。
- 最终必须执行 `npm test`、`npm run build`、`npm run test:preview` 和全仓静态残留扫描。

## Review Focus

1. 启动顺序变化：任一正式模块不得依赖“某 installer 恰好先执行”才能工作；由 Task 6 的启动/架构测试覆盖。
2. 工程布局状态：调整侧栏后必须只写 editor preferences，序列化 `.pix` 中不得出现 `workspaceLayout`；由 Task 1 覆盖。
3. Clipboard 自包含资源：跨页面复制图片、字体、raster 数据后粘贴必须保持资源引用完整；由 Task 3 覆盖。
4. ToolController 委托：pointer down/move/up、工具切换与默认 selection 流程不得因取消方法覆盖而重复执行或漏执行；由 Task 4 覆盖。
5. Property preview：图片属性实时预览必须只走 canonical binary-image 路径，不能回退到旧 `ditherImageData`；由 Task 2 覆盖。

---

### Task 1: 收口 Editor Preferences、ProjectFiles 与 Autosave

**Files:**
- Modify: `src/preferences/editor-preferences.js`
- Modify: `src/persistence/project-files.js`
- Modify: `src/persistence/autosave.js`
- Modify: `src/app/workspace.js`
- Test: `tests/v17-preferences.spec.js`
- Test: `tests/v17-core-architecture.spec.js`

**Interfaces:**
- Consumes: `ProjectSerializer.serialize(project, assets)` / `ProjectSerializer.deserialize(raw)`。
- Produces: `ProjectFiles` 单一正式类；`Autosave` 单一正式类；`defaultEditorPreferences()`、`loadEditorPreferences()`、`saveEditorPreferences()`、`updateEditorPreferences()`；Workspace 正式方法 `updateWorkspaceLayout(patch)`, `applyLayout()`, `setupDockSplitters()`。

- [ ] **Step 1: 写失败测试**

在 `tests/v17-preferences.spec.js` 增加断言：

```js
expect(window.PixelEditor.persistence.ProjectFiles.name).toBe('ProjectFiles');
expect(window.PixelEditor.persistence.Autosave.name).toBe('Autosave');
expect(savedProject).not.toHaveProperty('workspaceLayout');
expect(reloadedPreferences.workspace).toEqual(updatedWorkspace);
```

在架构测试中断言 `editor-preferences.js` 不包含 `P.ProjectFiles = class`、`P.Autosave = class`、`workspaceCapabilities`。

- [ ] **Step 2: 运行目标测试确认失败**

Run: `npx playwright test tests/v17-preferences.spec.js tests/v17-core-architecture.spec.js`

Expected: 至少因当前 runtime class replacement / capability 注册失败。

- [ ] **Step 3: 将最终行为移入正式类和 Workspace**

`src/persistence/project-files.js` 直接实现当前 V17 `saveAs()` 默认文件名逻辑；`src/persistence/autosave.js` 直接实现当前 storage key 与容错行为；`editor-preferences.js` 只保留 preferences 数据逻辑；Workspace 显式 import preferences 函数并实现布局方法。

- [ ] **Step 4: 运行目标测试并提交**

Run: `npx playwright test tests/v17-preferences.spec.js tests/v17-core-architecture.spec.js`

Expected: PASS

Commit: `refactor: 收口偏好设置与持久化实现`

---

### Task 2: 收口 PropertyProvider 图片实时预览

**Files:**
- Modify: `src/properties/property-system.js`
- Modify: `src/rendering/binary-image-preview.js`
- Modify: `src/main.js`
- Test: `tests/v17-legacy-audit.spec.js`
- Test: existing property live-preview specs

**Interfaces:**
- Consumes: canonical binary image API from `src/rendering/binary-image.js`。
- Produces: `PropertyProvider.renderPreviews(...)` 唯一正式实现；`binary-image-preview.js` 若保留，只导出纯函数，不修改 provider。

- [ ] **Step 1: 写失败测试**

增加源码架构断言：`binary-image-preview.js` 不得出现 `provider.renderPreviews =`；运行时图片预览测试继续将旧 `PixelEditor.renderer.ditherImageData` 替换为抛错函数，并要求预览成功且 `legacyCalls === 0`。

- [ ] **Step 2: 运行测试确认当前结构失败**

Run: `npx playwright test tests/v17-legacy-audit.spec.js`

Expected: 架构断言 FAIL。

- [ ] **Step 3: 把 canonical preview 调用直接并入 PropertyProvider**

`property-system.js` 显式 import 所需纯函数；删除 `installBinaryImagePreviewRuntime()` 的 provider 覆盖职责，并从 `main.js` 移除对应安装调用。

- [ ] **Step 4: 运行属性相关测试并提交**

Run: `npx playwright test tests/v17-legacy-audit.spec.js tests/*property*.spec.js`

Expected: PASS

Commit: `refactor: 统一图片属性预览路径`

---

### Task 3: Clipboard 单实现与独立格式版本

**Files:**
- Modify: `src/clipboard/element-clipboard.js`
- Modify: `src/app/workspace.js`
- Modify: `src/core/index.js`
- Modify: `src/main.js`
- Delete: `src/interaction/clipboard.js`
- Test: existing clipboard specs
- Test: `tests/v16-full-workflow.spec.js`（Task 7 再重命名）

**Interfaces:**
- Produces: `ElementClipboard`（或重命名后的 `Clipboard`）作为唯一正式 clipboard 类；`CLIPBOARD_FORMAT_VERSION = 1`；payload 字段 `formatVersion`。
- Workspace 直接持有 clipboard 实例并调用 `copySelection()`, `pasteClipboard()`, `selectAllOnPage()` 对应正式方法/commands，不经 `I.Clipboard` 和 capability 注册。

- [ ] **Step 1: 写失败测试**

增加断言：

```js
expect(payload.formatVersion).toBe(1);
expect(payload).not.toHaveProperty('version');
```

并覆盖复制/粘贴包含 image、font、raster runtime records 的场景；架构测试断言 `src/interaction/clipboard.js` 不再被生产入口引用，`element-clipboard.js` 不包含 `I.Clipboard =` 或 `workspaceCapabilities`。

- [ ] **Step 2: 运行 clipboard 测试确认失败**

Run: `npx playwright test tests/*clipboard*.spec.js tests/v17-core-architecture.spec.js`

Expected: 当前 `version: 16` / runtime registration 相关断言 FAIL。

- [ ] **Step 3: 改为单一正式实现并删除旧文件**

保留当前资源打包/恢复能力，只改变接入方式和 payload 版本字段；从 `core/index.js`、`main.js` 清理旧 clipboard 与 installer 引用。

- [ ] **Step 4: 运行 clipboard 与 round-trip 测试并提交**

Run: `npx playwright test tests/*clipboard*.spec.js tests/v16-full-workflow.spec.js`

Expected: PASS

Commit: `refactor: 合并剪贴板实现并独立格式版本`

---

### Task 4: ToolController 改为显式委托

**Files:**
- Modify: `src/tools/tool-controller.js`
- Modify: `src/app/workspace.js`
- Modify: `src/main.js`
- Test: existing tool/pointer/cursor specs
- Test: `tests/no-runtime-patching.spec.js`

**Interfaces:**
- Produces: `ToolController` 只提供普通方法：`setTool(tool)`, `handlePointerDown(event)`, `handlePointerMove(event)`, `handlePointerUp(event)`；不得保存 prototype 原方法，也不得给 editor 实例重新赋方法。
- Workspace 是 DOM 事件的唯一入口，并显式委托 ToolController；未由工具消费的事件继续走 Workspace 默认 selection/interaction 流程。

- [ ] **Step 1: 写失败架构与行为测试**

源码断言禁止 `editor.setTool =`、`editor.onPointerDown =`、`editor.onPointerMove =`、`editor.onPointerUp =`、`Object.getPrototypeOf(editor)`；行为测试验证 pencil/eraser/bucket/shape/text 与 selection pointer 流程各执行一次。

- [ ] **Step 2: 运行目标测试确认失败**

Run: `npx playwright test tests/no-runtime-patching.spec.js tests/*tool*.spec.js tests/*selection*.spec.js`

Expected: 架构断言 FAIL。

- [ ] **Step 3: 删除 install-time method replacement，改为 Workspace 显式委托**

`installToolSystemRuntime()` 若无其他安装职责则删除；若仍负责纯注册数据，则改为普通创建函数并由 Workspace 构造阶段调用。

- [ ] **Step 4: 运行工具/selection/cursor 测试并提交**

Run: `npx playwright test tests/no-runtime-patching.spec.js tests/*tool*.spec.js tests/*selection*.spec.js`

Expected: PASS

Commit: `refactor: 改用显式工具控制器委托`

---

### Task 5: 合并 Workspace 并移除 workspaceCapabilities

**Files:**
- Modify: `src/app/workspace.js`
- Delete: `src/app/v17-workspace.js`
- Modify capability producers as needed, including:
  - `src/transforms/selection-transform.js`
  - `src/rendering/overlay-pipeline.js`
  - `src/media/image-runtime.js`
  - `src/fonts/font-import.js`
  - `src/fonts/font-manager.js`
  - `src/ui/context-menu.js`
  - `src/ui/context-menu-boundary.js`
  - raster/tool modules that currently register Workspace behavior
- Modify: `src/main.js`
- Test: `tests/v17-core-architecture.spec.js`
- Test: `tests/no-runtime-patching.spec.js`
- Test: feature specs for transform/overlay/media/font/context-menu/raster

**Interfaces:**
- Produces: `Workspace` 唯一正式类；所有原 capability 变成显式 import 的普通函数/service，或 Workspace 内的正式方法。
- `globalThis.PixelEditor.ui.Workspace` 只在 Workspace 定义模块中暴露一次；不存在 BaseWorkspace/V17Workspace 二层结构。

- [ ] **Step 1: 写失败架构测试**

递归扫描 `src/**/*.js`，断言：

```js
expect(source).not.toContain('workspaceCapabilities');
expect(source).not.toContain('v17-workspace');
```

同时限定 `PixelEditor.ui.Workspace` 的赋值只允许出现在 `src/app/workspace.js`。

- [ ] **Step 2: 运行架构测试确认失败**

Run: `npx playwright test tests/v17-core-architecture.spec.js tests/no-runtime-patching.spec.js`

Expected: FAIL。

- [ ] **Step 3: 将 V17Workspace 的有效 override 逐项并入唯一 Workspace**

迁移时按能力组处理并删除 base 中已被替代的旧分支：layout、clipboard、transform、overlay、media/font、raster/bucket、cursor/context-menu。每迁移一组就删除对应 capability producer，不保留 fallback。

- [ ] **Step 4: 删除 `v17-workspace.js`，简化启动入口**

`main.js` 不再 import/call `installV17WorkspaceClass()`；bootstrap 直接使用正式 Workspace。

- [ ] **Step 5: 运行相关功能测试并提交**

Run: `npx playwright test tests/v17-core-architecture.spec.js tests/no-runtime-patching.spec.js tests/*transform*.spec.js tests/*overlay*.spec.js tests/*image*.spec.js tests/*font*.spec.js tests/*raster*.spec.js`

Expected: PASS

Commit: `refactor: 合并工作区并移除能力注册层`

---

### Task 6: 收口 Schema 并清理 runtime installer 启动顺序依赖

**Files:**
- Delete: `src/model/v17-schema.js`
- Modify: `src/model/schema.js`
- Modify as needed: `src/model/node.js`, `src/model/page.js`, `src/model/project.js`
- Modify: `src/core/index.js`
- Modify: `src/main.js`
- Modify remaining installer modules that only负责 namespace patch
- Test: `tests/v17-core-architecture.spec.js`
- Test: `tests/architecture-guards.spec.js`

**Interfaces:**
- Produces: canonical model/schema API 只来自 `model/schema.js`, `node.js`, `page.js`, `project.js`；`PROJECT_VERSION === 17`。
- `main.js` 只做显式模块装配与 `bootstrapPixelEdit(globalThis)`，不依赖“覆盖之前定义”的 installer 顺序。

- [ ] **Step 1: 写失败测试**

断言生产入口无 `installV17SchemaRuntime`/`v17-schema`；递归扫描 installer，禁止“读取已有实现 → 保存 Base/old/original → 重新赋值”的模式；加入启动 smoke test，直接加载正式入口后 `PixelEditor.model`、`persistence`、`ui.Workspace` 可用。

- [ ] **Step 2: 运行架构测试确认失败**

Run: `npx playwright test tests/v17-core-architecture.spec.js tests/architecture-guards.spec.js`

Expected: 至少因残留文件/installer 结构 FAIL。

- [ ] **Step 3: 删除 `v17-schema.js` 并把仍需暴露的 API 改为定义模块一次性 export/namespace expose**

不改变 V17 schema 的字段、校验与 serializer 语义。

- [ ] **Step 4: 清理 `main.js` installer 列表**

只保留确实执行初始化副作用且不覆盖既有实现的初始化；纯能力模块改为普通 import/构造调用。

- [ ] **Step 5: 运行模型、序列化、启动测试并提交**

Run: `npx playwright test tests/v17-core-architecture.spec.js tests/architecture-guards.spec.js tests/*schema*.spec.js tests/*serializer*.spec.js`

Expected: PASS

Commit: `refactor: 收口模型架构与启动装配`

---

### Task 7: 清理版本命名并强化架构 Guard

**Files:**
- Rename: `tests/v16-full-workflow.spec.js` → `tests/v17-full-workflow.spec.js`
- Modify: `tests/architecture-guards.spec.js`
- Modify: `tests/no-runtime-patching.spec.js`
- Modify: `tests/v17-core-architecture.spec.js`
- Modify: `package.json` only if a static scan script is added

**Interfaces:**
- Produces: 能阻止本次清理问题重新出现的静态架构测试。

- [ ] **Step 1: 扩展全仓扫描规则**

至少覆盖：prototype method patch、editor/provider method reassignment、class replacement、`workspaceCapabilities`、`v17-workspace`、`v17-schema`、旧 clipboard 文件引用、`version: 16` clipboard payload。

- [ ] **Step 2: 加入误报保护**

允许模块在自己的 canonical 定义文件中一次性 `Object.assign(namespace, { ClassName })` 暴露稳定 API；测试不能把正常定义误判为二次覆盖。

- [ ] **Step 3: 重命名 workflow spec 并跑架构测试**

Run: `npx playwright test tests/architecture-guards.spec.js tests/no-runtime-patching.spec.js tests/v17-core-architecture.spec.js tests/v17-full-workflow.spec.js`

Expected: PASS

- [ ] **Step 4: 提交**

Commit: `test: 强化架构残留防回归检查`

---

### Task 8: 全功能回归、构建与最终残留扫描

**Files:**
- Modify only files required by failures discovered in this task
- No new compatibility layer is allowed as a regression fix

**Interfaces:**
- Produces: 可发布的架构收口分支。

- [ ] **Step 1: 跑完整 Playwright 测试**

Run: `npm test`

Expected: 全部 PASS。

- [ ] **Step 2: 跑生产构建**

Run: `npm run build`

Expected: exit code 0，无 unresolved import / duplicate module error。

- [ ] **Step 3: 跑 production preview 测试**

Run: `npm run test:preview`

Expected: PASS。

- [ ] **Step 4: 做独立全仓残留扫描**

扫描 `src/` 和 `tests/`，确认生产代码中以下结果为零：

```text
workspaceCapabilities
v17-workspace
v17-schema
ProjectFilesV17
AutosaveV17
BaseWorkspace
BaseProjectFiles
provider.renderPreviews =
editor.onPointerDown =
editor.onPointerMove =
editor.onPointerUp =
editor.setTool =
version: 16        # clipboard payload 语义
```

同时检查所有删除文件无 import/reference，所有 runtime installer 都不是覆盖式安装。

- [ ] **Step 5: 根据最终失败只修正式实现，不加 fallback，然后重新执行 Step 1-4**

Expected: 所有验证保持 PASS，静态残留无阻断项。

- [ ] **Step 6: 最终提交**

Commit: `refactor: 完成架构收口并清理重构残留`
