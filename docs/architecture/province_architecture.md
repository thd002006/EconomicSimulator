# 经济模拟器省份系统实施规格

> 文档状态：可实施基线（Implementation Baseline）  
> 适用版本：省份系统 V1  
> 基础 Tick：1 日；省份统计按日更新，人口和主要经济统计按月结算  
> 相关文档：`economic_simulation_web_architecture.md`、`economic_simulator_population_system.md`  
> 核心取舍：省份是稳定的行政与空间聚合单位，但不是人口和经济单位的所有者容器

---

## 1. 已定决策

V1 采用以下设计：

1. Province 是游戏中最小的稳定行政归属单位，也是人口、劳动力、本地招聘、地方市场和地图交互的基本空间单位。
2. Country 仍是政府、财政、货币、外交和政策主体。Province V1 不拥有独立政府、选举、地方立法或外交状态。
3. 每个 Province 拥有稳定、全局唯一且不包含显示名称的 `ProvinceId`；发布后不复用 ID。
4. 每个 Province 在任意完整 Tick 边界恰好属于一个 Country。`ProvinceOwnershipState` 是当前国家归属的唯一权威来源。
5. 地图包是几何、显示名称、首府和相邻边界的唯一可维护真相来源；模拟状态不写入 GeoJSON。
6. V1 的 Province 几何和首府固定，不支持省份拆分、合并、创建、删除或运行时修改边界。
7. 每个 Province 恰好引用一个主要地方市场；城市、港口和专业市场以后可以作为更细的独立市场节点存在。
8. 每个 Province 最多关联 11 个 `PopulationClassState`。人口模块持有权威人口状态，Province 不复制 Class 人数或分布。
9. 工厂、农场、商店、总部、仓库、道路和港口是独立 Economic Unit，通过 `provinceId` 定位；Province 不保存权威子对象数组。
10. 总部 Economic Unit 可以跨省持有其他 Unit；Enterprise Group 从股权控制关系派生，不由 Province 保存成员列表。
11. 省份反向索引和所有汇总指标必须可由权威状态重建；缓存不得成为业务规则的第二真相来源。
12. 省份归属变更只改变行政归属，不自动迁移人口、不改变 Economic Unit 股权、不搬迁 Unit，也不改写过去的统计和事件。

V1 明确不做：

- 省级政府、议会、选举、自治权和地方税制；
- 合法性、占领、抵抗、核心领土和主权声索；
- 省内城市或区县人口模拟；
- 省份边界的动态拆分、合并或几何编辑；
- 跨省通勤；
- 将所有省内实体内嵌到一个巨大 `ProvinceState`；
- 以省级汇总值替代企业、人口、市场或运输模块的权威状态。

---

## 2. 系统定位与闭环

```text
Authored Map Package                 Game Data
几何、名称、首府、共享边界          地形、气候、资源潜力、初始状态
           │                              │
           └────────── ProvinceDefinition ┘
                              │
                    ProvinceOwnershipState
                    ProvinceLocalState
                              │
          ┌───────────────────┼────────────────────┐
          ▼                   ▼                    ▼
 Population Classes     Economic Units      Market / Transport
          │                   │                    │
          └───────────────────┼────────────────────┘
                              ▼
                     Province Aggregation
                              │
                Metrics / History / Inspector
```

Province 模块负责：

- 加载和校验省份静态定义；
- 保存当前国家归属及已经结束的归属期间；
- 保存主要地方市场和主要运输枢纽关系；
- 校验其他模块提交的 `provinceId`；
- 构建可重建的省份反向索引；
- 聚合人口、企业地点、生产、市场、运输和账本结果；
- 提供稳定的省份 Query、事件、历史采样和不变量报告。

Province 模块不负责：

- 人口变化、迁移、Social Class 流动或劳动匹配；
- 企业生产、开店决策、投资、破产或总部选择；
- 商品库存、市场清算、价格形成或运输寻路；
- 国家税率、财政、外交或政策制定；
- 地图几何制作、简化、三角化或渲染。

跨模块规则只能依赖公开的只读状态、阶段输出或 World API，不能取得其他模块的可变对象引用。

---

## 3. 四类数据严格分离

```text
Definition  不随 Tick 变化的游戏数据和地图引用
State       随 Tick 变化、需要进入快照的权威状态
Metrics     能从 State 和期间结果重新计算的统计
View Model  为具体 Query 和 UI 裁剪的只读结果
```

| 数据层     | 省份系统示例                                          | 是否进入存档                       |
| ---------- | ----------------------------------------------------- | ---------------------------------- |
| Definition | 地图要素引用、面积、地形、气候、资源潜力              | 记录数据包版本，不逐项复制         |
| State      | 当前国家归属、已结束归属期间、主要市场和主要运输节点  | 是                                 |
| Metrics    | 人口、GDP、就业率、平均工资、物价、产出、经济单位数量 | 默认否；历史采样按统计系统规则保存 |
| View Model | `ProvinceSummaryView`、经济单位分页、Inspector 数据   | 否                                 |

不得因为 UI 需要方便而把 Metrics 回写为新的权威字段。不得把反向索引序列化为业务状态；载入后必须从权威实体重建。

---

## 4. ID、单位与公共类型

以下 ID 在 TypeScript 中可以先使用品牌字符串或普通字符串别名；跨 Worker 只传递字符串值。

```ts
type ProvinceId = string;
type CountryId = string;
type MarketId = string;
type TransportNodeId = string;
type EconomicUnitId = string;
type IndustryId = string;
type ResourceId = string;
type TerrainProfileId = string;
type ClimateProfileId = string;
type InfrastructureKindId = string;
type Tick = number;
```

字段名必须体现单位：

- 面积使用 `landAreaKm2`；
- 人口使用 `populationPersons`；
- 金额使用 `...Cents`；
- 期间流量包含 `ThisPeriod` 或明确的日、月、年后缀；
- 比例使用 0～1，并以 `Rate`、`Share`、`Condition` 或 `Coverage` 结尾；
- 所有 Tick 使用非负安全整数。

Province ID、地图要素 ID、Country ID 和经济实体 ID 不得使用显示名称。显示名称变化不触发存档迁移。

---

## 5. Province Definition

### 5.1 静态定义

```ts
interface ProvinceMapReference {
  readonly mapId: string;
  readonly featureId: string;
}

interface ProvinceDefinition {
  readonly id: ProvinceId;
  readonly map: ProvinceMapReference;
  readonly landAreaKm2: number;
  readonly terrainProfileId: TerrainProfileId;
  readonly climateProfileId: ClimateProfileId;
  readonly resourcePotentialByResourceId: Readonly<Record<ResourceId, number>>;
}
```

`resourcePotentialByResourceId` 表示 0～1 的长期资源或土地适宜度，不表示可开采库存。会耗尽的矿藏、油田、林场蓄积和其他储量应由资源或生产模块保存为独立状态。

`landAreaKm2` 是模拟使用的发布值。它在地图制作或数据构建阶段从最终几何计算并写入游戏数据；运行时不重复进行球面面积计算。构建期必须检查它和发布地图计算值在允许误差内一致。

### 5.2 初始状态输入

初始状态与不可变 Definition 分开：

```ts
interface ProvinceInitialState {
  readonly provinceId: ProvinceId;
  readonly ownerCountryId: CountryId;
  readonly primaryLocalMarketId: MarketId;
  readonly primaryTransportNodeId: TransportNodeId | null;
}
```

`ProvinceInitialState` 属于开局场景或游戏数据包，不进入每个 Tick 的 Definition。新世界初始化时把它转换为权威 State。

---

## 6. 地图数据边界

地图包继续采用：

```text
assets/maps/<mapId>/
├── map.json
├── provinces.geojson
├── boundaries.json
├── coastlines.geojson
└── compiled/
```

权威关系如下：

| 信息                 | 权威来源                               |
| -------------------- | -------------------------------------- |
| 省份几何             | `provinces.geojson`                    |
| 显示名称和本地化 Key | 地图要素属性                           |
| 首府名称与坐标       | 地图要素的必填 `capital`               |
| 相邻省份和共享边     | `boundaries.json`                      |
| 当前所属国家         | `ProvinceOwnershipState`               |
| 国界样式             | 共享边两侧 Province 的当前所属国家派生 |
| 地形、气候和资源潜力 | `ProvinceDefinition`                   |

每个 `ProvinceDefinition.map.featureId` 必须在指定地图中恰好存在一次；正式场景使用的每个地图 Province 也必须恰好有一个 Definition。V1 不允许孤立的模拟省份或没有模拟定义的可点击省份。

国界在运行时按以下规则派生：

```text
owner(boundary.provinceA) != owner(boundary.provinceB)
```

沿海外侧 `provinceB = null` 的 Boundary 是海岸或地图外边界，不参与国家归属比较。

---

## 7. 权威省份状态

### 7.1 当前国家归属

```ts
type ProvinceOwnershipChangeReason =
  "scenario_initialization" | "treaty" | "annexation" | "scripted_event" | "debug";

interface ProvinceOwnershipState {
  readonly provinceId: ProvinceId;
  countryId: CountryId;
  sinceTick: Tick;
  acquisitionReason: ProvinceOwnershipChangeReason;
  acquiredByCommandId: string | null;
}
```

每个 Province 恰好有一条当前记录。初始归属使用 `scenario_initialization`，此时 `acquiredByCommandId` 为 `null`；运行时变更产生的归属必须记录成功提交的 Command ID。禁止同时把 `Country.provinceIds` 保存为可修改状态；国家所辖省份必须从 Ownership 建立反向索引。

### 7.2 已结束的归属期间

```ts
interface ProvinceOwnershipHistoryEntry {
  readonly provinceId: ProvinceId;
  readonly countryId: CountryId;
  readonly fromTick: Tick;
  readonly untilTickExclusive: Tick;
  readonly acquisitionReason: ProvinceOwnershipChangeReason;
  readonly acquiredByCommandId: string | null;
}
```

历史表只保存已经结束的期间，并记录该 Country 当初如何取得 Province。查询完整历史时，将历史表与当前 `ProvinceOwnershipState` 组合，因此不存在两条同时表示“当前归属”的记录，也不会在多次转属后丢失取得原因。

### 7.3 地方状态

```ts
interface ProvinceLocalState {
  readonly provinceId: ProvinceId;
  primaryLocalMarketId: MarketId;
  primaryTransportNodeId: TransportNodeId | null;
}
```

道路、铁路、港口、公用事业和政府服务的 condition 与经营状态只由 Transport 等专门模块中、以 `economicUnitId` 为键的经营组件持有；可用 capacity 从资产 Definition 与当前经营输入派生。Province 基础设施概况只能从这些来源聚合，不保存可独立修改的 condition、capacity 或 coverage。

---

## 8. Social Class 与人口接入

人口机制完全沿用 `economic_simulator_population_system.md`：

```ts
interface PopulationClassState {
  readonly provinceId: ProvinceId;
  readonly socialClassId: SocialClassId;
  populationPersons: number;
  // 年龄、教育、技能、就业、民族、信仰、财富和转换进度由人口规格定义
}
```

省份与人口之间遵守以下规则：

1. 一个 `PopulationClassState` 只能属于一个 Province。
2. 同一 `provinceId + socialClassId` 最多有一条权威记录。
3. 每省最多有 11 条 Class 记录；零人口 Class 可以不实例化，但查询必须按静态 Class Definition 补零。
4. Province 不保存 `populationClassIds` 作为权威字段。
5. `populationClassesByProvince` 是从人口状态建立的可重建索引。
6. 省级人口总数、就业率、收入、财富和消费均由人口模块状态与期间结果聚合。
7. 省份归属改变不会改变人口的 `provinceId` 或 Social Class。
8. 省际迁移只能通过人口模块的迁移命令执行，不能通过修改 Province 汇总实现。

人口模块提交消费需求、劳动力供给和迁移结果时必须携带 `provinceId`。商品市场、Employer 和迁移目标必须校验该 Province 在当前世界存在。

---

## 9. Economic Unit 与企业集团

### 9.1 统一空间契约

所有真实 Economic Unit 都通过核心状态中的 `provinceId` 落在一个 Province：

```ts
interface ProvinceLocatedEconomicUnit {
  readonly id: EconomicUnitId;
  provinceId: ProvinceId;
}
```

Economic Unit 的身份、经营、Employer、账户、股本、股东和专有组件以 `economic_unit_architecture.md` 为准。Province 只消费 Unit 的 ID、Kind、状态和 `provinceId`：

- `economicUnitIdsByProvince` 从 Unit 状态建立；
- Province Metrics 从 Unit 经营、就业、市场和账本结果聚合；
- Province 不复制 Unit 的员工、库存、股东、现金、产量或利润；
- 每个 Unit 恰好属于一个 Province；跨省道路和铁路在省界处分段为多个 Unit。

### 9.2 总部与跨省集团

`headquarters` 是一种普通 Economic Unit。它通过持有其他 Unit 超过 50% 的普通股形成控制关系：

- Headquarters H 可以位于 Province A；
- H 可以持有 Province B、C 的工厂、商店或港口股份；
- 每个子 Unit 仍各自拥有 Province、Employer、账户和股东；
- Enterprise Group 是股权图的派生 View，不保存到 Province 或总部成员数组。

因此“某集团在本省有多少工厂”必须先由 Equity 模块确定集团成员，再与 `economicUnitIdsByProvince` 求交，不能依赖手工维护的集团地点列表。

### 9.3 生命周期与迁址

创建、启用、暂停、破产、关闭和迁址由 Economic Units 及专有经营模块发起，World API 负责统一验证和提交。

迁址在完整 Tick 边界原子修改 `provinceId`，并产生包含原省份、目标省份和生效 Tick 的事件。业务模块必须同时处理库存、运输中订单、劳动合同、地方许可或其他专有状态；Province 模块不得猜测这些规则。

关闭的 Unit 保留 ID、最终位置和 `closedTick`，从活动索引移除但仍可供历史查询。零状态对象不得物理删除到使交易、股权、事件或历史统计失去引用。

Unit 破产时，由 Bankruptcy 和 Economic Units 模块决定重组、出售股权、转让基础设施经营权或关闭。Province 只在提交后的权威状态上重建或增量更新索引。

---

## 10. 地方市场、库存和运输

### 10.1 主要地方市场

每个 Province 在 `ProvinceLocalState.primaryLocalMarketId` 中指定一个主要地方市场。Market 自身保存所在 Province；两者表示不同事实：

- `MarketState.provinceId`：市场节点位于哪里；
- `ProvinceLocalState.primaryLocalMarketId`：哪个本地市场是该 Province 的默认入口。

主要市场必须位于引用它的 Province。人口消费计划、未指定更细市场的商店和省级价格指标默认使用主要地方市场。

一个 Province 以后可以拥有额外城市、港口或专业市场，但只有一个主要市场。更换主要市场必须在 Tick 边界执行，并验证旧市场上的挂单、默认路由和查询缓存已经按市场模块规则处理。

### 10.2 库存

商品库存属于仓库、商店、工厂、运输载具、市场托管账户或其他 Inventory Holder。Province 不保存一份可独立修改的“全省库存”。

省级库存指标按以下方式派生：

```text
ProvinceCommodityInventory
= sum(inventory quantity whose holder is located in province)
```

运输途中的商品按运输模块定义的位置或在途状态统计，不能同时计入起点和终点 Province。

### 10.3 运输

运输图继续使用独立 `TransportNode` 和 `TransportEdge`。所有空间节点通过 `provinceId` 定位；省份相邻不等于存在可通行路线。

`primaryTransportNodeId` 可以在尚未建立运输图的早期场景中为 `null`。一旦设置，该节点必须位于同一 Province。省份归属变化不修改道路、铁路、港口或路线，跨国边界和贸易限制由节点所在 Province 的当前归属派生。

---

## 11. 可重建索引

World State 可以维护以下性能索引：

```ts
interface ProvinceIndexes {
  readonly provinceIdsByCountry: ReadonlyMap<CountryId, readonly ProvinceId[]>;
  readonly populationClassKeysByProvince: ReadonlyMap<ProvinceId, readonly string[]>;
  readonly economicUnitIdsByProvince: ReadonlyMap<ProvinceId, readonly EconomicUnitId[]>;
  readonly marketIdsByProvince: ReadonlyMap<ProvinceId, readonly MarketId[]>;
  readonly transportNodeIdsByProvince: ReadonlyMap<ProvinceId, readonly TransportNodeId[]>;
}
```

实现要求：

1. 索引值内部按实体 ID 升序保存，保证查询和回放确定性。
2. 索引不得作为命令验证的唯一依据；调试模式可以回查权威表。
3. 新世界初始化和快照恢复后必须支持全量重建。
4. 正常 Tick 可以增量维护，但 Tick 末必须能选择性检查增量结果。
5. 索引不进入业务快照；如果为载入性能选择序列化缓存，必须带校验和且可安全丢弃重建。
6. 任何索引与权威状态不一致都属于模拟错误，不得静默修补后继续运行。

---

## 12. 省份归属变更

### 12.1 Command

```ts
interface TransferProvinceOwnershipCommand {
  readonly kind: "transfer-province-ownership";
  readonly commandId: string;
  readonly provinceId: ProvinceId;
  readonly expectedCurrentCountryId: CountryId;
  readonly targetCountryId: CountryId;
  readonly reason: Exclude<ProvinceOwnershipChangeReason, "scenario_initialization">;
}
```

`expectedCurrentCountryId` 是乐观并发前置条件，防止延迟的外交或脚本命令覆盖已经发生的归属变化。

命令验证顺序：

1. `commandId` 未被成功应用；
2. Province 存在；
3. 当前和目标 Country 存在；
4. 当前归属等于 `expectedCurrentCountryId`；
5. 目标 Country 与当前 Country 不同；
6. 命令允许在当前完整 Tick 边界生效。

V1 不在 Province 模块判断条约、战争或事件是否足以转属；上游外交、事件或调试系统在发出命令前负责玩法条件，World API 仍负责结构和并发校验。

### 12.2 原子提交

提交必须作为一个不可分割的 World 变更：

```text
把旧 ProvinceOwnershipState 追加为已经结束的归属期间
→ 更新当前 countryId、sinceTick、acquisitionReason 和 acquiredByCommandId
→ 更新 provinceIdsByCountry
→ 标记相邻 Boundary 的国界样式失效
→ 标记相关国家和省份 Metrics 失效
→ 产生 ProvinceOwnershipChanged 事件
```

任一步失败时全部回滚。命令在成功后按 `commandId` 幂等；重复提交返回原结果，不追加第二条历史或事件。

### 12.3 Event

```ts
interface ProvinceOwnershipChangedEvent {
  readonly eventType: "province-ownership-changed";
  readonly commandId: string;
  readonly tick: Tick;
  readonly provinceId: ProvinceId;
  readonly previousCountryId: CountryId;
  readonly currentCountryId: CountryId;
  readonly reason: Exclude<ProvinceOwnershipChangeReason, "scenario_initialization">;
}
```

归属变更明确不触发：

- 人口迁移或 Social Class 变化；
- 企业控制权、现金、债务或总部迁移；
- Economic Unit、Market、Inventory 或 Transport Node 的 `provinceId` 变化；
- 已完成交易、历史统计或账本记录重写。

归属相关税收、贸易、工资或政策规则从生效 Tick 之后按 Country 模块的阶段规则读取新归属。

---

## 13. Scheduler 挂接点

端到端顺序只以 `economic_simulation_web_architecture.md` 的标准 Tick 为准。Province 没有独立时钟，只在以下阶段挂接：

| Scheduler 阶段 | Province 行为                                                                     |
| -------------- | --------------------------------------------------------------------------------- |
| 1              | 原子提交归属、主要市场和主要运输节点变更；接收已验证的 Unit 迁址结果              |
| 2～3           | 把 Country 政策映射到当前 Province；向计划模块提供市场、资源潜力和只读索引        |
| 5～11          | 不主动修改其他模块，仅按 `provinceId` 接收阶段结果和索引失效标记                  |
| 12             | 检查引用完整性、当前归属唯一性、主要节点和反向索引一致性                          |
| 13～14         | 从 Population、Economic Units、Markets 和 Transport 聚合 Metrics、历史与 UI Delta |

归属或 Unit 迁址在 Tick 中途不可见。Province 不得在月末批次中插入额外招聘、生产、人口转移或基础设施更新；存档只允许在完整 Tick 结束且不变量通过后生成。

---

## 14. Metrics 与历史

### 14.1 Province Metrics

```ts
interface ProvinceEconomicUnitCounts {
  readonly factory: number;
  readonly farm: number;
  readonly store: number;
  readonly serviceBusiness: number;
  readonly headquarters: number;
  readonly warehouse: number;
  readonly road: number;
  readonly railway: number;
  readonly port: number;
  readonly utility: number;
  readonly governmentService: number;
}

interface ProvinceInfrastructureMetrics {
  readonly condition: number;
  readonly coverage: number;
  readonly activeEconomicUnitCount: number;
}

interface ProvinceMetrics {
  readonly provinceId: ProvinceId;
  readonly asOfTick: Tick;
  readonly populationPersons: number;
  readonly laborForcePersons: number;
  readonly employedPersons: number;
  readonly employmentRate: number;
  readonly averageMonthlyWageCents: number;
  readonly gdpCentsThisMonth: number;
  readonly householdConsumptionCentsThisMonth: number;
  readonly tradeValueCentsThisMonth: number;
  readonly economicUnitCounts: ProvinceEconomicUnitCounts;
  readonly infrastructureByKind: Readonly<
    Record<InfrastructureKindId, ProvinceInfrastructureMetrics>
  >;
}
```

`economicUnitCounts` 统计 Province 中所有尚未进入 `closed` 终态的 Unit，包括规划、建设、暂停、破产和清算中的 Unit；需要“当前营业数量”时必须按 `operatingStatus = active` 单独查询，不能混用两个口径。

Metrics 的来源必须可解释：

| 指标           | 主要来源                            |
| -------------- | ----------------------------------- |
| 人口与就业     | Population、Employment Allocation   |
| 平均工资       | Wage Settlement、人口收入累计器     |
| GDP            | Production、Markets、Accounting     |
| 消费           | 市场实际成交和人口结算              |
| 贸易           | Market、Transport、Accounting       |
| 经济单位数量   | 非 `closed` 的 `EconomicUnitState`  |
| 价格和生活成本 | 主要地方市场                        |
| 基础设施概况   | Economic Unit 与 Transport 组件聚合 |

不得把计划产量、挂单金额或期望消费误报为实际 GDP、贸易或消费。

### 14.2 历史采样

当前 Ownership 历史逐次变更保存；高频经济指标由 Statistics 模块按月采样。历史行至少包含 `provinceId`、期间、指标版本和数据包版本。

更改统计公式时增加指标版本，不回写旧存档中的历史值。UI 必须能够识别不连续的指标版本，不能在一条曲线中静默混合不同口径。

---

## 15. Query 与 View Model

### 15.1 省份摘要

```ts
interface ProvinceSummaryView {
  readonly provinceId: ProvinceId;
  readonly mapId: string;
  readonly mapFeatureId: string;
  readonly ownerCountryId: CountryId;
  readonly ownershipSinceTick: Tick;
  readonly primaryLocalMarketId: MarketId;
  readonly primaryTransportNodeId: TransportNodeId | null;
  readonly populationPersons: number;
  readonly employmentRate: number;
  readonly averageMonthlyWageCents: number;
  readonly gdpCentsThisMonth: number;
  readonly economicUnitCounts: ProvinceEconomicUnitCounts;
  readonly infrastructure: Readonly<
    Record<InfrastructureKindId, Readonly<ProvinceInfrastructureMetrics>>
  >;
  readonly asOfTick: Tick;
}
```

显示名称、首府和几何由 Client 使用 `mapId + mapFeatureId` 从地图运行包解析，不通过模拟协议重复发送完整几何。

### 15.2 推荐 Query

```text
getProvinceSummary
getProvincePopulationSummary
getProvinceLaborMarket
getProvinceEconomicUnits
getProvinceOwnershipHistory
getProvinceHistory
getProvinceInvariantReport
```

`getProvincePopulationSummary` 和 `getProvinceLaborMarket` 复用人口系统定义的结果，不在 Province 模块维护第二套 DTO 语义。

### 15.3 经济单位分页

```ts
interface GetProvinceEconomicUnitsQuery {
  readonly kind: "get-province-economic-units";
  readonly provinceId: ProvinceId;
  readonly unitKinds?: readonly EconomicUnitKind[];
  readonly industryIds?: readonly IndustryId[];
  readonly directController?: ShareholderRef;
  readonly operatingStatuses?: readonly EconomicUnitOperatingStatus[];
  readonly afterEconomicUnitId?: EconomicUnitId;
  readonly limit: number;
}

interface ProvinceEconomicUnitPage {
  readonly provinceId: ProvinceId;
  readonly asOfTick: Tick;
  readonly items: readonly EconomicUnitSummaryView[];
  readonly nextAfterEconomicUnitId: EconomicUnitId | null;
}
```

分页规则：

- `limit` 为 1～200；
- 过滤后始终按 `EconomicUnitId` 升序；
- Cursor 表示上一页最后一个 ID，而不是数组下标；
- Worker Request 的 `expectedTick` 用于保证多页查询针对同一世界状态；
- Tick 已变化时返回结构化 `STALE_QUERY_TICK`，UI 从第一页重新查询；
- 已关闭 Unit 默认不返回，只有显式请求 `closed` 时返回。

UI 和 Inspector 只能读取 View Model，不能持有或修改 Simulation Core 内部对象。

---

## 16. Command、Event 与错误

除归属变更外，Province 相关操作由负责玩法规则的模块定义 Command，并通过统一 World API 校验空间引用。至少产生以下事件：

```text
ProvinceOwnershipChanged
ProvincePrimaryMarketChanged
EconomicUnitActivated
EconomicUnitClosed
EconomicUnitRelocated
EconomicUnitControllerChanged
```

结构化错误至少包括：

```text
PROVINCE_NOT_FOUND
COUNTRY_NOT_FOUND
MARKET_NOT_FOUND
TRANSPORT_NODE_NOT_FOUND
ECONOMIC_SITE_NOT_FOUND
INVALID_PROVINCE_REFERENCE
OWNERSHIP_PRECONDITION_FAILED
OWNERSHIP_TARGET_UNCHANGED
PRIMARY_MARKET_OUTSIDE_PROVINCE
PRIMARY_TRANSPORT_NODE_OUTSIDE_PROVINCE
FIRM_HEADQUARTERS_INVALID
STALE_QUERY_TICK
PROVINCE_INVARIANT_FAILED
```

错误必须包含相关实体 ID、当前 Tick 和失败条件，不得只返回自然语言。协议层负责把内部错误映射为版本化 Worker Error Response。

---

## 17. 必须满足的不变量

### 17.1 Definition 与地图

```text
每个 ProvinceDefinition.id 唯一
每个 Definition 指向存在且唯一的地图 Province Feature
正式场景中的每个地图 Province 恰有一个 Definition
landAreaKm2 > 0 且为有限数
所有 terrain、climate 和 resource 引用存在
所有 resourcePotential 位于 0～1
```

### 17.2 当前状态

```text
每个 Province 恰有一条 ProvinceOwnershipState
ownership.countryId 指向存在的 Country
ownership.sinceTick <= currentTick
每个 Province 恰有一条 ProvinceLocalState
primaryLocalMarketId 指向同一 Province 内存在的 Market
primaryTransportNodeId 为 null 或指向同一 Province 内存在的 Node
```

### 17.3 历史

```text
同一 Province 的已结束归属期间不重叠
fromTick < untilTickExclusive
历史最后期间的 untilTickExclusive = 当前 ownership.sinceTick
历史与当前期间首尾连续
历史引用的 Country 存在
scenario_initialization 的 acquiredByCommandId 为 null
其他 acquisitionReason 的 acquiredByCommandId 非空
```

场景初始化的第一段当前归属不要求存在一条伪造的已结束历史。

### 17.4 人口和经济单位

```text
所有 PopulationClassState.provinceId 指向存在的 Province
同一 provinceId + socialClassId 最多一条人口状态
每省 PopulationClassState 数量 <= 11
所有 EconomicUnitState.provinceId 指向存在的 Province
foundedTick <= currentTick
已启用的 Unit 必须有 activatedTick，且 foundedTick <= activatedTick <= currentTick
closed 状态必须有 closedTick，非 closed 状态不得有 closedTick
closedTick 不得早于 foundedTick 或 activatedTick
closed Unit 不得重新进入其他状态
每个 Unit 的 Employer、股本、股东和经营组件满足经济单位规格
Market、TransportNode、Employer 的 provinceId 均有效
```

### 17.5 索引与数值

```text
provinceIdsByCountry 与 Ownership 全量扫描结果一致
populationClassKeysByProvince 与 Population 全量扫描结果一致
economicUnitIdsByProvince 与 EconomicUnit 全量扫描结果一致
索引内无重复 ID 且严格升序
所有人数、金额、数量和 Metrics 为有限数
人数、地点数量和不允许为负的金额 >= 0
所有率位于定义允许范围
```

调试和测试构建每 Tick 检查全部不变量。发行构建每 Tick 检查局部变更实体，并按配置定期执行全量审计；任何失败都停止推进并输出可重放诊断信息。

---

## 18. 静态数据与加载校验

省份系统至少消费：

```text
地图包：
assets/maps/<mapId>/map.json
assets/maps/<mapId>/provinces.geojson
assets/maps/<mapId>/boundaries.json

游戏数据：
provinces.json
province-initial-state.json
terrain-profiles.json
climate-profiles.json
resource-definitions.json
```

加载顺序：

```text
加载并校验地图包
→ 加载 Province Definitions
→ 建立 Province ID / Map Feature 映射
→ 加载 Country、Market、Transport 和 Economic Unit 定义
→ 加载 Province Initial State
→ 加载人口、经济单位和股权初始状态
→ 建立全部反向索引
→ 执行完整引用和不变量检查
→ 发布可运行 World State
```

任何重复 ID、缺失引用、超范围比例或一对一关系违反都使整个场景加载失败。不得跳过错误 Province 后继续创建不完整世界。

游戏数据版本和地图包版本进入存档元数据。以下变化视为需要迁移或明确不兼容：

- 删除或复用 Province ID；
- 改变 Province ID 与地图 Feature 的映射；
- 修改派生基础设施 Metrics 的字段含义或单位；
- 改变归属历史的期间语义；
- 将一个 Province 拆分或合并为多个新 ID。

只修改显示名称、翻译或不影响 ID 的地图渲染细节不需要迁移模拟状态。

---

## 19. 存档、恢复与确定性

省份存档内容包括：

```text
ProvinceOwnershipState[]
ProvinceOwnershipHistoryEntry[]
ProvinceLocalState[]
```

以下内容不进入权威省份存档：

- 地图几何、名称、首府和编译网格；
- `ProvinceDefinition` 的逐项副本；
- `ProvinceMetrics` 当前缓存；
- 省份反向索引；
- Inspector View Model 和分页 Cursor；
- 可由事件或 State 重建的临时失效标记。

恢复顺序：

```text
校验存档和数据包版本
→ 恢复权威 World State
→ 重建 Province 索引
→ 重新计算当前 Metrics
→ 执行完整不变量检查
→ 恢复模拟推进
```

同一模拟版本、数据版本、地图版本、初始状态、种子和 Command 序列必须得到相同的：

- Province Ownership 和历史；
- 经济单位索引顺序；
- Province Metrics；
- Event 顺序；
- 快照后续运行结果。

所有遍历和聚合必须按稳定 ID 顺序。不得让 JavaScript 对象插入顺序、Map 构建顺序或 UI Query 顺序影响模拟结果。

---

## 20. 推荐模块边界

| 模块           | 主要读取                                  | 主要写入                             |
| -------------- | ----------------------------------------- | ------------------------------------ |
| Provinces      | Definition、Ownership、地方状态、阶段输出 | 归属、地方状态、索引缓存、Metrics    |
| Population     | Province 存在性、地方市场、派生 Metrics   | Class 状态、迁移结果、消费计划       |
| Economic Units | Province、市场、资源潜力                  | Unit、股权、经营计划与退出结果       |
| Markets        | 地点、人口需求、库存和运输                | 成交、价格、配给和市场状态           |
| Transport      | Province 归属、边界、节点和基础设施       | 路径、流量、在途状态                 |
| Country        | Province Ownership 和省级聚合             | 国家政策、财政、外交和国家级 Metrics |
| Statistics     | 所有只读状态和期间结果                    | 可重算 Metrics 与版本化历史          |

Province 模块可以提供校验和索引服务，但不能反向依赖 React、Worker、地图渲染或 Tauri。

---

## 21. 自动测试与验收场景

### 21.1 单元测试

- Definition 和地图 Feature 一对一校验；
- Province Ownership 当前状态与历史期间更新；
- 主要市场和运输节点同省校验；
- Economic Unit 过滤、稳定排序和 Cursor 分页；
- 索引增量更新与全量重建结果一致；
- Province Metrics 对零人口、零地点和零成交安全；
- 所有除零路径返回显式零或结构化错误，不产生 NaN。

### 21.2 最小纵向场景

建立两个 Province、两个 Country、两个地方市场和 11 个 Social Class Definition：

```text
Province A
├── 11 个 Class 中 8 个非零
├── 2 个工厂
├── 1 个仓库
├── Headquarters H
│   ├── 持有 Factory F 100%
│   └── 持有 Store S 80%
└── Road R

Province B
├── 11 个 Class 中 5 个非零
├── 1 个农场
├── Headquarters H 控制的 2 个商店
└── Port P
```

验收：

1. 两省人口、就业和 Unit 数量聚合正确，零人口 Class 在 Query 中补零。
2. Headquarters H 正确显示位于 A，并通过股权控制跨省 Unit；Province 不保存集团成员数组。
3. B 新建商店、关闭农场、将一个商店迁到 A 后，索引、分页和 Metrics 在 Tick 边界一致更新。
4. Port P 破产后，经营权按经济单位规格转让或关闭，不留下无运营者但仍提供容量的状态。
5. A 从 Country 1 转属 Country 2 后，人口、Economic Unit、市场和运输节点保持原 Province；国家聚合和相邻国界更新。
6. 保存再载入后继续运行，与未载入分支产生相同摘要、事件和索引顺序。

### 21.3 错误场景

- 引用不存在 Province 的 Population、Economic Unit、Market 或 Transport Node 时拒绝加载或提交；
- 使用过期 `expectedCurrentCountryId` 转属时不修改任何状态；
- 把主要市场或运输节点设置到其他 Province 时拒绝；
- Economic Unit 的 Employer、股本或主经营组件缺失时拒绝加载；
- 跨省道路没有在省界处分段时拒绝场景数据；
- 分页第二页的 `expectedTick` 过期时返回 `STALE_QUERY_TICK`；
- 人为破坏索引后，全量审计能够报告首个差异实体和可重放 Tick。

### 21.4 长期、回放与性能测试

- 固定种子和 Command Log 运行至少 100,000 日 Tick；
- 周期性迁址、开店、关店、破产和归属变更后不变量持续成立；
- 相同实体以不同输入顺序加载，最终快照指纹一致；
- 5,000 Province、200,000 Economic Unit 压力场景通过；
- Tick 末聚合复杂度目标为 `O(P + C + E + M + T)`，不允许每省扫描全部经济实体；
- 单 Province 经济单位分页只扫描该 Province 索引和匹配结果；
- 输出 Tick 耗时、索引内存、全量审计耗时、最大省份地点数和失败 Tick。

具体毫秒和内存门槛由总体架构的标准测试机器基准确定；达到门槛前不得仅凭预期迁移到多 Worker、WASM 或二进制状态。

---

## 22. 实施阶段

### Milestone 1：省份身份、地图和归属

交付：

- `ProvinceDefinition`、初始状态加载器和静态数据校验；
- 地图 Feature 一对一绑定；
- `ProvinceOwnershipState`、历史期间和国家反向索引；
- 归属变更 Command、Event、幂等和回放测试；
- 省份摘要中的地图引用与当前国家。

验收：两个 Country、两个 Province 的归属可以确定性变更；地图国界和国家省份列表只从 Ownership 派生。

### Milestone 2：人口、地方市场和基础设施 Metrics

交付：

- Population Class 省份索引和人口 Query 接入；
- 主要地方市场与主要运输节点引用；
- 从 Economic Unit 与 Transport 派生基础设施 Metrics；
- 第一版 Province Metrics。

验收：省份 Inspector 可以查询人口、劳动力、市场和基础设施，不存在重复权威人口或价格状态。

### Milestone 3：经济单位和跨省集团

交付：

- `EconomicUnitState` 和专有经营组件引用规则；
- Unit 创建、启用、关闭、迁址事件；
- Employer、股本和股东约束；
- 按 Province 建立可重建 Unit 索引；
- 带过滤和稳定 Cursor 的经济单位分页 Query。

验收：总部通过股权控制跨省 Unit；不同省份可拥有可变数量的工厂、商店、道路、港口和总部；生命周期操作后索引与全量扫描一致。

### Milestone 4：完整读模型、快照和性能

交付：

- Province Summary、Ownership History、Invariant Report 和历史指标；
- Worker 协议 DTO、结构化错误和 UI Delta；
- Province Inspector 的概况、人口、经济和行政归属入口；
- 快照恢复、固定回放、长时间和压力测试；
- 基准数据与性能报告。

验收：最小纵向场景和 5,000 Province 压力场景通过，存档分支与连续运行结果一致，UI 不直接访问权威模拟对象。

---

## 23. 后续升级条件

以下能力必须另行形成玩法规格或 ADR，不能在 V1 中隐式加入：

| 能力                     | 启用前必须解决的问题                                   |
| ------------------------ | ------------------------------------------------------ |
| 省级政府和地方政策       | 国家与省权限、财政来源、AI、政策冲突和 UI              |
| 占领、主权声索和合法性   | 实际控制与法理归属双状态、战争、税收和抵抗             |
| 动态拆分与合并 Province  | 地图几何、稳定 ID、人口与资产分配、历史和存档迁移      |
| 省内城市和区县           | 新空间层级、市场粒度、通勤、运输和性能预算             |
| 跨省通勤                 | 居住地与工作地双引用、工资结算、交通容量和人口统计口径 |
| 多地方市场               | 默认市场选择、套利、运输、价格指标和 Inspector         |
| 运行时地图或玩家地图迁移 | Province ID 映射、缺失实体处理和确定性内容校验         |

只有当相应差异能产生玩家可观察的决策，并且通过性能、存档和解释性预算时才升级粒度。

---

## 24. 最终实现原则

1. Province 是稳定的行政和空间键，不是承载全部世界对象的巨型容器。
2. 当前国家归属只有一个权威来源；国家列表、国界和国家统计全部派生。
3. 地图负责几何与展示，模拟负责经济与行政状态，两者通过稳定 ID 连接。
4. Social Class 属于人口模块，工厂、商店和总部属于相应经济模块，Province 只提供定位、校验、索引和聚合。
5. 可变数量实体使用独立 ID 和可重建索引，不在 Province State 中保存可修改的子对象列表。
6. 所有跨模块变化在明确 Tick 边界原子提交，并产生可解释事件。
7. 所有 Query 都返回带 `asOfTick` 的只读 View Model；大集合必须过滤、稳定排序和分页。
8. 存档只保存不可重建的权威 State；恢复后重建索引、Metrics 并执行完整校验。
9. 确定性、引用完整性和省级汇总可对账优先于微观地理精度。
10. 新政治层级、新空间粒度或动态边界必须通过单独规格扩展，不能破坏 V1 的权威关系。
