# PixelEdit V17 核心架构重构设计

## 目标

将当前“V15 单体 Core + V17 Runtime Patch Stack”重构为真正的 V17 原生架构。完成后，`index.html` 只保留静态 DOM shell，所有模型、命令、渲染、属性、工具、Overlay 与持久化逻辑均由 `src/` 中的正式模块直接组成，不再通过安装顺序、prototype monkey patch、DOM clone、数据伪装或运行时替换来接管旧实现。

本次重构不做旧内部架构兼容，也不保留 V15 runtime。项目文件格式仍以当前 V17 为唯一格式。

## 成功标准

1. 应用直接以 V17 Core 启动，不再先创建 V15 namespace/core 后升级。
2. `src/main.js` 只负责装配依赖和启动应用，不再承担 patch 顺序语义。
3. 不允许以 `originalXxx = prototype.xxx` + `prototype.xxx = wrapper` 作为新架构扩展方式。
4. Raster、Image、Text、Rectangle、Circle、Line、Polygon 都是一等 node type，不再通过临时改成 `image` 或写入 `overlay` 复用旧 renderer。
5. Transform、Hierarchy clipping、Stroke、Binary image 通过统一 RenderContext/NodeRenderer pipeline 组合，不再 clone 整个 project 适配旧 renderer。
6. Properties 每个字段只有唯一的定义、渲染、绑定与命令生成路径；实时预览与历史合并在同一属性会话模型中完成。
7. CommandBus 原生支持 history merge/session、undo/redo、integer geometry boundary，不再后置替换 command class 或 bus 方法。
8. Tool 生命周期统一，所有工具通过 registry 进入同一 `activate/deactivate/pointer/key/options` 流程。
9. Overlay 统一为 layer pipeline，不再多层包裹 `Workspace.renderOverlay()`。
10. 全量 Playwright、生产 build、生产 preview 测试全部通过，并增加架构约束测试防止重新引入 patch-on-core。

## 非目标

- 不改变 400×300、1-bit、无抗锯齿的产品规格。
- 不新增新的用户功能。
- 不迁移旧于 V17 的项目文件。
- 不为了兼容旧 runtime 保留双实现。

## 核心原则

### 单一所有权

每个核心行为必须有唯一 owner：

- Node 创建/规范化：Model schema
- Undo/Redo/事务：CommandBus
- Node 像素输出：NodeRenderer
- 层级裁剪：RenderContext
- 元素属性：PropertyProvider
- 工具事件：ToolController
- 画布辅助 UI：OverlayRenderer

### 显式组合优于运行时覆盖

模块通过 import、constructor dependency、registry 或明确 pipeline 组合。不得依赖“后安装模块覆盖前模块”的顺序。

### Preview 与 Commit 分离

鼠标拖动、属性输入、滚轮、键盘调整等连续交互使用 edit session：

1. begin session
2. preview model change
3. schedule targeted render
4. continue merge
5. commit/blur/pointerup 结束 session
6. 形成一条 history entry

不再使用 `input -> synthetic change`、clone DOM 控件或失焦后补偿刷新。

---

## 阶段 1：建立真正的 V17 Core

### 目标结构

```text
index.html
src/
  main.js
  app/
    workspace.js
    bootstrap.js
  model/
    schema.js
    project.js
    page.js
    node.js
    tree-model.js
    selection-set.js
    asset-store.js
  commands/
    command-bus.js
    node-commands.js
    page-commands.js
  persistence/
    project-serializer.js
    project-files.js
    autosave.js
```

### 处理

- 将 `index.html` 中的 JS core 全部迁出。
- `index.html` 只保留 DOM/CSS shell 和 `<script type="module" src="/src/main.js">`。
- 删除 V15 bootstrap、V15 `PE.version=15`、旧 `fill.value`、旧 workspaceLayout schema 等。
- V17 schema 直接成为模型定义，而不是安装后重写 `M.createPage/createNode/createProject`。
- Raster 与 transform 字段进入 canonical node schema。

### 验收

- 页面加载时 namespace 直接是 V17。
- 无 `installV17SchemaRuntime()`。
- 无任何“先创建旧模型再覆盖”的路径。

---

## 阶段 2：重构 Renderer Pipeline

### 目标结构

```text
rendering/
  renderer.js
  render-context.js
  framebuffer.js
  node-renderers/
    rectangle-renderer.js
    circle-renderer.js
    line-renderer.js
    polygon-renderer.js
    text-renderer.js
    image-renderer.js
    raster-renderer.js
  effects/
    transform.js
    clipping.js
    stroke.js
    fill.js
```

### 接口

```js
renderer.renderPage(project, pageId, assets)
renderer.renderNode(node, context)
renderer.renderSubtree(nodeId, context)
renderer.visualBounds(nodeId, context)
```

`RenderContext` 持有：framebuffer、clip、transform、assets、tree、page。

每个 NodeRenderer 直接理解 canonical node，不得修改 node.type，不得 clone project。

### 删除的兼容策略

- shape fill/stroke -> overlay 的预栅格适配。
- 黑色 page fill -> gap=0 pattern 的伪装。
- raster -> image runtime 适配。
- transform -> image runtime 适配。
- hierarchy clipping 临时替换全局 `plotPixel`。

### 性能要求

- 一次 `renderPage()` 不允许 `structuredClone(project)`。
- 单节点 transform 不允许递归创建完整 project clone。
- clipping 使用 context stack/clip rect，不修改全局函数。

---

## 阶段 3：重构 Properties

### 目标结构

```text
properties/
  property-panel.js
  property-session.js
  property-registry.js
  providers/
    common-provider.js
    transform-provider.js
    rectangle-provider.js
    line-provider.js
    polygon-provider.js
    text-provider.js
    image-provider.js
    raster-provider.js
    page-provider.js
```

### Property descriptor

每个字段用统一 descriptor 描述：

```js
{
  id,
  type,
  label,
  read(selection),
  normalize(value),
  createCommand(value),
  refresh,
  structural,
  historyChannel,
}
```

PropertyPanel 负责根据 selection 组合 provider，不再由多个模块修改 `Properties.prototype.render/bind/typeFields`。

### 实时属性

数字输入统一支持：

- keyboard typing
- ArrowUp / ArrowDown
- native spinner
- mouse wheel（focused control）
- blur/Enter commit
- IME safe text editing

连续编辑保持焦点，只更新 canvas/overlay/previews；除 structural property 外不重建整个 panel。

### 必须删除

- `cloneControl()` listener 清洗策略。
- live-position/text/image/transform 多层 render wrapper。
- shape-style 二次 bind。
- page-fill render 后改 DOM。
- text-font-actions 正则删除按钮。

---

## 阶段 4：CommandBus / History / Integer Geometry

### CommandBus 原生能力

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
```

CommandBus 在唯一提交边界执行 geometry normalization 和 project invariant validation。

### 模型不变量

- editable geometry 全部为整数像素。
- width/height >= 1。
- transform translation 为整数。
- rotation 使用 canonical normalization。
- hierarchy 必须合法。

这些规则不再通过后置包装 `AddNodesCommand.execute`、`UpdateNodesCommand.execute`、`CommandBus.execute` 和临时替换 `normalizeTransform` 实现。

---

## 阶段 5：Tool Registry

### 接口

```js
class Tool {
  activate(ctx) {}
  deactivate(ctx) {}
  pointerDown(event, ctx) {}
  pointerMove(event, ctx) {}
  pointerUp(event, ctx) {}
  keyDown(event, ctx) {}
  renderOptions(container, ctx) {}
  cursor(ctx) {}
}
```

注册：

```js
toolRegistry.register('pointer', pointerTool)
toolRegistry.register('pencil', pencilTool)
toolRegistry.register('eraser', eraserTool)
toolRegistry.register('bucket', bucketTool)
...
```

`Workspace.setTool()` 只负责统一生命周期和 history boundary，不包含 bucket/image 特判。

PaintTarget/EditableTarget 由能力判断统一决定，不再额外包一层 `beginPaint()` 做 edit-boundary。

---

## 阶段 6：Overlay Pipeline

### 结构

```text
OverlayRenderer
  SelectionLayer
  HandleLayer
  SmartGuideLayer
  MarqueeLayer
  TransparencyLayer
  ToolCursorLayer
```

每一层实现：

```js
render(editor, context) -> SVG/DOM fragment
```

最终一次性写入 overlay。

Photopea 八方向 handle 直接成为 HandleLayer 的正式实现，不再覆盖四方向 handle。

---

## 阶段 7：清理兼容层与重复实现

删除已经由新架构替代的 runtime：

- `model/v17-schema.js` 的 installer 形式
- `model/integer-geometry.js` patch installer
- `properties/live-*`
- `properties/page-fill-properties.js`
- `properties/text-font-actions.js`
- `properties/shape-style-properties.js` patch 部分
- `media/raster-sizing.js`
- `media/edit-boundaries.js`
- renderer adapter/patch installers
- tool prototype wrappers
- overlay prototype wrappers
- 无行为的 context-menu bind wrapper

保留纯算法模块，例如：

- dithering/pattern algorithm
- tri-state raster encode/decode
- stroke pixel algorithm
- text layout algorithm
- selection geometry math

但改为正常 import 使用。

---

## 测试策略

### 现有行为回归

保留当前 Playwright 行为测试作为迁移安全网，阶段性重构时不得随意删除通过中的业务断言。

### 新增架构约束测试

1. `index.html` 不得包含 PixelEditor core class/function 定义。
2. `src/` 不得出现新增的 `prototype.xxx = function` runtime patch 模式（允许类自身方法定义）。
3. 不得出现 renderer 为适配而修改 `node.type = 'image'`。
4. `renderPage()` 路径不得 clone project。
5. PropertyPanel 同一 control 不得通过 cloneNode 清 listener。
6. Tool 切换必须全部经过统一 `ToolController.setTool()`。
7. Overlay 只能由统一 OverlayRenderer 提交最终 DOM。

### 交互重点回归

- 属性数字键入即时刷新。
- 鼠标滚轮修改圆角即时刷新。
- ArrowUp/Down 与 spinner 即时刷新。
- blur 后状态不丢失。
- 连续属性调整合并为一条历史。
- rotated/flipped raster/image 的 pencil、bucket、resize 坐标正确。
- nested hierarchy clipping + transform 正确。
- raster 与 vector mixed selection resize 正确。
- undo/redo 后 selection/render/property 一致。

### 性能回归

至少增加：

- 100 个元素 render benchmark。
- 500 个元素 render benchmark。
- 100 次连续属性输入只产生有限 RAF render。
- transform/raster/image 页面确保单帧不执行 project deep clone。

性能测试以相对回归阈值为主，避免 CI 硬件差异造成绝对时间抖动。

---

## 实施顺序与提交策略

严格按以下顺序，每阶段独立保持可运行：

1. `refactor: 建立原生 V17 core`
2. `refactor: 重构统一渲染管线`
3. `refactor: 重构统一属性系统`
4. `refactor: 重构命令与历史事务`
5. `refactor: 建立工具注册与统一生命周期`
6. `refactor: 建立 overlay 渲染管线`
7. `refactor: 删除 runtime patch 与兼容层`
8. `test: 补充架构与性能回归测试`

每个阶段：先建立失败测试/架构约束，再实现，再跑相关测试。最终执行完整 browser regression、production build、production preview。

## 最终边界

重构完成后，`src/main.js` 应接近如下职责：

```js
import { createApplication } from './app/bootstrap.js';

const app = createApplication({ document, window });
app.mount();
```

它不再包含几十个 `install*Runtime()`，也不再通过安装顺序定义业务语义。
