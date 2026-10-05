# PixelEdit 架构收口重构设计

日期：2026-10-05

## 目标

本次重构只针对当前 `main` 的生产代码进行架构收口，不迁移旧版本、不兼容旧工程、不保留过渡层。

完成后的判定标准：

1. 生产代码只保留一套 Workspace、Clipboard、ProjectFiles、Autosave、属性预览等正式实现。
2. 启动阶段不再通过覆盖已有类、实例方法或 provider 方法来拼装最终行为。
3. `src/main.js` 只负责显式创建/装配正式模块并启动应用，不承担兼容或补丁职责。
4. `workspaceCapabilities` 过渡注册表彻底移除。
5. V17 作为当前工程格式版本保留，但生产模块不再使用 `v17-*` 作为“覆盖旧实现”的命名和结构。
6. 测试覆盖架构约束，能够阻止运行时替换、双实现和旧版本残留重新进入生产代码。
7. 完整 Playwright 测试、生产构建、production preview 测试全部通过。

## 当前问题

### 1. Workspace 双实现

当前 `src/core/index.js` 先加载 `src/app/workspace.js`，之后 `src/main.js` 再加载 `src/app/v17-workspace.js`，后者继承前者并重新写回 `PE.ui.Workspace`。

这使得 `workspace.js` 中已经废弃的逻辑仍然是基础实现的一部分，例如旧布局状态、旧绘制路径、旧剪贴板调用和旧交互方法。

### 2. 运行时方法和类替换

当前存在多种运行时替换：

- `ToolController.install()` 覆盖 editor 实例方法；
- 图片二值预览模块覆盖 `PropertyProvider.renderPreviews`；
- 偏好模块替换 `ProjectFiles`、`Autosave` 类；
- Clipboard 模块重新赋值 `I.Clipboard`；
- V17 Workspace 重新赋值 `PE.ui.Workspace`。

这些做法虽然绕开了 prototype patch，但仍然属于运行时补丁式装配。

### 3. capability 过渡层

多个模块通过 `PE.workspaceCapabilities.xxx = ...` 注册功能，Workspace 再通过字符串名称查找并转发。

问题包括：

- 依赖关系隐藏在全局命名空间中；
- 缺少静态可追踪性；
- 启动顺序影响正确性；
- 删除模块时容易留下调用入口；
- 测试难以识别是否仍在依赖旧实现。

### 4. 重复和版本残留

当前仍有：

- `src/model/schema.js` 与 `src/model/v17-schema.js` 两套 V17 schema 逻辑；
- `src/interaction/clipboard.js` 与 `src/clipboard/element-clipboard.js` 两套 Clipboard；
- `tests/v16-full-workflow.spec.js` 实际测试 V17；
- Clipboard payload 使用 `version: 16`，与工程格式版本概念混杂。

## 方案比较

### 方案 A：继续保留 installer/capability，仅清理命名

优点：改动最小，回归风险较低。

缺点：没有解决启动顺序、隐藏依赖和双实现问题，本质上仍是当前架构。

不采用。

### 方案 B：单一 Workspace + 显式服务依赖

将 Workspace 收敛为唯一实现；工具、属性、图片、剪贴板、变换等功能作为普通模块/服务由 Workspace 显式调用。允许保留 `globalThis.PixelEditor` 作为浏览器调试/测试 API，但禁止它承担模块依赖注入职责。

优点：

- 改动范围可控；
- 依赖关系清晰；
- 不需要引入框架；
- 能保留现有模块划分和测试主体；
- 可以彻底删除 capability 与运行时覆盖。

缺点：Workspace 仍会负责一定的应用编排。

采用此方案。

### 方案 C：完整 DI / Application 容器重构

建立应用容器，所有模块通过构造函数依赖注入，由容器创建 Workspace、Renderer、ToolController 等。

优点：理论边界最清晰。

缺点：对当前项目规模过重，会把本次“清理残留”扩大为新的架构迁移。

暂不采用。

## 目标架构

```text
src/main.js
  -> app/bootstrap.js
      -> app/workspace.js             唯一 Workspace
          -> tools/tool-controller.js
          -> properties/property-system.js
          -> clipboard/element-clipboard.js
          -> transforms/selection-transform.js
          -> rendering/*
          -> media/*
          -> persistence/*
          -> preferences/*

model/*                               唯一数据模型
commands/*                            唯一命令层
interaction/*                         纯交互基础能力
rendering/*                           纯渲染能力
ui/*                                  UI 组件
```

约束：

- 模块之间通过 ES module import/export 建立生产依赖。
- 不允许通过 `PE.workspaceCapabilities` 注册生产行为。
- 不允许安装器修改已有实例方法。
- 不允许后加载模块覆盖已有类或 provider 方法。
- `PixelEditor` 全局对象只暴露稳定 API 和测试/调试入口，不作为运行时 service locator。

## 具体改造

### 1. Workspace 收口

将 `v17-workspace.js` 中仍然有效的逻辑合并进 `workspace.js`。

同时从 `workspace.js` 删除已被替代的旧实现，而不是保留后再覆盖：

- 旧 clipboard 路径；
- 旧 workspaceLayout 工程字段路径；
- 旧 overlay 拼装；
- 旧 transform / align / distribute 分支；
- 已由正式模块提供的旧图片、栅格和属性处理。

完成后删除 `v17-workspace.js`。

### 2. ToolController 改为显式委托

`ToolController` 保留工具注册表、快捷键、光标和工具分发职责，但不再执行：

```js
editor.setTool = ...
editor.onPointerDown = ...
```

改为 Workspace 自身在事件入口显式调用 controller，例如：

```js
onPointerDown(event) {
  if (this.toolController.handlePointerDown(event)) return;
  return this.handleDefaultPointerDown(event);
}
```

工具切换由 Workspace 的正式 `setTool()` 调用 controller 的状态逻辑，避免双向覆盖。

### 3. Clipboard 单实现

删除 `src/interaction/clipboard.js` 的旧 Clipboard 类。

`src/clipboard/element-clipboard.js` 改为正式 Clipboard 模块，并通过 import 被 Workspace 使用，不再通过 `I.Clipboard = ...` 注入。

Clipboard payload 版本独立命名：

```js
const CLIPBOARD_FORMAT_VERSION = 1;
```

不再使用与工程版本混淆的 `version: 16`。

### 4. Persistence 与 Preferences 收口

`ProjectFiles`、`Autosave` 的最终实现直接位于 persistence 层。

偏好模块只负责：

- 读取；
- 归一化；
- 保存 editor preferences。

不再替换 persistence 类。

Workspace layout 只存在于 editor preferences 中，不进入 project schema。

### 5. PropertyProvider 收口

`PropertyProvider.renderPreviews()` 直接使用 canonical binary image API。

删除 `binary-image-preview.js` 对 `provider.renderPreviews` 的运行时替换；如果绘制辅助函数仍有复用价值，则保留为普通导出函数并由 PropertyProvider import。

### 6. capability 移除

逐项移除：

```text
PE.workspaceCapabilities.*
```

对应能力改成：

- 普通函数直接 import；或
- 明确的对象方法；或
- Workspace 自身方法调用独立 service。

不得建立新的字符串 dispatch/service locator 替代旧 capability。

### 7. Schema 收口

保留：

- `model/schema.js`
- `model/node.js`
- `model/page.js`
- `model/project.js`

删除 `model/v17-schema.js`。

V17 仍是当前工程格式版本，`PROJECT_VERSION = 17` 保留在 canonical schema 中。

### 8. 命名清理

- `tests/v16-full-workflow.spec.js` 重命名为与当前版本无关或 V17 对应名称；
- 生产文件名不再使用 `v17-` 作为覆盖层含义；
- 保留用户可见的 V17 工程格式提示，除非后续单独决定移除版本品牌。

## 测试策略

采用测试先行方式处理每类架构约束。

### 架构测试新增检查

生产 `src/` 中禁止以下模式：

1. `.prototype.method = ...`；
2. `editor.someMethod = ...` 形式的方法安装；
3. `provider.someMethod = function ...` 形式的方法替换；
4. `PE.ui.Workspace = ...` 的二次覆盖；
5. `P.ProjectFiles = class ...`、`P.Autosave = class ...` 的二次覆盖；
6. `workspaceCapabilities`；
7. 生产代码引用 `v17-workspace` 或 `v17-schema`；
8. `src/interaction/clipboard.js` 旧实现重新出现；
9. Clipboard payload 使用工程版本号表示自身格式。

允许模块在自己的定义文件中一次性向 `PixelEditor` 暴露稳定 namespace API，但不得通过后加载模块覆盖另一个模块已定义的行为。

### 功能回归

完整执行：

```bash
npm test
npm run build
npm run test:preview
```

重点确认：

- 新建/打开/保存工程；
- autosave；
- 页面与图层；
- 选择/多选；
- copy/paste/duplicate；
- 所有绘制工具；
- raster 编辑；
- bucket；
- transform；
- align/distribute；
- image/SVG/XBM；
- font/text；
- property live preview；
- overlay/cursor/context menu；
- 导出 1-bit PNG；
- 工程序列化 round-trip。

## 删除条件

以下文件只有在调用方全部迁移且测试通过后删除：

- `src/app/v17-workspace.js`
- `src/model/v17-schema.js`
- `src/interaction/clipboard.js`

`src/rendering/binary-image-preview.js` 根据最终职责决定：

- 若只剩运行时 patch，则删除；
- 若保留纯绘制函数，则改为普通 utility 并由调用者显式 import。

## 非目标

本次不做：

- UI 视觉改版；
- 新工具或新功能；
- V16/V15 工程迁移；
- 新工程格式设计；
- React/Vue 等框架迁移；
- 为未来插件系统提前设计 DI 容器。

## 完成定义

满足以下条件才算完成：

1. 生产代码中不存在上述运行时覆盖模式；
2. Workspace、Clipboard、Schema、Persistence 各只有一套正式实现；
3. `workspaceCapabilities` 为零；
4. 不存在 `v17-workspace.js`、`v17-schema.js` 和旧 Clipboard 实现；
5. 架构 guard 能检测并阻止这些模式回归；
6. 全部现有功能测试通过；
7. build 与 production preview 测试通过；
8. 最后再进行一次独立全仓静态残留扫描，结果无阻断项。
