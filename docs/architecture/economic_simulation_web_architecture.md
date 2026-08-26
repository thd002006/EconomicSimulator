# 经济模拟游戏 Web 技术架构方案

> 文档状态：可执行架构基线（Architecture Baseline）  
> 目标平台：Windows 优先，后续支持 macOS / Linux，并通过 Steam 发行  
> 核心路线：React + TypeScript + Canvas/SVG + Web Worker + Tauri 2  
> 核心原则：先完成可验证、可观测、可回放的经济模拟实验室，再逐步扩展为完整游戏

---

## 1. 文档目的与范围

本文档用于确定项目的技术架构、模块边界、数据流、性能演进和桌面发行方案。它不负责定义具体经济机制、玩家身份、胜负条件或内容规模，但会规定这些内容未来应当如何接入系统。

本项目是一款以经济模拟为核心的策略/模拟游戏，预期包含：

- 大量省份、国家和聚合经济主体；
- 人口、企业、商品、市场、生产、贸易、运输、财政等系统；
- 2D 世界地图和省份级数据着色；
- 道路、铁路、港口、城市和贸易路线；
- 大量数据面板、图表和实体 Inspector；
- 可暂停、变速、长期运行和批量测试的模拟时间；
- 独立存档、版本迁移和确定性回放能力；
- Windows 桌面发行，并预留 macOS、Linux、Web 和 Steam 平台适配；
- 适合 AI 辅助开发、自动测试和持续重构的工程结构。

### 1.1 本阶段不解决的问题

以下内容不作为当前架构定稿的前置条件：

- 完整的游戏规则和数值平衡；
- 最终世界地图和历史数据；
- UI 美术风格；
- 是否模拟到单个居民或单个企业；
- 最终支持多少模组和本地化语言；
- 是否将某些热点迁移到 Rust/WASM。

这些内容可以后续决定，但必须遵守本文档定义的模块边界和数据接口。

---

## 2. 架构结论

项目采用以下技术路线：

| 模块     | 技术与职责                                                                            |
| -------- | ------------------------------------------------------------------------------------- |
| UI       | React + TypeScript，负责界面、面板、图表和交互                                        |
| 地图     | 可维护的成品地图源；构建时生成运行格式；Canvas 2D 渲染；归属由 UI Read Model 驱动样式 |
| 模拟核心 | 纯 TypeScript 包，不依赖 React、DOM、Tauri 或文件系统                                 |
| 模拟线程 | 单个 Web Worker 起步，负责持有和推进权威 World State                                  |
| 通信     | 版本化 Command / Query / Event / Snapshot 协议                                        |
| 静态数据 | 仓库维护成品 GeoJSON 与 JSON；游戏只加载构建后、校验过的运行格式                      |
| 存档     | 版本化快照；初期 JSON，规模增长后可替换为压缩或二进制编码                             |
| 自动测试 | Node.js 环境直接运行 Simulation Core，不启动 React 或 Tauri                           |
| 桌面壳   | Tauri 2，负责窗口、文件系统、设置、日志和平台原生能力                                 |
| Steam    | 通过 Platform Services 抽象和 Tauri 原生桥接接入                                      |
| 性能优化 | 基准测试 → TypeScript 数据结构优化 → 可转移缓冲区 → 必要时 Rust/WASM                  |

### 2.1 默认工程工具

以下工具作为项目起步默认值，可在有明确理由时通过 ADR 替换：

| 用途                     | 默认选择                                       |
| ------------------------ | ---------------------------------------------- |
| JavaScript 运行环境      | 当前 Node.js LTS                               |
| 包管理与多包仓库         | pnpm workspace                                 |
| 前端构建                 | Vite                                           |
| 单元、场景和回放测试     | Vitest                                         |
| 浏览器/Tauri UI 冒烟测试 | Playwright 或等价自动化方案                    |
| 代码质量                 | TypeScript strict mode + ESLint + Prettier     |
| 图表                     | ECharts；业务层通过统一 Chart Adapter 提供数据 |
| 数据校验                 | JSON Schema + 运行时 Schema 校验器             |
| 桌面构建                 | Tauri 2 CLI + Cargo                            |

依赖版本应由 lockfile 固定；升级构建工具、Schema 校验器或 Tauri 主版本时，必须运行完整回放、存档和桌面冒烟测试。

第一阶段“不引入 Rust”的准确含义是：

> 第一阶段不使用 Rust 编写经济模拟逻辑，也不提前将模拟迁移到 WASM。Tauri 自身仍需要 Rust 工具链，并允许使用少量 Rust 代码实现平台桥接。

---

## 3. 架构目标与质量属性

所有技术决策优先满足以下目标：

1. **正确性**：状态变化可解释，关键存量和流量可以对账。
2. **确定性**：相同版本、初始状态、随机种子和命令序列产生相同结果。
3. **可观测性**：可以查看任意核心实体、市场和 Tick 阶段的状态。
4. **可测试性**：模拟不依赖 UI，可以高速批量运行和回放。
5. **响应性**：模拟计算不会阻塞地图和 UI 交互。
6. **可扩展性**：可以逐步增加经济模块，而不破坏现有模块边界。
7. **可迁移性**：热点计算未来可以迁移到 Rust/WASM，而不改变 UI API。
8. **可恢复性**：存档可校验、可迁移，异常退出不轻易破坏最近的有效存档。
9. **平台隔离**：Web、Tauri、Steam 的差异不进入 Simulation Core。
10. **AI 可维护性**：类型明确、文件职责单一、规则可测试、重要决策有文档。

---

## 4. 初始规模与性能预算

“大量主体”必须转化为可测试的数量级。以下数值是架构基准，不是最终玩法承诺；完成第一个垂直切片后应根据实际需求修订。

| 指标                      | 标准基准场景 | 压力测试场景 |
| ------------------------- | -----------: | -----------: |
| 国家                      |          200 |          500 |
| 省份                      |        2,000 |        5,000 |
| 商品                      |           80 |          200 |
| 人口 Class 聚合单元       |       22,000 |       55,000 |
| Economic Unit             |       50,000 |      200,000 |
| 运输节点                  |       20,000 |      100,000 |
| 运输边                    |       50,000 |      250,000 |
| UI 同时显示的动态地图对象 |       10,000 |       50,000 |

初始非功能目标：

| 项目        | 目标                                                                     |
| ----------- | ------------------------------------------------------------------------ |
| UI 交互     | 暂停或正常速度下，常用操作无明显卡顿；目标 60 FPS，低端设备最低 30 FPS   |
| Worker 消息 | 常规状态增量不发送完整 World State；单条消息尽量小于 1 MB                |
| 正常模拟    | 标准基准场景下持续运行，无长时间主线程阻塞                               |
| 高速模拟    | 可以跳过中间 UI 刷新；具体倍速由基准测试决定，不预先承诺 50x/100x        |
| 内存        | 标准场景目标控制在 1.5 GB 以内                                           |
| 存档        | 标准场景压缩后目标小于 100 MB，读取目标小于 5 秒                         |
| 稳定性      | 自动连续运行至少 100,000 Tick，不出现 NaN、Infinity 或不可解释的守恒破坏 |

必须指定一台“基准测试机器”并记录 CPU、内存、系统和 WebView 版本。所有性能结论都应标明测试环境，不能只记录倍率。

---

## 5. 总体架构与依赖方向

```text
┌──────────────────────── Tauri Desktop Shell ────────────────────────┐
│  Window / File System / Settings / Logs / Steam / Native Services   │
│                              │                                       │
│                       Platform Services                              │
│                              │                                       │
│  ┌──────────────────── React Frontend ────────────────────────────┐  │
│  │ Map / Panels / Charts / Inspector / Menus / UI Read Model     │  │
│  └───────────────────────────┬────────────────────────────────────┘  │
│                              │ Simulation Protocol                   │
│  ┌───────────────────────────▼────────────────────────────────────┐  │
│  │                       Web Worker Host                          │  │
│  │ Command Router / Query Router / Snapshot Publisher / Metrics  │  │
│  └───────────────────────────┬────────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────▼────────────────────────────────────┐  │
│  │                    Simulation Core                            │  │
│  │ World State / Scheduler / Economic Modules / PRNG / Ledger    │  │
│  └───────────────────────────┬────────────────────────────────────┘  │
│                              │                                       │
│                   Compiled Static Game Data                         │
└──────────────────────────────────────────────────────────────────────┘

同一 Simulation Core 还可由以下程序直接调用：

Node Test Runner / Simulation CLI / Benchmark Runner / Save Migrator
```

### 5.1 强制依赖规则

- Simulation Core 不得依赖 React、DOM、Canvas、Web Worker、Tauri 或 Steam。
- Worker Host 可以依赖 Simulation Core 和 Simulation Protocol。
- React Frontend 只依赖 Simulation Protocol、UI 类型和 Platform API。
- Static Game Data 的校验和编译工具不得依赖游戏 UI。
- Tauri/Steam 只通过 Platform Services 暴露最小能力。
- 地图渲染对象不是游戏状态，不进入存档。
- UI 缓存不是权威状态，重新载入页面后必须能够从模拟快照恢复。

### 5.2 推荐仓库结构

```text
project/
├── apps/
│   ├── client/                    # React 前端和 Worker 入口
│   └── simulation-cli/            # 无 UI 批量模拟、回放和基准测试
│
├── packages/
│   ├── simulation-core/           # 纯 TypeScript 模拟核心
│   │   ├── world/
│   │   ├── scheduler/
│   │   ├── population/
│   │   ├── economic-units/
│   │   ├── production/
│   │   ├── markets/
│   │   ├── trade/
│   │   ├── transport/
│   │   ├── government/
│   │   ├── finance/
│   │   ├── statistics/
│   │   └── testing/
│   ├── simulation-protocol/       # Command / Query / Event 类型与版本
│   ├── game-data/                 # 静态定义、Schema 和运行时数据加载
│   ├── map-runtime/               # 地图运行格式、空间索引、拾取
│   ├── platform-api/              # 文件、日志、Steam 等抽象接口
│   └── shared-types/              # 少量真正跨边界的基础类型
│
├── tools/
│   ├── map-pipeline/              # 成品地图校验与运行格式编译
│   ├── data-validator/            # 游戏数据引用和单位校验
│   └── save-migrator/             # 存档迁移与检查工具
│
├── tests/
│   ├── invariants/
│   ├── replay/
│   ├── long-run/
│   ├── integration/
│   └── performance/
│
├── assets/
│   └── maps/                     # 自包含地图：成品源数据及其 compiled/ 发布文件
├── mapdata-generator/             # 独立的 Natural Earth 下载、缓存和草稿制作子项目
├── src-tauri/                     # Tauri 2 桌面壳与原生桥接
└── docs/
    ├── architecture/
    └── adr/                       # Architecture Decision Records
```

推荐使用 workspace 管理多个 TypeScript 包，保证 Simulation Core、协议和客户端拥有明确的包边界。

---

## 6. Simulation Core

### 6.1 核心职责

Simulation Core 是权威世界状态的拥有者，负责：

- 初始化新世界；
- 校验并执行玩家或 AI 命令；
- 按固定顺序推进模拟时间；
- 维护人口、企业、库存、现金、债务等状态；
- 生成事件、统计指标和可供 UI 使用的只读数据；
- 生成和恢复可序列化快照；
- 暴露测试、回放和性能计量入口。

建议核心 API 保持精简：

```ts
interface SimulationEngine {
  initialize(input: NewWorldInput): InitializeResult;
  dispatch(command: SimulationCommand): CommandResult;
  advance(tickCount: number): AdvanceResult;
  query<T extends SimulationQuery>(query: T): QueryResult<T>;
  createSnapshot(): SimulationSnapshot;
  restoreSnapshot(snapshot: SimulationSnapshot): RestoreResult;
}
```

接口可以由类实现，但跨 Worker 边界只传递普通可序列化对象。

### 6.2 模块契约

每个经济模块必须说明：

- 读取哪些状态；
- 修改哪些状态；
- 在哪个 Tick 阶段执行；
- 输入和输出的单位；
- 产生哪些事件和统计指标；
- 必须满足哪些不变量；
- 是否使用随机数；
- 算法复杂度及预期数据规模。

禁止模块通过全局单例随意修改其他模块状态。跨模块变化应通过明确的 World API、交易记录或阶段输出完成。

### 6.3 初始模块划分

```text
Simulation
├── World & Calendar
├── Population & Households
├── Economic Units & Industries
├── Commodities & Inventory
├── Production
├── Labor Market
├── Goods Markets & Prices
├── Trade & Transportation
├── Government & Taxation
├── Banking & Finance
├── Technology
├── Events
├── Statistics
└── Accounting Ledger
```

模块划分是代码边界，不代表必须在第一阶段一次性实现全部机制。

---

## 7. 模拟时间、Tick 调度与确定性

### 7.1 时间与渲染分离

```text
UI / Rendering：尽可能保持 60 FPS
Simulation：固定 Tick，速度由调度器控制
Statistics：按需要采样，不必每个 Tick 全量计算
```

不同系统可以拥有不同更新周期，但必须统一由 Scheduler 调用，不能各自读取现实时间：

```text
商品市场       每日或每 Tick
运输           每日或每 Tick
生产           每周
人口变化       每月
财政结算       每月
GDP 统计       每月或每季度
科技与政策     定期或事件触发
```

### 7.2 标准 Tick 阶段

具体经济规则确定后可以调整阶段，但执行顺序必须显式、稳定并有测试：

```text
1. 应用已确认的玩家/AI 命令
2. 更新政策和外生事件
3. 生成人口、Economic Unit 和政府计划
4. 分配劳动力、资本和投入品
5. 执行生产
6. 提交市场供给和需求
7. 市场撮合、定价与配给
8. 执行运输、进口和出口
9. 执行消费与库存损耗
10. 若为月末，执行不可中断结算批次
    10a. 结算工资、已交付采购、维护、利息、税费和到期债务
    10b. Economic Unit 关闭收入费用，确认利润并更新留存收益
    10c. 判定偿付能力，冻结本月股东名册和分红预算
    10d. 支付分红、转移支付、利息和租金等人口财产收入
    10e. 人口接收本月实际消费结果并更新资产负债表
11. 处理生命周期并准备下月
    11a. Economic Unit 进入、重组、清算和退出
    11b. 人口教育、技能、Class、出生、死亡、年龄和外生迁移
    11c. 生成下月岗位，完成裁员、招聘、参考工资和报价
12. 检查不变量
13. 更新统计指标和历史采样
14. 生成事件与 UI 状态增量
```

存档、暂停和载入应发生在完整 Tick 边界，避免保存执行到一半的世界状态。

这是唯一权威的端到端 Scheduler 顺序。模块规格只能声明自己挂接的阶段、内部步骤、读取和输出，不得另行定义一套全局 Tick。

### 7.3 确定性要求

- 所有随机行为使用项目统一的可播种 PRNG。
- 随机种子和 PRNG 状态进入存档。
- 不允许使用 `Math.random()`、当前系统时间或不稳定迭代顺序直接影响模拟。
- 同一模拟版本、数据版本、初始状态和命令序列必须可重放。
- 影响结果的排序必须显式指定稳定的第二排序键，例如实体 ID。
- 并行化不能改变逻辑结果；如果无法保证，应将变更视为存档兼容性变化。

调试构建应支持记录：

```text
initialSeed + dataVersion + orderedCommands + tickCount
```

从而重现玩家提交的模拟 Bug。

---

## 8. Worker 通信与状态所有权

### 8.1 单一权威状态

Simulation Worker 持有唯一权威的 World State。React 不直接读取或修改内部对象，只维护显示所需的 UI Read Model。

```text
玩家操作
→ Frontend 创建 Command
→ Worker 校验并执行
→ Simulation Core 更新 World State
→ Worker 返回 Command Result 和状态增量
→ Frontend 更新 Read Model
```

### 8.2 协议分类

```text
Command：请求改变世界，例如调整税率、建设道路、推进时间
Query：读取数据，例如省份详情、商品历史、市场参与者
Event：模拟产生的事实，例如企业破产、政策生效、月份结束
Snapshot：低频完整视图或存档快照
Delta：高频、小体积、面向 UI 的状态增量
Control：初始化、暂停、恢复、取消、载入、关闭
```

统一消息信封：

```ts
interface ProtocolEnvelope<T> {
  protocolVersion: number;
  requestId?: string;
  simulationId: string;
  simulationTick: number;
  type: string;
  payload: T;
}
```

所有命令都必须返回成功或结构化错误：

```ts
type CommandResult<T> =
  | { ok: true; value: T; appliedAtTick: number }
  | { ok: false; code: string; message: string; details?: unknown };
```

### 8.3 数据传输规则

- 不在每个 Tick 发送完整 World State。
- 地图只接收当前着色指标和发生变化的实体。
- Inspector 使用 Query 按需读取详细数据。
- 图表历史按时间范围和采样粒度查询。
- UI 刷新频率与模拟 Tick 频率分离；高速模拟时可以每 100 或更多 Tick 才推送一次 UI 更新。
- 消息队列积压时合并可覆盖的 Delta，例如同一省份的最新价格。
- 大型数值数组达到瓶颈后使用 TypedArray 和 transferable `ArrayBuffer`。
- 初期不使用 SharedArrayBuffer，除非基准测试证明必要并完成安全与兼容性验证。
- 协议只传普通对象、数组、Map 可替代结构、TypedArray 和可序列化错误，不传函数或复杂类实例。

### 8.4 错误与恢复

Worker Host 必须捕获：

- 未处理异常；
- 协议版本不匹配；
- 命令校验失败；
- Tick 超时或异常慢；
- NaN/Infinity 和关键不变量失败；
- 存档恢复失败。

发生致命错误时应停止推进、保留最近有效快照和命令日志，并向 UI 返回可诊断错误，而不是继续运行已损坏状态。

---

## 9. 数据模型与权威关系

### 9.1 四类数据严格分离

```text
Definition：不可变静态定义，例如商品、行业、省份几何引用
State：会随 Tick 变化并需要存档的权威状态
Metrics：可重新计算的统计和派生指标
View Model：为某个 UI 页面裁剪的数据
```

示例：

```text
ProvinceDefinition
├── id
├── nameKey
├── geometryId
├── terrain
├── climate
└── resourcePotential

ProvinceOwnershipState
├── provinceId
└── countryId

ProvinceLocalState
├── provinceId
├── primaryLocalMarketId
└── primaryTransportNodeId

ProvinceMetrics
├── gdp
├── employmentRate
├── averageWage
├── infrastructureSummary
└── tradeVolume
```

人口、库存、产能和基础设施状态分别由 Population、Inventory、Economic Units 和 Transport 模块持有；Province 只保存行政与默认节点关系并提供派生 Metrics，不保存第二份经济容器状态。

### 9.2 避免双重真相来源

不应同时把以下两者作为可修改状态：

```text
Province.countryId
Country.provinceIds
```

建议只保留 `ProvinceOwnershipState` 作为权威关系，国家包含的省份由索引派生。国家 GDP、人口等汇总指标同样由省级或账本数据计算。

对于性能敏感的反向索引，可以缓存，但缓存必须可重建且不进入业务规则的权威判断。

### 9.3 ID 与引用规则

- 所有实体使用稳定、全局唯一且不包含显示名称的 ID。
- 显示名称使用本地化 Key，不作为引用。
- 静态定义 ID 发布后尽量不复用。
- 跨实体关系使用 ID，不持有可变对象引用穿越模块边界。
- 删除实体优先标记状态或记录结束 Tick，避免历史数据失去引用。
- 所有外部数据在进入 Simulation Core 前完成引用完整性校验。

### 9.4 聚合主体

“大量经济主体”不意味着逐个模拟每个人。人口 V1 使用固定的省份级 Social Class 聚合单元，不建立 Cohort 或全属性笛卡尔积 POP：

```text
PopulationClassState
├── provinceId
├── socialClassId
├── populationPersons
├── age / education / skill marginal distributions
├── employment status counts
└── wealth balance sheet
```

每省最多 11 个 `PopulationClassState`。需要多个属性联合人数时，在同一 Class 内使用边际分布乘法估算；职业由独立的就业分配表表示。完整机制、公式和升级条件以 `economic_simulator_population_system.md` 为准。

经济活动使用独立 Economic Unit：工厂、商店、总部、道路和港口分别拥有 Employer、账户、股本与股东。总部通过持股控制其他 Unit，Enterprise Group 只从股权图派生，不建立并行集团所有权状态。完整经营、股权、分红和基础设施契约以 `economic_unit_architecture.md` 为准。

### 9.5 热点数据布局

初期可以采用可读性较好的对象模型，但热点模块应允许逐步迁移为：

- 扁平数组；
- TypedArray；
- Structure of Arrays；
- 稠密数字 ID 到数组下标的映射；
- 预分配工作缓冲区。

对外 API 不暴露内部布局，以便在不修改 UI 和存档语义的情况下优化。

---

## 10. 数值、单位与经济记账

### 10.1 数值策略

第一阶段继续使用 TypeScript `number`，但必须建立统一规则：

- 货币是否采用最小货币单位整数，由原型测试决定并全局统一；
- 实物数量和比例可以使用浮点数，但比较时使用明确误差范围；
- 禁止对浮点数进行无容差的经济守恒判断；
- 所有除法必须处理分母为零；
- 每个 Tick 检查关键字段是否为有限数；
- 数值范围必须有业务上限，避免指数爆炸后才发现异常。

推荐在字段名或类型中体现单位：

```text
quantityTons
priceCentsPerTon
annualInterestRate
durationDays
populationPersons
```

禁止在未转换的情况下混用：

- 日、月、年利率；
- 名义值和实际值；
- 存量和期间流量；
- 单价和总价；
- 本币和外币；
- 人均值和总量。

### 10.2 Accounting Ledger

涉及货币和资产变化的系统应尽可能写入统一账本或标准交易记录：

```text
Transaction
├── tick
├── debitAccount
├── creditAccount
├── amount
├── currencyId
├── category
└── sourceEntityId
```

账本不一定永久保存每一笔历史交易，但应支持调试模式下追踪一个 Tick 内资金从哪里来到哪里去，并验证：

- 企业收入、成本和利润一致；
- 政府收入、支出、赤字和债务一致；
- 银行资产与负债一致；
- 贸易支付和商品流对应；
- 货币创造与销毁只发生在被允许的模块。

---

## 11. 国家、省份与运输网络

### 11.1 Province 与 Country

Province 是主要空间统计和地图交互单位；Country 是政治、财政和政策实体。

这一原则不代表所有模拟都必须以 Province 为最低粒度。城市、港口、市场和运输枢纽可以拥有更细粒度状态。

Country 负责：

- 政府、财政与债务；
- 税收和监管；
- 货币与国家级政策；
- 国际关系和贸易政策；
- 国家级统计。

Province 负责或承载：

- 人口和劳动力；
- 生产能力和资源；
- 地方库存和价格；
- 基础设施状态；
- 地方市场或市场节点引用。

### 11.2 运输图

道路、铁路、航线和贸易路线统一建模为图，而不是嵌入 Province Polygon：

```text
TransportNode
├── id
├── kind: ProvinceHub | City | Port | Border | Junction
├── provinceId
└── position

TransportEdge
├── id
├── kind: Road | Railway | SeaLane | Canal
├── fromNodeId
├── toNodeId
├── distance
├── capacity
├── costParameters
├── travelTime
└── condition
```

实际贸易路线是运输图上的路径或流量结果，不应与永久基础设施实体混为一体。

---

## 12. 地图数据与发布

### 12.1 可维护的成品地图

游戏仓库以 `assets/maps/` 中的**制作完成地图**为地图真相来源。每张地图是可整体添加、移动或分享的自包含目录；其中的源文件使用 GeoJSON 和语义明确的 JSON，保留稳定 ID、可读属性与显式关系，能够被开发者检查、修订和版本管理：

```text
assets/maps/
└── world-modern/
    ├── map.json
    ├── provinces.geojson
    ├── boundaries.json
    ├── coastlines.geojson
    └── compiled/
        ├── map.json
        ├── provinces.json
        ├── boundaries.json
        ├── coastlines.json
        └── spatial-index.json
```

这里的 GeoJSON 是已经制作完成的游戏地图，不等于 Natural Earth 原始资料。经济状态不得写入地图几何；省份要素保存稳定 ID、少量展示属性和必填的内嵌首府 `capital`，当前归属由模拟读模型提供。地图包不再包含独立城市图层。

`boundaries.json` 保存制作阶段确定的共享省份关系。国界是运行时概念：

```text
boundary.provinceA.ownerCountryId != boundary.provinceB.ownerCountryId
```

因此成品地图提供共享省份边；渲染阶段根据当前归属决定省界或国界样式。

### 12.2 Natural Earth 制作子项目

`mapdata-generator/` 是仓库内独立维护的地图资料制作子项目，集中保存：

- 固定版本的 Natural Earth 下载地址与下载器；
- 原始下载缓存（目录规则保留，缓存内容默认不提交）；
- 从上游资料规范化、归并、拓扑简化并生成成品候选的脚本；
- 可审计的全局归并参数和审查报告。

该子项目不加入游戏 workspace，也不参与 `dev`、`build` 或发行构建。它只在制作或更新地图时手动运行：

```text
Natural Earth 原始资料
→ mapdata-generator 下载与缓存
→ 按统一的动态面积、完全包围和群岛规则归并
→ 共享拓扑简化、首府选择与审查报告
→ 人工检查并确认稳定 ID 和关系
→ 导入 assets/maps/<mapId>/
```

任何 Natural Earth 原始下载文件、缓存和上游下载逻辑都不得出现在 `assets/maps/`、游戏包或客户端运行路径中。

### 12.3 校验、编译与发布

主项目的 `tools/map-pipeline` 只处理已经完成的 `assets/maps/`：

```text
assets/maps/<mapId>/
→ map:validate（Schema、引用、稳定 ID、几何约束）
→ map:publish（LOD、包围盒、空间索引和运行清单）
→ assets/maps/<mapId>/compiled/
→ Vite 开发时直接提供、发行时打包为 /maps/<id>
→ loadMapPack("/maps/<id>")
```

`compiled/` 是地图目录内可重复生成、默认忽略提交的发布文件，不是人工维护入口。`dev` 和 `build` 会先执行 `map:publish`，过程中不会联网或读取 Natural Earth 缓存；发行构建把它作为只读资源打包，发布后的程序不会执行编译或向安装目录写文件。

编译必须满足以下正确性约束：

- 最高精度 LOD 逐坐标保留成品地图的原始几何，并作为命中测试的权威几何；
- 较低 LOD 按要素尺度限制容差，并校验面积偏差、环方向和自相交，失败时回退到更小容差或原始环；
- 当前运行格式只支持单级海岸线，因此发布文件保留原始海岸线，不能用最粗省份容差代替；
- 相同输入必须产生字节一致的 `compiled/`，动态构建时间不得写入地图清单；
- `map.json.layers` 只能引用当前地图目录内的真实文件，必须拒绝绝对路径、目录穿越和符号链接逃逸。
- 源地图清单的版本、名称键、坐标系和全部图层字段必须在构建期完整校验；所有图层要素都必须拥有稳定且唯一的 ID。

未来若支持玩家导入或编辑地图，完整地图目录应位于平台用户数据目录；运行时产生的 `compiled/` 也必须留在对应的用户地图目录。通用、可丢弃的下载缓存才放平台用户缓存目录，二者均不得写入安装目录。

### 12.4 运行时渲染层

```text
Layer 1：海洋、陆地和基础省份填充
Layer 2：省界、国界和海岸线
Layer 3：道路、铁路、城市和港口
Layer 4：贸易流、建设状态和动态效果
Layer 5：选择、高亮、Tooltip 锚点和调试信息
Layer 6：React/HTML 面板与文字 UI
```

渲染器必须通过接口读取地图 View Model，不得直接读取 Simulation Core 内部状态。

### 12.4 SVG、Canvas 与 WebGL 决策

- SVG 用于早期原型、低规模地图或需要快速检查几何的工具。
- Canvas 保留给地图制作工具和轻量 2D 预览。
- 正式客户端使用 Three.js WebGL2 地球仪；构建期把省份 GeoJSON 编译为带 LOD 的球面三角网格，运行时通过省份槽位纹理完成动态着色。
- 地球仪按需渲染，拖拽环绕、滚轮缩放，拾取时将球面交点还原为经纬度并复用空间索引。
- React 不负责创建成千上万个每 Tick 更新的地图 DOM 节点。

地图基准应记录：

- 首次加载时间；
- 缩放和平移帧率；
- 全地图重新着色耗时；
- 道路和贸易流叠加后的帧率；
- 内存占用；
- 点击拾取耗时。

### 12.5 交互与拾取

- 省份点击使用空间索引加点在多边形判断，或使用离屏颜色 ID 拾取。
- 道路和点要素使用屏幕空间容差，不能要求精确命中一像素线。
- Tooltip 查询应使用地图 View Model，详细数据通过 Simulation Query 延迟获取。
- 数据着色采用分级、连续或对数色阶时，应显式处理缺失值、零值和异常值。

---

## 13. Frontend、图表与 Inspector

### 13.1 React 职责

React 负责：

- 菜单、设置、时间控制和窗口布局；
- 国家、省份、企业、商品和市场面板；
- 图表、表格、Tooltip 和通知；
- 当前选择、窗口开关等纯 UI 状态；
- 将玩家操作转换为 Simulation Command；
- 将 Worker Delta 合并到只读 UI Read Model。

React 不直接执行经济规则，也不以组件状态保存权威世界状态。

### 13.2 图表数据

时间序列可能比当前世界状态更占内存，因此必须规定采样策略：

- 高频短期数据保留详细采样；
- 长期数据逐级降采样；
- 图表按时间范围和指标查询；
- 不把所有实体的完整历史推给 React；
- 同一指标的定义、单位和采样周期由 Statistics 模块登记。

### 13.3 Entity Inspector

Inspector 是架构能力，不只是 UI 页面。每类实体应提供稳定 Query：

```text
getProvinceSummary
getCountrySummary
getPopulationClassDetails
getEconomicUnitDetails
getCommodityMarket
getTransportPath
getAccountTrace
getEntityHistory
```

调试模式允许显示：

- 原始权威状态；
- 派生指标及计算来源；
- 最近修改该实体的模块和 Tick；
- 当前不变量检查结果；
- 关联实体和交易记录；
- 模块耗时和对象数量。

---

## 14. 存档、载入与迁移

### 14.1 存档内容

```text
SaveGame
├── saveFormatVersion
├── gameVersion
├── simulationVersion
├── protocolVersion
├── dataPackVersion
├── createdAt
├── savedAt
├── currentTick
├── calendar
├── randomState
├── worldState
├── enabledMods
├── optionalCommandLog
└── checksum
```

以下内容原则上不进入存档：

- React 组件状态；
- Canvas/SVG 渲染对象；
- 可由 State 重建的缓存和索引；
- 可重新计算的短期派生指标，除非计算成本过高；
- 临时寻路工作区和 Worker 消息队列。

### 14.2 版本迁移

- 每次不兼容 Schema 变化增加 `saveFormatVersion`。
- 维护逐版本迁移：V1 → V2 → V3，而不是只支持旧版直接迁移到最新版。
- 迁移前保留原文件备份。
- 迁移工具可在 Node CLI 中独立运行。
- 载入后重新执行引用校验和关键不变量检查。
- 无法安全迁移时给出明确错误，不静默丢弃字段。

### 14.3 写入安全

```text
序列化
→ 写入临时文件
→ 刷新并校验
→ 生成校验和
→ 原子替换目标文件
→ 轮换旧自动存档
```

应提供多个自动存档槽位，避免一次损坏覆盖最后的有效存档。

### 14.4 编码演进

- MVP 使用易调试的 JSON。
- 编码方式封装在 `SaveCodec` 后，不进入业务模块。
- 当 JSON 存档超过性能预算时，再评估压缩 JSON、二进制 Schema 或分块存档。
- 不允许因为切换编码格式而改变 Simulation Core 的状态语义。

---

## 15. 自动测试与验证

经济模拟的自动测试优先级高于传统 UI 快照测试。

### 15.1 测试层次

```text
Unit Tests
单个算法、公式、单位转换和模块规则

Invariant Tests
守恒、范围、引用完整性和会计一致性

Scenario Tests
小型确定场景，例如两个省份、两个商品和一个贸易通道

Replay Tests
固定种子和命令日志产生稳定结果

Long-run Tests
数万到数十万 Tick 的稳定性和趋势检查

Integration Tests
Worker 协议、存档恢复、数据构建和 Tauri 平台适配

Performance Tests
标准场景的 Tick、内存、消息、地图和存档基准
```

### 15.2 必须具备的初始不变量

- 人口不为负且分组总数与省份总数一致；
- 商品库存不为负，除非模型明确支持欠交；
- 生产投入、产出和损耗可以解释；
- 企业收入、成本、税、利润和现金变化一致；
- 政府收入、支出、赤字和债务变化一致；
- 贸易双方商品流和支付流匹配；
- 不产生 NaN 或 Infinity；
- 价格、工资、利率在允许范围内；
- 所有外键指向存在且类型正确的实体；
- 世界快照保存再载入后，继续运行结果与未载入分支一致。

### 15.3 长时间测试输出

测试不能只输出通过或失败，还应生成：

- 失败 Tick 和随机种子；
- 最近命令和事件；
- 模块耗时；
- 人口、GDP、物价、货币和 Economic Unit 数量趋势；
- 首次出现异常的实体；
- 可供本地重放的最小测试包。

---

## 16. 可观测性与 Simulation Debugger

开发阶段建立统一 Debugger：

```text
World
Countries
Provinces
Population
Economic Units
Markets
Trade
Transport
Finance
Government
Events
Accounting
Performance
```

Simulation Core 每个 Tick 至少记录：

- 各模块执行耗时；
- 实体数量；
- 新建和删除数量；
- Worker 消息数量与字节数；
- 快照和存档耗时；
- 不变量检查耗时；
- 异常、警告和被钳制的数值。

日志分级：

```text
Error：状态可能已损坏，停止或进入安全模式
Warning：结果可继续，但出现不合理或被修正数据
Info：重要模拟事件和生命周期
Debug：单模块诊断
Trace：逐实体或逐交易信息，仅定向开启
```

不得默认永久记录所有实体的逐 Tick Trace；应支持按实体、模块和时间范围定向启用。

---

## 17. 性能演进策略

### 17.1 优化顺序

```text
1. 建立可重复基准
2. 用 profiler 找到热点
3. 减少不必要计算和分配
4. 改善算法复杂度和数据布局
5. 降低 Worker 消息复制和 UI 更新频率
6. 使用 TypedArray / transferable ArrayBuffer
7. 对明确热点评估 Rust/WASM
8. 只有可安全分区时才评估多 Worker
```

单个 Worker 是第一阶段默认方案。过早拆成多个 Worker 会引入跨线程同步、复制和确定性问题。

### 17.2 Rust/WASM 迁移门槛

只有同时满足以下条件才迁移某个模块：

- 标准基准场景持续无法达到性能预算；
- profiler 证明该模块是主要热点；
- TypeScript 算法和数据布局已经完成合理优化；
- 模块输入输出边界稳定且可以批量传输；
- 迁移收益明显大于序列化和维护成本；
- TypeScript 与 Rust 实现拥有同一组行为和回放测试。

不建议把整个 Simulation Core 一次性重写为 Rust。

### 17.3 格式切换门槛

| 决策                      | 触发条件                                           |
| ------------------------- | -------------------------------------------------- |
| SVG → Canvas              | 标准地图交互或重新着色稳定低于目标帧率             |
| Canvas → WebGL            | 分层、缓存和局部更新后仍无法达到性能预算           |
| JSON → 压缩/二进制存档    | 序列化、文件大小或载入时间超过预算                 |
| 普通对象 → TypedArray/SoA | profiler 证明对象遍历、GC 或内存布局是热点         |
| 单 Worker → 多 Worker     | 存在可独立分区的模块，并能保持确定性且通信收益为正 |
| TypeScript → Rust/WASM    | 满足上一节全部迁移门槛                             |

---

## 18. Tauri 桌面架构

### 18.1 Tauri 职责

Tauri 2 只负责平台能力，不负责经济模拟：

- 创建和管理窗口；
- 文件选择、存档路径和原子写入；
- 设置、日志和崩溃诊断文件；
- 全屏、显示器和系统菜单；
- Steam/native SDK 桥接；
- 安装包和平台分发。

Tauri 使用系统 WebView，因此必须在 Windows WebView2、macOS WebKit 和 Linux WebKitGTK 上分别验证。Windows 首发仍应明确 WebView2 安装与最低版本策略。

### 18.2 Platform Services

Frontend 只依赖抽象接口：

```ts
interface PlatformServices {
  readonly kind: "web" | "desktop" | "steam";
  saveGame(request: SaveRequest): Promise<SaveResult>;
  loadGame(request: LoadRequest): Promise<LoadResult>;
  listSaves(): Promise<SaveMetadata[]>;
  writeLog(entry: LogEntry): Promise<void>;
  unlockAchievement(id: string): Promise<void>;
  setRichPresence(value: RichPresence): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
}
```

实现至少包括：

```text
WebPlatformServices：浏览器 Demo，平台功能为空实现或浏览器替代方案
DesktopPlatformServices：本地文件和桌面能力
SteamPlatformServices：在 Desktop 基础上增加 Steamworks
```

### 18.3 安全边界

- React 不直接获得任意文件系统或 Shell 权限。
- Tauri Command 必须校验参数、路径和允许的操作。
- Capability 按窗口和功能授予最小权限。
- 启用严格 CSP，不从不受信任 CDN 加载运行时代码。
- 存档、地图和模组数据一律视为不可信输入并进行 Schema 校验。
- Web 内容不得直接持有 Steam 密钥或受保护的服务凭据。

---

## 19. Steam 集成

Steamworks 不是发布游戏的强制条件，但玩家通常期望成就、云存档、Overlay 和 Rich Presence。项目应提前预留接口，但不让 Steam API 污染模拟代码。

### 19.1 初始集成范围

- Steam 初始化和退出；
- 当前用户与语言；
- 成就；
- Rich Presence；
- Overlay 基础验证；
- Steam Cloud 或 Auto-Cloud 存档同步；
- 启动参数和错误日志。

### 19.2 原生桥接

Steamworks 客户端能力通过以下方式之一接入：

- Tauri Rust 层 FFI；
- 维护良好的 Tauri/Rust Steamworks 插件；
- 受控原生 sidecar。

最终选型在技术验证阶段决定。无论采用哪种方式，对 React 暴露的都应是窄而稳定的 `SteamPlatformServices`。

### 19.3 提前验证项

- 从 Steam 客户端启动应用；
- Overlay 是否正常显示；
- 窗口、全屏和硬件加速组合；
- 成就回调；
- 云存档路径和冲突行为；
- 离线启动；
- Steam Deck/Linux 的 WebView 与依赖情况。

Steam 完整接入可以后置，但最小启动和 Overlay 技术验证不应拖到发布阶段。

---

## 20. 构建、数据版本与发布

### 20.1 构建产物

构建流程至少包含：

```text
Type Check
→ Unit / Invariant / Replay Tests
→ Static Data Validation
→ Map Compilation
→ Client Build
→ Worker Build
→ Tauri Build
→ Smoke Test
→ Package
```

生成数据必须可追溯到：

- 源数据版本；
- 构建工具版本；
- Schema 版本；
- 生成时间或内容哈希。

### 20.2 跨平台验证

Windows 是第一优先平台，但启用 macOS/Linux 前必须各自建立真实构建和冒烟测试。不能仅凭浏览器运行正常推断 Tauri 跨平台正常。

发布构建应关闭不必要的调试权限，但保留玩家主动导出诊断包的功能。

---

## 21. 面向 AI 辅助开发的工程规则

由于项目主要依赖 AI Coding，必须用工程约束降低错误传播：

1. 一个文件和模块只承担明确职责。
2. 公共 API、协议和存档结构必须有显式 TypeScript 类型。
3. 新增经济规则时同时提交至少一个正常测试和一个边界测试。
4. 修改 Tick 顺序、单位、存档或协议必须记录 ADR。
5. 不允许复制粘贴同一经济公式到多个模块；统一到一个权威实现。
6. 禁止使用未说明单位的神秘数字。
7. 所有静态数据在构建时校验，不把数据错误留到游戏运行时。
8. 性能优化必须附基准前后结果。
9. 修复模拟 Bug 时优先增加可重现测试，再修改实现。
10. 不允许 UI 为了显示方便直接修正或重写模拟结果。

建议 ADR 至少覆盖：

- 地图生产渲染器选择；
- 货币精度策略；
- 市场撮合算法；
- 存档编码格式；
- Steam 原生桥接方式；
- 任何 Rust/WASM 迁移。

---

## 22. 修订后的开发阶段

### Phase 0：架构验证

交付：

- workspace 和包边界；
- React + Worker + Simulation Core 最小通信；
- Node CLI 直接运行同一 Simulation Core；
- Tauri 2 最小桌面壳；
- JSON 存档往返；
- SVG/Canvas 地图基准原型；
- 基准测试机器和性能记录格式。

验收：同一测试世界可分别在 Node、Worker 和 Tauri 中初始化并产生相同摘要。

### Phase 1：最小经济模拟实验室

使用极小场景跑通一个纵向闭环：

```text
省份 → 人口 → Economic Unit/产能 → 生产 → 市场 → 消费 → 统计
```

交付：

- 固定 Tick Scheduler；
- 可播种 PRNG；
- Command / Query / Event 协议；
- 基础 Inspector 和图表；
- 第一组会计和守恒检查；
- 快照、载入和确定性回放。

验收：长期运行稳定；保存后载入的结果与未中断运行一致。

### Phase 2：地图和运输系统

交付：

- 可维护成品地图的校验与运行格式编译；
- 共享 Boundary、LOD 与空间索引消费；
- Province/Country 数据着色；
- 城市、道路、铁路和港口图；
- 地图拾取和 Inspector 联动；
- 标准场景地图性能测试。

验收：标准地图规模达到交互和内存预算。

### Phase 3：经济模块扩展

逐步加入：

- 多商品和行业链；
- 劳动力和工资；
- Economic Unit 进入、退出、股权和投资；
- 跨省运输和贸易；
- 政府、税收和财政；
- 银行、信贷和货币；
- 科技和事件。

每加入一个模块，都必须补充模块契约、不变量、场景测试和性能数据。

### Phase 4：游戏化和内容生产

- 玩家身份、政策和目标；
- 事件、AI 和外交；
- 完整 UI、教程、音效和本地化；
- 内容编辑和数据校验工具；
- 模组边界评估。

### Phase 5：性能、平台和发行

- 标准/压力场景 profiling；
- 必要的数据布局、WebGL 或 WASM 优化；
- 存档迁移和恢复测试；
- Steam 成就、云存档和 Overlay；
- Windows 发布构建；
- macOS/Linux/Steam Deck 可行性和兼容测试；
- 崩溃诊断、发行检查和回归测试。

Tauri 最小壳在 Phase 0 建立，Steam 接口在早期预留；Phase 5 完成的是发行级集成，而不是第一次尝试桌面运行。

---

## 23. 当前未决策项

以下内容需要通过原型或玩法设计后形成 ADR：

| 未决策项                         | 决策依据                 | 最迟决策阶段   |
| -------------------------------- | ------------------------ | -------------- |
| 正式地图使用 Canvas 还是 WebGL   | 标准地图基准             | Phase 2 开始前 |
| 货币使用整数还是统一定点策略     | 会计模型和数值范围测试   | Phase 1        |
| 市场清算和配给算法               | 玩法目标、稳定性和复杂度 | 对应模块开发前 |
| 存档是否切换为二进制             | 文件大小和载入基准       | Phase 3～5     |
| Steam 使用 FFI、插件还是 sidecar | 原型、维护性和平台支持   | Phase 3 前     |
| 是否迁移 Rust/WASM               | profiler 和迁移门槛      | Phase 5        |
| 是否正式支持 Web 版本            | 平台能力差异和发行需求   | Phase 4        |

---

## 24. 编码前完成清单

在大规模编写业务代码前，应确认：

- [ ] workspace、包边界和依赖规则已建立；
- [ ] Simulation Core 可以在 Node 环境独立运行；
- [ ] Worker 协议包含版本、requestId、Tick 和结构化错误；
- [ ] World State 的唯一所有者已明确；
- [ ] Definition、State、Metrics、View Model 已分离；
- [ ] Tick 阶段、随机种子和确定性规则已实现；
- [ ] 数值单位和第一组经济不变量已定义；
- [ ] 存档包含版本并能往返恢复；
- [ ] 成品地图校验、运行格式编译与发布已有原型；
- [ ] 标准基准场景和基准机器已记录；
- [ ] Tauri 2 最小桌面壳能够运行 Worker 和读写测试存档；
- [ ] 至少一个完整纵向经济场景可以自动运行和回放。

---

## 25. 最终核心原则

1. Province 是主要地图和空间统计单位，但不是所有系统被强制使用的最低粒度。
2. Country 是政治和国家级经济实体；省份归属只保留一个权威来源。
3. 地图几何、静态定义、运行状态、派生指标和 UI View Model 严格分离。
4. 道路、铁路、港口和航线的空间资产组成独立运输图；其经营者是有员工、账目和股东的 Economic Unit，贸易路线仍是路径或流量结果。
5. Simulation Core 是纯 TypeScript、平台无关、可在 Node 中独立测试的包。
6. Web Worker 持有权威 World State，React 只持有显示所需 Read Model。
7. Worker 使用版本化 Command / Query / Event / Snapshot / Delta 协议。
8. 模拟时间与渲染帧率分离，高速模拟可以降低 UI 推送频率。
9. Tick 顺序、随机数和排序规则必须显式，以保证确定性和可回放性。
10. 大量主体优先采用可解释的聚合模型，热点内部布局可以独立优化。
11. 经济数值必须拥有统一单位、误差和会计规则。
12. 每张地图以自包含目录保存成品 GeoJSON/JSON 及就地生成的 `compiled/`；Natural Earth 制作管线独立隔离。
13. 存档必须版本化、可迁移、可校验并采用安全写入流程。
14. Inspector、Debugger、长时间测试和性能基准从项目第一阶段存在。
15. Tauri 负责平台能力，不负责模拟；Steam 通过 Platform Services 接入。
16. 优化必须由 profiler 和标准基准驱动，不提前整体重写 Rust/WASM。
17. 先完成小型纵向闭环，再增加世界规模和经济模块。
18. 优先保证模型正确、可解释、可测试和可修改，再追求视觉复杂度。

---

## 26. 目标架构摘要

```text
                           Tauri 2 / Steam
                                  │
                       Platform Services API
                                  │
                    React UI / Map / Charts
                                  │
                  Versioned Simulation Protocol
                                  │
                         Web Worker Host
                                  │
                  Pure TypeScript Simulation Core
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
 Compiled Game/Map Data    Versioned Save State      Metrics / Events
        │                         │                         │
 Authored JSON / GeoJSON    Migration / Checksum      Inspector / Tests
```

最终目标不是简单地“用 Web 技术制作一个桌面游戏”，而是建立一套：

> 能独立运行、可确定性重放、可长期测试、可观察、可迁移、可逐步优化的经济模拟平台，再以 React 地图与 Tauri/Steam 桌面能力将其包装成游戏。

---

## 27. 官方技术参考

- [Tauri 2 进程模型](https://v2.tauri.app/concept/process-model/)
- [Tauri 2 Capability 权限边界](https://v2.tauri.app/reference/acl/capability/)
- [Tauri Content Security Policy](https://v2.tauri.app/security/csp/)
- [Tauri Sidecar / 外部二进制](https://v2.tauri.app/develop/sidecar/)
- [Tauri Windows WebView2 安装策略](https://v2.tauri.app/distribute/windows-installer/)
- [MDN：Using Web Workers](https://developer.mozilla.org/docs/Web/API/Web_Workers_API/Using_web_workers)
- [MDN：Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [MDN：Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [Steamworks API Overview](https://partner.steamgames.com/doc/sdk/api)
- [Steamworks Achievements Guide](https://partner.steamgames.com/doc/features/achievements/ach_guide)
- [Steamworks Cloud Service](https://partner.steamgames.com/doc/webapi/ICloudService)
