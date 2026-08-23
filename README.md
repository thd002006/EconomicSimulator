# Economic Simulator

经济模拟游戏的技术基建仓库。当前只包含架构探针，不包含具体经济玩法。

## 已建立的边界

- `packages/simulation-core`：纯 TypeScript、确定性、平台无关的模拟核心。
- `packages/simulation-protocol`：Worker 的版本化运行时协议。
- `packages/worker-host`：协议与模拟核心之间的适配层。
- `apps/client`：React UI 和 Web Worker 入口。
- `apps/simulation-cli`：不启动 UI 的 Node 运行入口。
- `packages/save-codec`：版本化存档信封、规范化 JSON 和校验和。
- `packages/game-data`：静态数据清单及运行时校验。
- `packages/map-runtime`、`tools/map-pipeline`：地图运行时和 GeoJSON 构建工具基线。
- `packages/platform-api`：Web、桌面和 Steam 能力边界。
- `src-tauri`：Tauri 2 桌面壳。

## 常用命令

```powershell
pnpm install
pnpm dev
pnpm sim -- --ticks 100 --seed 42
pnpm check
pnpm tauri:dev
```

`pnpm check` 依次运行 ESLint、TypeScript、Vitest 和 Web 构建。

Tauri 命令还需要本机安装 Rust/Cargo 和 Windows C++ 构建工具。Web、Worker、CLI 和测试不依赖 Rust。

## 架构探针的用途

客户端可以初始化一个空模拟、推进 Tick、查询摘要、创建快照和恢复快照。这些行为只用于验证线程通信、确定性和存档边界，不代表最终游戏规则。
