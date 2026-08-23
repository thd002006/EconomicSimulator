# ADR-0001：架构基线

状态：Accepted

## 决策

1. Simulation Core 是纯 TypeScript 包，不依赖 React、DOM、Worker、Tauri 或文件系统。
2. 单个 Web Worker 持有唯一权威 World State。
3. UI 通过版本化 Command/Query/Result/Event 协议访问模拟。
4. 同一核心必须能在 Worker、Node CLI 和测试环境运行。
5. 所有随机行为使用可播种 PRNG，快照包含 PRNG 状态。
6. 存档编码、平台服务和地图渲染通过独立接口隔离。
7. Tauri 2 是桌面壳；Rust 暂不承担经济模拟逻辑。

## 后果

- UI 不得直接修改模拟对象。
- Worker 消息不得传递函数或依赖类原型的对象。
- 新业务模块必须提供明确的输入、输出、Tick 阶段和不变量。
- Rust/WASM、WebGL、多 Worker 和二进制存档只能由基准测试触发。
