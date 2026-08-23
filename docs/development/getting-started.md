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

# 校验 data-src/maps 中的成品地图包
pnpm map:validate

# 浏览器 + Web Worker（直接读取 data-src/maps，映射为 /maps）
pnpm dev
```

成品地图保存在 `data-src/maps/`。Natural Earth 等公开数据只是某次制作时的可选参考，不是项目地图来源约束。
