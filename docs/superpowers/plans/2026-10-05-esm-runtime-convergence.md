# PixelEdit ESM Runtime Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PixelEdit 生产运行收口为唯一 ESM 依赖体系，移除 `globalThis.PixelEditor` Service Locator、runtime installer、重复 pipeline 与重复图片处理实现。

**Architecture:** 先用架构 Guard 固定最终不变量，再按 Model/Commands、Rendering/Media、Services/UI、Bootstrap/Workspace 四层自底向上迁移。跨层依赖只通过 ESM import/export 或 `createServices()` 显式注入；调试对象只允许 bootstrap 单向暴露。

**Tech Stack:** JavaScript ES Modules、Vite、Playwright

**Spec:** `docs/superpowers/specs/2026-10-05-esm-runtime-convergence-design.md`

## Global Constraints

- V17 工程格式保持不变。
- 不保留旧 runtime installer / compatibility facade。
- `src/**` 生产依赖不得读取 `globalThis.PixelEditor`。
- 同能力只能有一个生产实现和一个生产实例。
- 每个任务先 RED 再 GREEN，并单独提交中文 conventional commit。
- 最终必须通过 `npm test`、`npm run build`、`npm run test:preview`。

## Review Focus

- 启动顺序变化后，页面初始化、ToolController 与 PropertyProvider 是否仍在首次 mount 前完整可用。
- 打开/保存/自动保存后 AssetStore 与 V17 schema 校验是否保持一致。
- PNG/SVG/XBM 图片导入、contain/cover/original crop 路径是否共用同一 geometry 且像素结果不变。
- Text/Image/Overlay renderer 去全局 registry 后是否保持 1-bit framebuffer 输出一致。
- Debug API 是否单向暴露且生产代码不存在反向读取。

---

### Task 1: 最终架构 Guard

**Files:**
- Create: `tests/esm-runtime-convergence.spec.js`
- Modify: `tests/no-runtime-patching.spec.js`

**Interfaces:**
- Consumes: 当前 `src` tree。
- Produces: 最终架构不变量 Guard。

- [ ] **Step 1:** 新增失败测试，递归扫描 `src/**`，禁止 `globalThis.PixelEditor` / `window.PixelEditor`、`install*Runtime`、IIFE service registration、`PixelEditor.*` service writes；只允许未来的 `debug/debug-api.js` 单向写 `PixelEditorDebug`。
- [ ] **Step 2:** 运行 `npx playwright test tests/esm-runtime-convergence.spec.js`，确认当前代码 FAIL。
- [ ] **Step 3:** 增加 BinaryImage 单实例、唯一 image geometry/decode helper、`main.js` 无 installer 顺序的静态约束。
- [ ] **Step 4:** 再次运行同一测试，确认失败项准确覆盖当前残留。
- [ ] **Step 5:** 提交 `test: 固定 ESM 运行时收口约束`。

### Task 2: Model / Commands / Persistence ESM 化

**Files:**
- Modify: `src/model/*.js`
- Modify: `src/commands/*.js`
- Modify: `src/persistence/*.js`
- Modify: `src/clipboard/element-clipboard.js`
- Modify: related tests

**Interfaces:**
- Produces: `nextId`, `AssetStore`, `TreeModel`, `SelectionSet`, project helpers, command classes, `CommandBus`, `ProjectSerializer`, `ProjectFiles`, `Autosave`, `ElementClipboard` 的正常 ESM exports。
- Consumes: 无全局 service registry。

- [ ] **Step 1:** 为 model/commands/persistence 不读取全局 namespace 添加针对失败断言。
- [ ] **Step 2:** 将 legacy IIFE 文件改为 ESM import/export；`schema.js` 直接 import `TreeModel`。
- [ ] **Step 3:** Persistence 直接 import `ProjectSerializer`/`AssetStore`，Clipboard 默认依赖改为显式 import。
- [ ] **Step 4:** 运行 model/command/persistence/clipboard 相关 Playwright 测试并修复。
- [ ] **Step 5:** 提交 `refactor: 将模型命令与持久化改为显式 ESM`。

### Task 3: Rendering / Media 唯一化

**Files:**
- Modify: `src/rendering/*.js`
- Modify: `src/rendering/node-renderers/*.js`
- Modify: `src/media/*.js`
- Create or Modify: `src/media/image-geometry.js`
- Modify: related tests

**Interfaces:**
- Consumes: Task 2 的 ESM Model API。
- Produces: 唯一 `Renderer`、唯一 `BinaryImagePipeline`、`computeImageGeometry()`、`decodeRasterImage()`。

- [ ] **Step 1:** 新增 RED 测试，断言 BinaryImagePipeline 单实例和 image geometry/decode 唯一入口。
- [ ] **Step 2:** 提取 `computeImageGeometry(node, sourceWidth, sourceHeight)`，bitmap 与 SVG 共用。
- [ ] **Step 3:** 统一 `decodeRasterImage()`，删除 Workspace/Media 重复解码逻辑。
- [ ] **Step 4:** Renderer 直接注入 ESM model/runtime dependencies；删除 renderer global writes 和 ESM->global bridge。
- [ ] **Step 5:** Property preview 与 node renderer 共用同一个 BinaryImagePipeline 实例。
- [ ] **Step 6:** 运行 rendering/image/svg/text/line 等相关测试。
- [ ] **Step 7:** 提交 `refactor: 统一渲染与图片处理管线`。

### Task 4: Services / UI 去全局 Service Locator

**Files:**
- Modify: `src/raster/*.js`
- Modify: `src/selection/*.js`
- Modify: `src/transforms/*.js`
- Modify: `src/fonts/*.js`
- Modify: `src/tools/*.js`
- Modify: `src/properties/property-system.js`
- Modify: `src/ui/*.js`
- Modify: `src/preferences/*.js`
- Create: `src/app/services.js`

**Interfaces:**
- Consumes: Task 2/3 ESM APIs。
- Produces: `createServices()` 返回显式 services；服务模块不读取/写入 `PixelEditor`。

- [ ] **Step 1:** 加 RED 断言覆盖所有 services/UI 文件的 global access 和 installer。
- [ ] **Step 2:** 将 FloodFill、SelectionGeometry、SelectionTransform、Overlay、ContextMenu、WorkspaceLayout、Fonts、Tools、Properties 改成显式函数/class/service factory。
- [ ] **Step 3:** `createServices()` 统一创建需要共享实例的 Renderer/BinaryImage/Overlay/Property/Tool registry。
- [ ] **Step 4:** UI classes 改为 ESM export；删除 IIFE 注册和旧 facade-only API。
- [ ] **Step 5:** 运行 UI/tool/property/fill/transform/font 相关测试。
- [ ] **Step 6:** 提交 `refactor: 将界面与服务改为显式依赖`。

### Task 5: Bootstrap / Workspace 最终收口

**Files:**
- Modify: `src/app/workspace.js`
- Modify: `src/app/bootstrap.js`
- Modify: `src/main.js`
- Delete: `src/core/index.js`
- Delete or reduce: `src/core/namespace.js`
- Create: `src/debug/debug-api.js`
- Modify: architecture tests

**Interfaces:**
- Consumes: `createServices()`。
- Produces: `bootstrapPixelEdit()`、无 `PE.xxx` 的 Workspace、可选单向 `PixelEditorDebug`。

- [ ] **Step 1:** 新增 RED 断言：Workspace 中 `PE.xxx`/`globalThis.PixelEditor` 为 0，main 中 installer 为 0。
- [ ] **Step 2:** Workspace 构造函数接受显式 services，移除所有 `PE.xxx` 转发和重复 decode。
- [ ] **Step 3:** bootstrap 调用 `createServices()`，创建 Workspace/ToolController 并 mount。
- [ ] **Step 4:** `main.js` 缩为显式 bootstrap 入口；删除 `core/index.js` side-effect graph 与旧 namespace。
- [ ] **Step 5:** 如测试需要，新增 `PixelEditorDebug` 单向暴露，不允许生产模块读取。
- [ ] **Step 6:** 运行 `npx playwright test tests/esm-runtime-convergence.spec.js`，确认最终 Guard 全绿。
- [ ] **Step 7:** 提交 `refactor: 移除全局运行时注册层`。

### Task 6: 独立全仓复审与最终验证

**Files:**
- Modify only when复审发现真实缺陷。

**Interfaces:**
- Consumes: 完成后的生产树。
- Produces: 可验证的最终收口结果。

- [ ] **Step 1:** 从 `src/main.js` 重新建立生产 import graph，不参考本轮修改清单。
- [ ] **Step 2:** 全 `src` 扫描 global service locator、runtime installer、IIFE registration、重复 pipeline、重复 image geometry/decode、孤立文件。
- [ ] **Step 3:** 若发现问题，先补 RED Guard 再修复并提交 `test/refactor` 对应提交。
- [ ] **Step 4:** 运行 `npm test`，要求全部通过。
- [ ] **Step 5:** 运行 `npm run build`，要求成功。
- [ ] **Step 6:** 运行 `npm run test:preview`，要求全部通过。
- [ ] **Step 7:** 最终只在上述静态不变量与三项全量验证都通过后，判定“架构收口完成”。
