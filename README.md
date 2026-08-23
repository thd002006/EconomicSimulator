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
- `assets/maps`：自包含的地图资产目录；保存可维护的成品数据及其就地生成的 `compiled/` 发布文件。
- `packages/map-runtime`、`tools/map-pipeline`：地图运行时加载，以及成品地图的校验和编译。
- `apps/client` 使用 Three.js WebGL2 渲染可旋转的 3D 地球仪；球面网格由地图发布管线预编译，不在浏览器中即时三角化。
- `mapdata-generator`：独立的上游资料制作子项目，保存 Natural Earth 下载器、缓存规则和草稿生成流程。
- `packages/platform-api`：Web、桌面和 Steam 能力边界。
- `src-tauri`：Tauri 2 桌面壳。

## 常用命令

```powershell
pnpm install
pnpm map:publish
pnpm dev
pnpm sim -- --ticks 100 --seed 42
pnpm check
pnpm tauri:dev
```

`pnpm check` 依次运行 ESLint、TypeScript、Vitest 和 Web 构建。

`pnpm dev` 和 `pnpm build` 会先在每个 `assets/maps/<mapId>/compiled/` 中生成发布文件，再由 Vite 直接读取或打包。发布后的程序只读包内地图，不执行编译，也不向安装目录写文件。游戏构建不会下载 Natural Earth；只有手动进入 `mapdata-generator/` 才会运行上游资料制作流程。

Tauri 命令还需要本机安装 Rust/Cargo 和 Windows C++ 构建工具。Web、Worker、CLI 和测试不依赖 Rust。

## 架构探针的用途

客户端可以初始化一个空模拟、推进 Tick、查询摘要、创建快照和恢复快照。这些行为只用于验证线程通信、确定性和存档边界，不代表最终游戏规则。
