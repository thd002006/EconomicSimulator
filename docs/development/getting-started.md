# 开发环境

## 必需工具

- Node.js 24 或更高版本
- pnpm 11.19.0
- Git

运行 Web、Worker、CLI 和测试：

```powershell
pnpm install
pnpm check
pnpm dev
```

## Tauri 桌面客户端（Steam 发行路径）

本项目**不是纯网页游戏**：Web 只是开发预览。正式运行/发行走 **Tauri 2 桌面壳**（Windows 优先，后续 macOS/Linux），Steam 通过 Platform Services 接入。

额外需要：

- Rust stable 和 Cargo
- Windows：Microsoft C++ Build Tools + WebView2

```powershell
# 打开原生桌面窗口（内嵌同一套 React 客户端）
pnpm tauri:dev

# 打桌面安装包/可执行文件（Steam 上传用构建产物）
pnpm tauri:build
```

`pnpm dev` 仅用于浏览器快速迭代 UI；日常验收桌面体验请用 `pnpm tauri:dev`。

当前 Tauri Capability 只有 `core:default`，没有文件系统或 Shell 权限。未来加入存档时，应通过窄 Tauri Command 或受限插件扩展，不能直接给前端任意路径权限。

Steamworks（成就、云存档、Overlay）按架构文档经 Platform Services + Tauri 原生桥接入，不进入 Simulation Core。

## 验证各入口

```powershell
# Node CLI 直接运行 Simulation Core
pnpm sim -- --ticks 100 --seed 42

# 校验 assets/maps 中可维护的成品地图
pnpm map:validate

# 校验并就地编译到每个地图的 compiled/ 目录
pnpm map:publish

# 浏览器 + Web Worker（启动前会自动执行 map:publish）
pnpm dev
```

每张地图是一个自包含的 `assets/maps/<mapId>/` 目录，其中包括 GeoJSON 几何、稳定 ID、显式关系数据，以及自动生成且忽略提交的 `compiled/`。客户端开发服务器直接读取该目录，发行构建则将 `compiled/` 打包到只读应用资源 `/maps/<id>`；发布后的程序不会向项目或安装目录写文件。

Natural Earth 原始下载文件、缓存、区划归并、首府选择和拓扑简化逻辑统一放在独立的 `mapdata-generator/` 子项目中。它不属于游戏的开发或构建依赖，只有制作或更新底图时才手动运行；其最终候选与审查报告经过人工检查后，再把四个发布文件导入 `assets/maps/<mapId>/`。地图包没有独立城市图层，首府保存在各省份属性中。
