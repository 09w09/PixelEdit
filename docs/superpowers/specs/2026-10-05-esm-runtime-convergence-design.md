# PixelEdit ESM 运行时收口设计

## 目标

将 PixelEdit 的生产运行架构收口为单一 ESM 依赖体系，彻底移除以 `globalThis.PixelEditor` 为 Service Locator 的旧运行时注册层，同时保持现有 V17 工程格式、UI 行为和功能结果不变。

## 最终架构不变量

生产代码必须满足以下条件：

1. `src/**` 不得读取 `globalThis.PixelEditor` / `window.PixelEditor` 作为依赖来源。
2. `src/**` 不得通过 `PixelEditor.* = ...`、`Object.assign(PixelEditor.*)` 或 IIFE side effect 注册生产服务。
3. `install*Runtime()` 数量归零；启动只保留显式 `bootstrap` / `createServices` / `Workspace` 装配。
4. Model、Commands、Rendering、Interaction、Persistence、UI 之间全部通过 ESM import/export 或构造参数依赖。
5. 同一能力只有一个生产实现与一个生产实例：BinaryImagePipeline、Renderer、Image geometry、Image decode 均唯一。
6. Workspace 不再通过 `PE.xxx` 转发子系统能力；需要的服务通过 imports 或 `services` 注入。
7. Schema/Model/Commands 不依赖模块加载顺序或全局注册状态。
8. `src` 中不得保留未进入生产依赖图的兼容 facade、空壳 adapter 或重复实现文件。
9. 如需调试出口，只允许在应用创建完成后单向暴露 `globalThis.PixelEditorDebug`；生产模块不得反向读取它。
10. 所有现有 Playwright 回归、production build、production preview 必须通过。

## 目标结构

```text
src/main.js
  -> app/bootstrap.js
      -> app/services.js
          -> model/*
          -> commands/*
          -> persistence/*
          -> rendering/*
          -> raster/*
          -> transforms/*
          -> fonts/*
          -> ui services
      -> app/workspace.js
      -> debug/debug-api.js   (可选，单向暴露)
```

`main.js` 只负责创建服务、启动应用，不再维护 installer 顺序。

## Model / Commands

- 所有 model 文件改为正常 ESM 导出，不写入全局 namespace。
- `nextId`、`AssetStore`、`TreeModel`、`SelectionSet` 等直接 import。
- Commands 直接 import Model 依赖；CommandBus 显式 import command/session helper。
- `schema.js` 直接 import `TreeModel`，不再读取全局 model。
- Persistence 直接 import `ProjectSerializer` / `AssetStore`。

## Rendering / Media

- `Renderer` 通过明确依赖构造，不读取全局 renderer/model registry。
- `BinaryImagePipeline` 只创建一个实例，并同时供 node renderer 与 property preview 使用。
- `computeImageGeometry()` 成为 bitmap/SVG 共用的唯一 crop/fit 几何实现。
- `decodeRasterImage()` 成为图片 DataURL 解码唯一实现。
- 删除仅承担 ESM -> global bridge 的 renderer 文件或逻辑。

## Services / UI

以下能力都改为显式 module/service：

- FloodFill
- SelectionGeometry
- SelectionTransform
- OverlayPipeline
- ContextMenu
- WorkspaceLayout
- Fonts
- ToolRegistry / ToolController
- PropertyProvider
- CanvasCursor / ToolOptions

这些服务不得依赖 `PixelEditor.*`；跨服务引用在 `createServices()` 中组装，Workspace 只消费最终 service 对象。

## Workspace

Workspace 保留：

- Editor state
- 页面与选择生命周期
- UI mount 协调
- 用户操作入口
- 调度 service

迁出或直接调用 service：

- 图片 decode / SVG hydrate
- FloodFill
- ContextMenu
- Overlay
- Workspace layout
- Font lifecycle
- 文件 IO

目标不是追求特定行数，而是消除 `PE.xxx` facade 和隐式依赖。

## Bootstrap / Debug

`bootstrapPixelEdit()` 接受显式 services 或内部调用 `createServices()`，创建 Workspace 与 ToolController 后 mount。

如果测试仍需要可访问内部状态，使用：

```js
globalThis.PixelEditorDebug = Object.freeze({ app, services });
```

该对象只能由 bootstrap 写入；任何生产模块不得读取。

## 测试策略

先新增架构 RED Guard，当前代码必须失败：

- 扫描 `src/**` 禁止 `globalThis.PixelEditor` / `window.PixelEditor` 生产读取。
- 禁止 `install[A-Za-z]+Runtime`。
- 禁止 side-effect IIFE 注册模式。
- 禁止向 `PixelEditor.*` 写服务。
- 断言 BinaryImagePipeline 只创建一个生产实例。
- 断言图片几何/解码共用唯一 helper。
- 断言 `main.js` 不维护 installer 顺序。

每个子系统迁移后运行针对测试；集成完成后运行：

```text
npm test
npm run build
npm run test:preview
```

最后重新从 `main.js`、import graph、全 `src` tree 做一次独立残留审计，不使用提交历史或本轮修改清单作为检查入口。
