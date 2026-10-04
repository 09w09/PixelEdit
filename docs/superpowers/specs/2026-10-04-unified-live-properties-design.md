# 统一属性实时预览事务设计

## 目标

将 PixelEdit 右侧属性面板中所有可写属性统一为“编辑即预览”的交互模型：用户键入、滚轮调整、选择选项或切换复选框后，模型与画布立即反映结果，不需要失焦或点击画布；同时连续编辑不销毁当前控件，不破坏输入焦点、文本光标、IME 组合输入或滚轮操作。

本次仅重构属性面板编辑链路，不改变项目文件格式，不改变工具栏默认参数，不改变画布手柄拖拽语义。

## 当前问题

当前 Properties 将不同属性分散绑定在 `bindPage()`、`bind()`、`bindDither()`、`bindPattern()`、`bindText()`、`bindImage()` 以及 shape/raster runtime 中，大量控件仅监听 `change/onchange`。普通 `editor.exec()` 又会触发完整 UI 刷新，若直接把这些监听器替换为 `input`，高频编辑会反复重建属性 DOM，导致焦点、滚轮、光标和 IME 状态丢失。

矩形圆角已经存在局部实时编辑实现，但它是 shape runtime 的特例，继续逐字段复制会形成更多重复的事务、刷新和历史逻辑。

## 核心设计

新增统一的 Property Edit Session 运行时，负责属性控件的生命周期，而各业务模块只声明“控件如何读取、规范化并生成命令”。

一次连续编辑分为三个阶段：

1. `begin`：控件获得焦点或开始离散编辑时建立会话，按控件/属性通道打断上一条 history merge chain。
2. `preview`：每次有效输入立即执行语义命令，但直接走 `editor.bus.execute()`，禁止重建整个属性面板；根据声明刷新 canvas、overlay、局部 preview、layers 等必要区域。
3. `end`：blur、Enter 确认、结构切换、选区变化等结束会话，打断 merge chain，补齐 history 与必要的完整属性同步。

同一控件的一次焦点会话内，连续修改共享固定 `historyChannel`，因此只形成一个 Undo 步骤。再次聚焦、切换属性、切换选区或执行其他命令必须形成新的历史边界。

## 控件类型

统一 binder 支持以下类型：

- `number`：监听 `input`；焦点内 wheel 使用 `stepUp/stepDown` 后进入同一 preview 路径；支持 min/max、整数归一化和 mixed value。
- `text`：监听 `input`，立即更新名称等普通文本属性。
- `textarea`：监听 `input`，但 composition 期间不提交；`compositionend` 后提交，保证中文 IME 正确。
- `select`：`change` 本身就是离散即时事件，直接提交并按需刷新结构区域。
- `checkbox`：`change` 立即提交。

空字符串、非法数字等中间输入状态不得把 NaN 写入模型；blur 时若仍无有效值，恢复模型当前值。

## 刷新策略

运行时提供声明式 refresh flags，而不是调用普通 `editor.exec()`：

- `canvas`：绝大多数视觉属性与几何属性。
- `overlay`：位置、尺寸、几何变化。
- `preview`：抖动、图案、图片二值化等属性预览。
- `layers`：名称、可见、锁定等会影响图层 Dock 的属性。
- `properties`：默认编辑期间为 false，只有结构型属性需要局部或延迟同步。
- `history`：连续编辑期间不高频重绘，在会话结束时同步。

同一事件循环中的高频视觉刷新使用 animation frame 合并；模型命令仍同步执行，因此读取模型值时立即可见。

## 结构型属性

以下属性会改变属性面板可见字段，不能简单禁止重建：

- 页面/元素填充模式：solid / dither / pattern。
- 图片黑白模式：threshold / dither。
- 图片抖动算法及 Bayer 矩阵子选项。
- 多边形顶点数量。

处理原则：离散结构切换提交后允许重新渲染属性面板，因为 select/checkbox 不存在连续文本光标；多边形顶点数量属于 number 连续编辑，需要保留 `propPointCount` 控件本身，仅重建 `polygonPointList` 子区域并重新绑定动态顶点字段。会话结束后再执行完整属性同步。

## 业务覆盖矩阵

### 页面

- 名称
- 锁定
- 背景填充模式
- 背景纯色
- 抖动：类型、密度、矩阵、对齐、X/Y 偏移
- 图案：类型、线宽、间距、对齐、X/Y 偏移

### 所有元素通用

- 名称
- 可见
- 锁定
- X / Y
- 支持尺寸的元素：W / H / 锁定比例

### 直线

- X1 / Y1 / X2 / Y2
- 描边宽度、颜色、样式

### 矩形

- 四个圆角
- 描边宽度、颜色、样式
- 填充模式、填充颜色
- 抖动全部属性
- 图案全部属性

### 圆

- 描边宽度、颜色、样式
- 填充模式、填充颜色
- 抖动全部属性
- 图案全部属性

### 多边形

- 顶点数量
- 每个顶点 X / Y
- 描边宽度、颜色、样式
- 填充模式、填充颜色
- 抖动全部属性
- 图案全部属性

### 文字

- 内容
- 字体
- 字号
- 字距
- 行距
- 水平/垂直对齐
- 自动换行
- 粗体
- 黑底白字
- 填充模式、颜色、抖动、图案

### 图片

- 适应方式
- 插值
- Crop X / Y / W / H
- 黑白模式
- 阈值
- 抖动算法
- Bayer 矩阵
- 反相

### 栅格

栅格继续复用 transform compatibility 层，只接入通用属性、X/Y、W/H、锁定比例；固定像素内容本身不是属性面板可编辑字段。

## 模块边界

新增 `src/properties/live-property-runtime.js`：

- PropertyEditSession
- number/text/textarea/select/checkbox binder
- history boundary
- lightweight render scheduler
- mixed/invalid input handling
- selection/change cancellation hook

现有模块改造：

- `shape-style-properties.js` 删除圆角专用 session 实现，改为注册统一 binder。
- `text-content-editing.js` 将现有 IME 特例迁移到统一 textarea binder，保留兼容安装入口或删除重复实现。
- `page-fill-properties.js` 使用统一 binder。
- Properties 原始 `bind*` 路径通过 runtime 覆盖或按模块拆分，避免继续堆叠 `onchange` 特例。
- `main.js` 在依赖属性模块前安装统一 runtime。

不修改 `Workspace.exec()` 的全局语义，不通过合成 DOM `change` 事件复用旧逻辑。

## 历史与事务约束

- 一次 number/text/textarea 聚焦会话 = 一个 Undo 步骤。
- 同一属性连续滚轮与键入必须合并。
- 失焦后再次编辑必须形成新步骤。
- 不同属性不能错误合并。
- 不同选区不能错误合并。
- select/checkbox 每个离散用户动作形成独立步骤，除非业务已有明确连续语义。
- Undo/Redo 后使用正常完整 render，属性面板与画布必须一致。

## 性能约束

高频连续输入期间不得重建整个 Properties DOM，不得重绘 Layer Dock 或 History Dock，除非该属性声明需要；canvas/overlay 最多按 animation frame 合并刷新。测试中会记录 100 次连续数字输入的同步处理时间、属性面板 render 次数和 canvas render 次数，防止恢复到每输入一次 full render 的实现。

## 测试方案

新增统一属性实时预览测试套件，使用数据驱动覆盖矩阵，同时保留已有功能测试。

必须覆盖：

1. 每个元素类型的所有可写属性都能立即更新模型。
2. 影响视觉的属性在 blur 前已改变 framebuffer 或对应 preview。
3. 所有 number 属性支持键入实时更新；适合 wheel 的 number 属性支持焦点内滚轮实时更新。
4. text/textarea 保持焦点和 selection/caret；中文 IME composition 正确。
5. select/checkbox 立即更新。
6. 单选、多选、mixed value。
7. min/max clamp 与非法临时输入。
8. 多边形顶点数实时变化且动态顶点列表正确更新。
9. fill/image mode 等结构属性重建后新字段可继续实时编辑。
10. 页面属性与元素属性一致工作。
11. raster transform 属性一致工作。
12. 同一会话历史合并，不同会话/不同属性/不同选区正确断开。
13. Undo/Redo 后模型、画布、属性控件一致。
14. locked 状态不可编辑。
15. 高频输入性能与 pageerror/console error 监测。
16. 全部既有 Playwright 测试。
17. Vite production build。
18. production preview 全套 Playwright 测试。

## 提交流程

实现过程在 `wip/unified-live-properties` 临时分支进行，可产生设计、RED、实现和修复提交。所有验证通过后，从最终验证过的 tree 创建一个以当前 main 基线 `bb9ed923b1f930d7969041dfb879b180afe7b806` 为父提交的正式提交，再 fast-forward `main`。因此 main 最终只新增一次代码提交。
