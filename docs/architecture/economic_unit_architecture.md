# 经济模拟器经济单位系统实施规格

> 文档状态：可实施基线（Implementation Baseline）  
> 适用版本：经济单位系统 V1  
> 基础 Tick：1 日；工资、利润、税费和分红按月结算  
> 相关文档：`economic_simulation_web_architecture.md`、`province_architecture.md`、`economic_simulator_population_system.md`  
> 核心取舍：经济单位同时是经营、雇佣、会计和股权主体；公司集团由经济单位之间的持股关系派生

---

## 1. 已定决策

V1 采用以下设计：

1. Economic Unit 是经济活动的最小独立经营与结算单位，包括工厂、农场、商店、服务机构、总部、仓库、道路、铁路、港口、公用事业和政府服务单位。
2. 每个 Economic Unit 拥有稳定 ID、一个主要所在 Province、独立账户、独立雇佣关系、独立采购与销售计划、独立利润和独立股本。
3. 每个 Economic Unit 都是 Employer。真实经济单位的 `EmployerId` 与 `EconomicUnitId` 使用同一个值，不维护第二套身份。
4. 每个非 `closed` Economic Unit 都必须有正数的已发行普通股和至少一个股东。V1 只模拟一种同权普通股，不做优先股、期权、可转债或不同投票权。
5. 股东可以是省份 Social Class 的投资账户、其他 Economic Unit 或 Country Government。个人居民不直接出现在股东名册中。
6. Economic Unit 可以持有其他 Economic Unit 的股份。总部或控股单位通过持股控制工厂、商店等子单位；企业集团是股权图的派生结果，不是第二套可修改所有权状态。
7. V1 禁止经济单位之间形成直接或间接循环持股，股权图必须是有向无环图。
8. 工资、采购、销售、税费、债务、投资和分红都必须产生标准交易并进入 Accounting Ledger。
9. 商品和可存储产出进入 Inventory；服务和运输能力按期间容量出售，不创建虚假库存。
10. 道路、铁路和港口是特殊 Economic Unit：它们雇佣员工、采购维护投入、出售运输或装卸服务、结算利润并向股东分红。
11. 免费向使用者开放的基础设施也必须有付款方，例如政府购买可用性服务；不得凭空产生维护资金。
12. 每个 Economic Unit 只能属于一个 Province。跨省道路或铁路在省界处分段为多个 Economic Unit，并通过 Transport Graph 连接。
13. 经济单位的当前状态是权威数据；产量、销售额、利润率、估值和集团汇总是 Metrics，不回写成并行真相。
14. 破产、关闭、出售、增发、股份转让和分红只在完整 Tick 边界原子提交。

V1 明确不做：

- 个人级股东和逐人证券账户；
- 多类别股份、优先股、期权、可转债和复杂公司行动；
- 循环持股、交叉持股和无限层穿透计算；
- 证券交易所订单簿、高频交易和日内股价；
- 合并报表、商誉、少数股东损益和复杂税务会计；
- 同一法人直接内嵌任意数量、没有独立账目的经营地点；
- 将计划采购、计划产量或挂牌销售额当作已实现交易；
- 道路、港口等基础设施脱离所有者、账目和维护成本独立运行。

---

## 2. 核心经营闭环

```text
Shareholders
    │ 注资 / 股份转让
    ▼
Economic Unit
    ├── 读取价格、库存、订单和资产状态
    ├── 生成岗位、采购、生产和销售计划
    │
    ├── Employer ───────────────► Labor Market
    │                                │
    │                             员工与工资
    │                                ▼
    ├── Procurement Orders ─────► Goods / Service Markets
    │                                │
    │                         原料、服务与应付款
    │                                ▼
    ├── Production / Retail / Infrastructure Operation
    │                                │
    │                         商品库存或服务容量
    │                                ▼
    ├── Sales Offers ───────────► Goods / Service Markets
    │                                │
    │                         销售收入与应收款
    │                                ▼
    └── Monthly Close
         ├── 工资、采购、维护、利息和税费
         ├── 利润 / 亏损与留存收益
         ├── 偿债、投资和现金储备
         └── 可选分红 ──────────► Shareholders
```

经济单位模块负责：

- 经济单位身份、种类、Province 归属和生命周期；
- 经营状态与通用计划阶段；
- Employer 一对一接入；
- 股本、股东名册、股份发行和转让；
- 月度结账、利润留存和分红预算；
- 经营组件的引用完整性；
- 经济单位、股东和企业集团查询；
- 破产、关闭和所有权变化的原子协调。

经济单位模块不负责：

- 劳动力匹配和参考工资形成；
- 商品或服务市场的撮合、定价和配给；
- 具体生产配方、零售补货算法或运输寻路；
- 银行放贷、货币创造或国家税率制定；
- Population Class 内部收入、财富和阶层流动；
- Province、Country 或集团 Metrics 的最终统计口径。

---

## 3. Economic Unit、公司与经营地点

V1 不额外建立同时拥有相同现金、员工和股东的 `FirmState`。Economic Unit 本身就是被公司制股权拥有的经营主体。

```text
Economic Unit                    具有独立经营、账户、员工和股本
Headquarters Unit                提供管理服务并可持有其他单位股份
Subsidiary Unit                  被另一个 Economic Unit 控制的单位
Enterprise Group                 从控制关系派生的总部与子单位集合
Brand                            可选展示或市场定义，不代表法律所有权
Operating Component             生产、零售、仓储或运输模块中的专有状态
```

示例：

```text
Population Class Investment Pools
              │ 持股
              ▼
      Alpha Headquarters Unit
        ├── 100% Alpha Factory A
        ├── 80%  Alpha Store B
        └── 60%  Alpha Port C
```

Alpha Group 由控制关系派生。Factory A、Store B 和 Port C 仍分别雇佣、采购、销售、结账和分红；总部收到子单位分红后形成自己的投资收入。

这种模型是游戏化简化：现实中一个法人可以直接经营多个地点，游戏 V1 为了让省级经营、破产和收购可解释，把需要独立模拟的工厂、商店和基础设施视为单独公司化单位。

---

## 4. 数据分层与公共 ID

### 4.1 四类数据

```text
Definition  单位种类、行业、商品、服务、配方和参数
State       身份、位置、状态、账户引用、股本、持股和经营组件
Metrics     收入、成本、利润率、产能利用率、估值和集团汇总
View Model  Inspector、股东名册、经营明细和历史分页结果
```

### 4.2 公共 ID

```ts
type EconomicUnitId = string;
type ProvinceId = string;
type CountryId = string;
type SocialClassId = string;
type IndustryId = string;
type CommodityId = string;
type ServiceId = string;
type MarketId = string;
type InventoryHolderId = string;
type LedgerAccountId = string;
type TransportNodeId = string;
type TransportEdgeId = string;
type Tick = number;
```

真实 Employer 的 `EmployerId` 与 `EconomicUnitId` 使用相同值。人口系统中的 `self_employment_pool` 是劳动力聚合工具，不是 Economic Unit，不拥有股本，也不得进入经济单位查询。

所有 ID 全局稳定且不包含显示名称。跨模块关系只传 ID，不持有可变对象引用。

---

## 5. Economic Unit Definition 与权威状态

### 5.1 种类

```ts
type EconomicUnitKind =
  | "factory"
  | "farm"
  | "store"
  | "service_business"
  | "headquarters"
  | "warehouse"
  | "road"
  | "railway"
  | "port"
  | "utility"
  | "government_service";

type EconomicUnitOperatingStatus =
  | "planned"
  | "under_construction"
  | "active"
  | "suspended"
  | "insolvent"
  | "liquidating"
  | "closed";
```

### 5.2 权威核心状态

```ts
interface EconomicUnitState {
  readonly id: EconomicUnitId;
  readonly kind: EconomicUnitKind;
  provinceId: ProvinceId;
  industryId: IndustryId;
  defaultMarketId: MarketId;
  operatingStatus: EconomicUnitOperatingStatus;
  readonly foundedTick: Tick;
  activatedTick: Tick | null;
  closedTick: Tick | null;
  accountRefs: EconomicUnitAccountRefs;
  dividendPolicy: DividendPolicyState;
}

interface EconomicUnitAccountRefs {
  readonly cash: LedgerAccountId;
  readonly receivables: LedgerAccountId;
  readonly payables: LedgerAccountId;
  readonly debt: LedgerAccountId;
  readonly inventory: LedgerAccountId;
  readonly fixedAssets: LedgerAccountId;
  readonly accumulatedDepreciation: LedgerAccountId;
  readonly investmentAssets: LedgerAccountId;
  readonly contributedCapital: LedgerAccountId;
  readonly retainedEarnings: LedgerAccountId;
  readonly revenue: LedgerAccountId;
  readonly expenses: LedgerAccountId;
}
```

账户余额由 Accounting Ledger 派生，`EconomicUnitState` 只保存账户引用，不复制现金、收入或利润数值。

### 5.3 生命周期

标准状态流：

```text
planned → under_construction → active ↔ suspended
                                  │
                                  ▼
                              insolvent
                                  │
                                  ▼
                              liquidating → closed
```

项目取消允许从 `planned` 或 `under_construction` 直接进入 `closed`。`closed` 是终态，ID 不得复用或重新启用。

第一次进入 `active` 时设置 `activatedTick`。暂停和恢复不改写它。进入 `closed` 时设置 `closedTick`，并停止生成新岗位、采购、生产和销售计划。

---

## 6. 经营组件而非可选字段巨型对象

不同种类使用同一个 Economic Unit 核心，并在对应业务模块保存以 `economicUnitId` 为键的专有组件：

```text
EconomicUnitState
├── EmployerState                         所有真实单位必有
├── EconomicUnitEquityState               所有单位必有
├── ProductionOperationState              工厂、农场、公用事业
├── RetailOperationState                  商店
├── ServiceOperationState                 服务机构、总部、政府服务
├── WarehouseOperationState               仓库
└── TransportInfrastructureOperationState 道路、铁路、港口
```

不得创建一个包含几十个可空字段的 `EconomicUnitState`。单位种类和组件必须满足固定矩阵：

| Unit Kind          | 必需经营组件                          |
| ------------------ | ------------------------------------- |
| factory            | Production                            |
| farm               | Production                            |
| store              | Retail                                |
| service_business   | Service                               |
| headquarters       | Service                               |
| warehouse          | Warehouse                             |
| road / railway     | Transport Infrastructure              |
| port               | Transport Infrastructure + Service    |
| utility            | Production 或 Service，由行业定义指定 |
| government_service | Service                               |

每个非 `closed` 单位必须有且只有一种符合 Kind 的主经营组件。所有真实单位都有 Employer 和 Equity 组件，即使当前岗位数或利润为零。

---

## 7. Province、市场与空间归属

每个 Economic Unit 在任意完整 Tick 边界恰好属于一个 Province：

```text
EconomicUnitState.provinceId
```

这个 Province 决定：

- 本地劳动力供给和招聘市场；
- 默认商品与服务市场；
- 适用的 Country 政策、税收和监管；
- 省级产出、就业和经济单位统计；
- 经营地点的地图 Inspector 入口。

`defaultMarketId` 必须指向同一 Province 内可接受该单位订单的市场。单位可以通过贸易或运输向其他市场买卖，但不能借此改变本地雇佣和行政归属。

迁址只能在完整 Tick 边界执行。迁址模块必须同时处理员工、库存、挂单、运输订单、许可和经营组件；不得只修改 `provinceId` 留下跨省悬空状态。

V1 的跨省道路和铁路在省界处分段。每段是独立 Economic Unit，拥有自己的员工、维护账目、服务容量和股东；Transport Edge 把相邻路段连接为可通行网络。

---

## 8. Employer 与劳动力接入

### 8.1 一对一关系

`EmployerState` 只由 `economic_simulator_population_system.md` 定义。每个真实 Economic Unit 必须恰好对应一条同 ID Employer 记录；Employer 的 Province 和 Kind 从 Unit 派生，不在本模块声明或保存第二份 Schema。

经济单位负责根据经营计划和支付能力生成下一月岗位需求；劳动力市场负责裁员、招聘、工资报价和就业分配。经济单位不得直接修改 `PopulationClassState`。

### 8.2 岗位计划

岗位需求至少读取：

- 计划产量或服务容量；
- 生产技术和岗位配比；
- 当前员工与空缺；
- 工资报价和雇主税费；
- 现金储备、预计收入和已到期义务；
- Unit 的运行状态。

`planned`、`under_construction` 可以生成建设或筹备岗位；`suspended` 只能保留必要岗位；`insolvent` 和 `liquidating` 按破产流程裁减岗位；`closed` 不得拥有正数岗位需求或就业分配。

工资结算必须由 Economic Unit 的现金或应付账户支付，并写入人口收入累计器。无法支付工资时不得凭空发薪，必须进入欠薪、缩减岗位或破产流程。

---

## 9. 采购

### 9.1 采购计划

```ts
interface ProcurementPlanState {
  readonly economicUnitId: EconomicUnitId;
  readonly inputId: CommodityId | ServiceId;
  readonly destinationInventoryHolderId: InventoryHolderId | null;
  targetQuantityThisPeriod: number;
  maximumUnitPriceCents: number;
  priority: number;
}
```

可存储商品必须指定目标 Inventory Holder；即时服务的目标为 `null`。计划不是订单或成交，不改变库存、现金或成本。

采购计划由经营组件生成：

- 工厂和农场采购配方投入、能源、维护和外部服务；
- 商店采购转售库存、包装、能源和店面服务；
- 总部采购办公、专业和信息服务；
- 仓库采购能源、维护和装卸服务；
- 道路、铁路和港口采购维修材料、燃料、设备和工程服务。

### 9.2 从计划到结算

```text
Procurement Plan
→ Market Order / Contract Request
→ Market Matching and Allocation
→ Transport or Immediate Service Delivery
→ Inventory / Service Receipt
→ Ledger Settlement
```

只有实际交付数量进入库存或期间费用。未成交订单不产生采购成本；已付款但未交付的交易进入预付款或应收，不得同时计入库存。

关联单位之间的采购也必须形成正常交易。V1 不允许集团内部无价格转移商品或服务。

---

## 10. 生产、服务与销售

### 10.1 商品生产

Production 组件读取已交付投入、设备、员工和产能，按配方生成商品：

```ts
interface ProductionOperationState {
  readonly economicUnitId: EconomicUnitId;
  readonly recipeId: string;
  readonly inputInventoryHolderId: InventoryHolderId;
  readonly outputInventoryHolderId: InventoryHolderId;
  installedCapacityPerPeriod: number;
  equipmentCondition: number;
}
```

商品产出进入 Unit 对应库存，不能因为生成销售 Offer 而提前扣除。实际成交并交付后才确认销量和收入。

### 10.2 零售

Store 不制造所售商品，而是采购库存并按零售服务形成销售 Offer。零售加价是报价决策，不是保证利润；配给、损耗、折扣和滞销必须反映在实际结算中。

### 10.3 服务容量

不可存储服务使用期间容量：

```ts
interface ServiceCapacityState {
  readonly economicUnitId: EconomicUnitId;
  readonly serviceId: ServiceId;
  availableQuantityThisPeriod: number;
  consumedQuantityThisPeriod: number;
}
```

未使用服务容量在期间结束时失效，不进入 Inventory。服务成交量不得超过可用容量。

### 10.4 销售 Offer

```ts
interface EconomicUnitSalesPlan {
  readonly economicUnitId: EconomicUnitId;
  readonly outputId: CommodityId | ServiceId;
  readonly sourceInventoryHolderId: InventoryHolderId | null;
  offeredQuantity: number;
  minimumUnitPriceCents: number;
}
```

商品必须指定来源库存；服务的来源为 `null`。Offer 只表达供给意愿，实际销售额以市场成交、交付和账本结算为准。

---

## 11. 道路、铁路和港口

### 11.1 运输基础设施组件

```ts
type TransportInfrastructureKind = "road" | "railway" | "port";

interface TransportInfrastructureOperationState {
  readonly economicUnitId: EconomicUnitId;
  readonly kind: TransportInfrastructureKind;
  readonly transportNodeIds: readonly TransportNodeId[];
  readonly transportEdgeIds: readonly TransportEdgeId[];
  serviceId: ServiceId;
  condition: number;
  maximumCapacityPerDay: number;
}
```

道路和铁路 Unit 至少引用一个 Transport Edge；港口至少引用一个位于同一 Province 的 Transport Node。引用的资产不能同时被两个活动 Economic Unit 作为同一经营权主体控制。

### 11.2 经营方式

| 基础设施 | 出售的服务                         | 主要采购                       |
| -------- | ---------------------------------- | ------------------------------ |
| 道路     | 道路通行、货运容量或可用性服务     | 路面材料、工程、设备和维护     |
| 铁路     | 轨道通行、列车运力或可用性服务     | 钢轨、电力、车辆、设备和维护   |
| 港口     | 靠泊、装卸、仓储衔接和港口通行服务 | 能源、设备、维修和外包装卸服务 |

Transport 模块把市场购买的运输服务转换为路径容量和实际流量。基础设施 Unit 不自行决定所有货物路径，也不能把未使用容量记作成交。

### 11.3 免费使用与公共所有

基础设施可以向终端使用者收取零价格，但运营成本必须由明确合同支付：

```text
Country Government 购买“道路可用性服务”
→ Road Unit 获得收入
→ 使用者通行价格为 0
```

公共所有通过 Government 持有股份表达，不通过“无股东”或跳过账本表达。政府既可以是股东，也可以是服务购买者；股息收入与服务采购支出必须分别记账。

### 11.4 维护与退化

实际维护投入和工程服务影响 `condition`；condition 再影响可售容量、速度、损耗或事故风险。不得直接用维护预算替代已交付维护量。

维护不足时基础设施允许亏损、降级、暂停或破产。破产并不删除 Transport 几何；清算流程必须把经营权出售给新 Unit、转为 Government 所有或明确关闭对应容量。

---

## 12. 股本与股东

### 12.1 股东类型

```ts
type ShareholderRef =
  | {
      readonly kind: "population_class";
      readonly provinceId: ProvinceId;
      readonly socialClassId: SocialClassId;
    }
  | { readonly kind: "economic_unit"; readonly economicUnitId: EconomicUnitId }
  | { readonly kind: "government"; readonly countryId: CountryId };
```

Population Class 股东引用该 Class 的投资账户。Class 人数变化不会按人拆分股份；股份和股息仍属于聚合账户。

### 12.2 权威股本状态

```ts
interface EconomicUnitEquityState {
  readonly economicUnitId: EconomicUnitId;
  totalSharesOutstanding: number;
}

interface SharePositionState {
  readonly economicUnitId: EconomicUnitId;
  readonly shareholder: ShareholderRef;
  sharesOwned: number;
  lastChangedTick: Tick;
}
```

股份数量使用正安全整数。所有权比例是派生值：

```text
ownershipShare = sharesOwned / totalSharesOutstanding
```

不得把百分比作为权威状态。零股份记录立即移出当前股东名册，但历史交易保留。股东使用以下规范键排序和建立索引：

```text
population_class:<provinceId>:<socialClassId>
economic_unit:<economicUnitId>
government:<countryId>
```

### 12.3 初始资本

创建 Economic Unit 必须在同一个原子操作中：

1. 创建 Unit 和必需组件；
2. 创建账本账户；
3. 发行正数普通股；
4. 建立至少一个 Share Position；
5. 把股东支付的现金记入 Unit 现金和实收资本；
6. 检查股本、现金和交易守恒；
7. 产生 `EconomicUnitFounded` 和 `SharesIssued` 事件。

不允许先创建无股东 Unit，再等待未来 Tick 补齐。

---

## 13. 股份发行、转让与控制

### 13.1 增发

V1 只支持以现金认购新股：

```ts
interface IssueSharesCommand {
  readonly kind: "issue-economic-unit-shares";
  readonly commandId: string;
  readonly economicUnitId: EconomicUnitId;
  readonly subscriber: ShareholderRef;
  readonly sharesToIssue: number;
  readonly totalSubscriptionPriceCents: number;
}
```

现金支付、股本增加、Share Position 更新和事件必须原子提交。增发会稀释现有股东，不需要逐项改写其股份数。

### 13.2 二级转让

```ts
interface TransferSharesCommand {
  readonly kind: "transfer-economic-unit-shares";
  readonly commandId: string;
  readonly economicUnitId: EconomicUnitId;
  readonly seller: ShareholderRef;
  readonly buyer: ShareholderRef;
  readonly shares: number;
  readonly totalPriceCents: number;
}
```

转让支付发生在买卖双方账户之间，不改变被投资 Unit 的现金、收入或利润。买方和卖方仍须在各自的投资资产、现金及处置损益账户中记账；Population Class 或 Government 使用各自对应账户。股份、现金和交易记录必须在同一原子批次提交。

V1 不模拟证券交易所撮合；转让来自玩家命令、AI 协议、收购或事件系统。价格是本次交易事实，不自动成为全体股份的权威估值。

### 13.3 控制关系

直接持有超过 50% 已发行股份的单一股东是控制方。没有任何单一股东超过 50% 时，V1 记为无单一控制方，不推断股东协议或一致行动人。

Enterprise Group 从 Economic Unit 控制关系派生。集团查询可以递归展开子单位，但热路径不得每 Tick 对全部单位重复遍历完整所有权图。

Economic Unit 认购或受让股份前必须检查不会形成直接或间接循环持股。V1 发现循环时拒绝整个交易。

---

## 14. 收入、成本、利润与留存收益

月度结账使用已完成 Ledger Transaction，不读取计划或报价：

```text
Operating Revenue
+ Dividend and Other Recognized Income
- Delivered Input and Service Expense
- Wage and Employer Cost
- Maintenance and Depreciation
- Interest Expense
- Taxes
= Accounting Profit Before Distribution
```

精确会计科目由 Accounting 规格定义。经济单位系统必须遵守：

- 销售在实际交付和收入确认后计入；
- 可存储原料先进入库存，只有消耗或销售时进入成本；
- 资本设备采购不在当月一次性全部作为费用；
- 股东注资不是收入；
- 股份转让不是被投资 Unit 的收入；
- 分红不是费用，而是现金和留存收益的减少；
- 借款不是收入，还本不是费用；
- 所有余额必须从标准账户和交易解释。

亏损减少留存收益。累计亏损、现金不足或无法清偿到期义务可以触发 `insolvent`，但利润为负本身不立即等于破产。

---

## 15. 分红

### 15.1 分红政策

```ts
interface DividendPolicyState {
  targetPayoutRate: number;
  minimumCashReserveCents: number;
}
```

`targetPayoutRate` 位于 0～1，表示对可分配上限的目标比例，不保证实际分红。

### 15.2 可分配上限

月末在工资、采购交付、维护、利息、税费和到期债务结算后计算：

```text
earningsLimit
= max(0, retainedEarningsAfterClose)

cashLimit
= max(0,
     cashAfterMandatoryPayments
     - minimumCashReserve
     - committedPaymentsBeforeNextClose)

maximumDividend
= min(earningsLimit, cashLimit)

targetDividend
= floor(maximumDividend * targetPayoutRate)
```

`insolvent`、`liquidating` 或 `closed` Unit 的目标分红固定为零。不得借新债只为在同一结算阶段支付分红。

### 15.3 确定性分配

V1 在同一个月末批次中声明并立即支付分红，不保存未支付股息负债。实际分红不足时先降低声明金额，再记账。

```text
basePayment_i
= floor(totalDividend * shareholderShares_i / totalSharesOutstanding)
```

整分余数按股东规范排序键升序逐分分配，直到支付总额等于 `totalDividend`。股东名册使用结算阶段开始时的快照；同一阶段发生的股份转让从下月分红起生效。

分红交易：

- 借记 Unit 留存收益；
- 贷记 Unit 现金；
- 增加股东现金或人口投资账户；
- Population Class 同时记录股息收入；
- Government 同时记录股息收入；
- Economic Unit 股东记录投资收入，但该收入最早下月进入其可分红预算。

最后一条建立一个月传导滞后，避免按 Unit 排序不同导致同月递归分红结果不同。

---

## 16. 企业集团与总部

`headquarters` 是普通 Economic Unit 的特殊 Kind。它可以：

- 雇佣管理、财务、法务、技术和行政员工；
- 采购办公、咨询、信息和其他服务；
- 向受控单位出售管理或共享服务；
- 持有其他 Economic Unit 股份并收取分红；
- 自己拥有直接股东并向其分红。

总部不是集团所有权的第二真相来源。一个 Headquarters Unit 只有在持有另一个 Unit 超过 50% 股份时才控制它。

推荐派生查询：

```text
getDirectController
getDirectSubsidiaries
getEnterpriseGroup
getUltimateShareholders
```

`getUltimateShareholders` 只用于 Inspector 和统计，不用于每日经营热路径。因为 V1 股权图无环，查询必须按 EconomicUnitId 和股东规范键稳定遍历。

集团内部单位仍各自满足工资、现金、债务、采购、收入、利润和股本不变量。集团汇总不得被用来掩盖单个 Unit 现金不足或无力偿债。

---

## 17. Scheduler 挂接点

端到端顺序只以 `economic_simulation_web_architecture.md` 的标准 Tick 为准。Economic Units 在以下阶段挂接：

| Scheduler 阶段 | Economic Units 读取                              | Economic Units 输出                              |
| -------------- | ------------------------------------------------ | ------------------------------------------------ |
| 1              | 已确认的创建、迁址、状态和股份交易 Command       | 原子状态变化与 Event                             |
| 3              | 价格、库存、资产、政策和上期经营结果             | 采购、生产、服务、销售和岗位计划                 |
| 5～9           | 已分配员工与投入、市场成交、运输和交付           | 产出、服务容量、库存变化、收入确认和资产 condition |
| 10a            | 本月就业、交付、维护、融资和税费                 | 工资、成本、利息、税费和债务 Ledger Transaction |
| 10b            | 已完成的本月 Ledger Transaction                  | 利润、亏损和更新后的留存收益                     |
| 10c            | 现金、到期义务、留存收益和股东名册               | 偿付能力结果、冻结的分红预算                     |
| 10d            | 冻结的预算与股东名册                             | 确定性分红 Transaction 和股东收入                |
| 11a            | 偿付能力与清算决定                               | 重组、经营权转让、清算或关闭结果                 |
| 12～14         | 最终权威状态                                     | 不变量报告、Metrics、历史、Event 和 UI Delta     |

本月收到的其他 Unit 分红可以进入本月投资收入，但不能增加 10c 已冻结的分红预算；最早在下月向上层股东继续分配。Economic Units 不自行调用市场、劳动力或 Statistics 阶段。

---

## 18. 破产、清算与关闭

### 18.1 偿付能力

以下情况触发偿付能力检查：

- 到期工资、税费、债务或已交付采购无法支付；
- 可用现金和已确认融资低于到期义务；
- 经营状态或事件明确要求破产审查。

Unit 首先进入 `insolvent`，停止分红和非必要投资。债权人与 Bankruptcy 模块决定重组或清算，不能由 Province 或 UI 直接删除。

### 18.2 清算顺序

V1 清算按 Accounting 规格执行，至少遵守：

```text
停止新经营计划
→ 处理员工和已签合同
→ 出售库存、设备和经营权
→ 收回应收并支付清算成本
→ 按债务优先级偿付债权人
→ 剩余价值按股份分配给股东
→ 注销全部流通股份
→ Unit 进入 closed
```

股东是剩余索取者，不能在债权人之前获得清算分配。资不抵债时股份可以归零，但历史 Share Position 和交易仍保留。

道路、铁路和港口清算时不得直接删除地图或 Transport Graph 资产。必须在同一原子批次中把经营权转让给其他 Unit、转让给 Government 持股的 Unit，或关闭对应服务容量。

---

## 19. Command、Event 与结构化错误

### 19.1 推荐 Command

```text
CreateEconomicUnit
ActivateEconomicUnit
SuspendEconomicUnit
RelocateEconomicUnit
IssueEconomicUnitShares
TransferEconomicUnitShares
UpdateDividendPolicy
DeclareUnitInsolvent
BeginUnitLiquidation
CloseEconomicUnit
```

玩家或 AI 不直接写状态；Command 必须校验 `expectedTick`、实体存在性、当前状态和资金/股份前置条件。

### 19.2 推荐 Event

```text
EconomicUnitFounded
EconomicUnitActivated
EconomicUnitSuspended
EconomicUnitRelocated
SharesIssued
SharesTransferred
EconomicUnitControllerChanged
EconomicUnitDividendPaid
EconomicUnitBecameInsolvent
EconomicUnitLiquidationStarted
EconomicUnitClosed
InfrastructureOperatorChanged
```

### 19.3 错误码

```text
ECONOMIC_UNIT_NOT_FOUND
ECONOMIC_UNIT_STATUS_INVALID
ECONOMIC_UNIT_COMPONENT_MISSING
ECONOMIC_UNIT_PROVINCE_INVALID
ECONOMIC_UNIT_MARKET_INVALID
EMPLOYER_ID_MISMATCH
SHAREHOLDER_NOT_FOUND
SHARE_COUNT_INVALID
INSUFFICIENT_SHARES
INSUFFICIENT_SUBSCRIPTION_CASH
EQUITY_OWNERSHIP_CYCLE
DIVIDEND_NOT_ALLOWED
DIVIDEND_LEDGER_MISMATCH
INFRASTRUCTURE_BINDING_INVALID
ECONOMIC_UNIT_INVARIANT_FAILED
STALE_QUERY_TICK
```

错误必须包含相关 Unit、股东、Tick、Command ID 和失败前置条件。多状态原子操作中任何一步失败都不得留下部分股份、现金、账户或组件变化。

---

## 20. Query、Metrics 与 Inspector

### 20.1 Summary View

```ts
interface EconomicUnitSummaryView {
  readonly economicUnitId: EconomicUnitId;
  readonly kind: EconomicUnitKind;
  readonly provinceId: ProvinceId;
  readonly industryId: IndustryId;
  readonly operatingStatus: EconomicUnitOperatingStatus;
  readonly directController: ShareholderRef | null;
  readonly employeeFte: number;
  readonly revenueCentsThisMonth: number;
  readonly expensesCentsThisMonth: number;
  readonly profitCentsThisMonth: number;
  readonly cashCents: number;
  readonly debtCents: number;
  readonly dividendPaidCentsThisMonth: number;
  readonly asOfTick: Tick;
}
```

### 20.2 推荐 Query

```text
getEconomicUnitSummary
getEconomicUnitOperations
getEconomicUnitEmployment
getEconomicUnitProcurement
getEconomicUnitSales
getEconomicUnitAccounts
getEconomicUnitShareholders
getShareholderHoldings
getEconomicUnitDividendHistory
getEconomicUnitTransactions
getEconomicUnitInfrastructure
getEnterpriseGroup
getEconomicUnitInvariantReport
```

股东、持股、交易、订单和历史必须分页。分页按稳定复合键排序并携带 `asOfTick`；后续页 Tick 不一致时返回 `STALE_QUERY_TICK`。

### 20.3 Metrics

以下均为派生数据：

- 产量、销量、服务容量和利用率；
- 员工数、空缺、工资成本和人均产出；
- 营业收入、成本、利润和利润率；
- 现金、债务、净资产和偿付能力指标；
- 采购满足率、库存周转和订单履约率；
- 分红、留存率和直接股东收益率；
- 道路、铁路、港口 condition、容量和使用率；
- Enterprise Group 合并前简单汇总与内部交易标记。

V1 的集团统计只做可解释汇总，不生成正式合并报表。内部交易必须标记，UI 不得把简单相加结果误称为消除内部交易后的集团利润。

---

## 21. 必须满足的不变量

### 21.1 身份、位置和生命周期

```text
每个 EconomicUnitId 唯一且不复用
每个非 closed Unit 指向存在的 Province、Industry 和同省默认 Market
foundedTick <= currentTick
已启用 Unit 具有 activatedTick，且 foundedTick <= activatedTick <= currentTick
closed Unit 具有 closedTick，其他状态不得具有 closedTick
closedTick 不早于 foundedTick 或 activatedTick
closed Unit 不得重新进入其他状态
```

### 21.2 组件与 Employer

```text
每个非 closed Unit 恰有一个符合 Kind 的主经营组件
每个真实 Unit 恰有一个 EmployerState 和 EquityState
EmployerId = EconomicUnitId
Employer Province 与 Unit Province 一致
closed Unit 的岗位需求和就业分配为 0
所有经营组件反向引用存在的 Unit
```

### 21.3 股本与持股

```text
非 closed Unit 的 totalSharesOutstanding 是正安全整数
closed Unit 的 totalSharesOutstanding = 0
每条 Share Position 的 sharesOwned 是正安全整数
同一 economicUnitId + shareholder 只有一条当前 Share Position
lastChangedTick <= currentTick
sum(unit Share Positions.sharesOwned) = totalSharesOutstanding
每个非 closed Unit 至少一个当前股东
closed Unit 没有当前 Share Position，但保留历史交易
所有 ShareholderRef 指向存在的投资账户、Unit 或 Government
closed Economic Unit 不得成为新的认购人或受让人
closed Economic Unit 不得出现在其他 Unit 的当前 Share Position 中
Economic Unit 持股图无环
所有权比例只从股份数派生
```

### 21.4 经营与会计

```text
工资成本 = 人口劳动收入 + 代扣与雇主项目
采购付款与卖方收入、商品或服务交付相匹配
商品销售数量不超过已分配库存
服务销售数量不超过当期可用容量
分红支付总额 = 所有股东分红收入之和
分红支付总额 <= maximumDividend
股东注资不计营业收入，分红不计经营费用
所有账户、库存、人数、股份和期间量为有限数
不允许为负的余额和数量 >= 0
```

### 21.5 基础设施

```text
road / railway 至少绑定一个有效 Transport Edge
port 至少绑定一个有效且同省 Transport Node
同一经营权资产最多绑定一个活动 Economic Unit
condition 位于 0～1
实际已售运输服务 <= condition 调整后的容量
关闭基础设施 Unit 时资产具有新运营者或明确的关闭状态
```

测试和调试构建每 Tick 执行完整检查。发行构建每 Tick 检查变化实体，并按配置周期执行全量审计；失败时停止推进并输出最小可重放信息。

---

## 22. 静态数据、存档与模块边界

### 22.1 静态数据

```text
economic-unit-kinds.json
industries.json
production-recipes.json
services.json
job-types.json
dividend-parameters.json
infrastructure-operation-types.json
```

加载时校验：

- Kind 与主经营组件矩阵完整；
- Industry、Commodity、Service、Recipe、Job Type 引用存在；
- 所有率和 condition 在 0～1；
- 数量、价格、容量和期间单位明确；
- 基础设施 Service 与 Transport Asset Kind 匹配；
- 初始 Unit、账户、股本、股东和组件一次性通过完整不变量检查。

### 22.2 存档内容

```text
EconomicUnitState[]
EconomicUnitEquityState[]
SharePositionState[]
各经营组件 State
Employer State 与就业分配
Inventory、Market、Transport 和 Ledger 权威状态
```

Metrics、集团树、控制方、Province/Shareholder 反向索引和 View Model 默认不存档；恢复后按稳定 ID 顺序重建。

### 22.3 模块所有权

Economic Units 协调通用身份、股权和月末结算，不复制各专门模块的算法或状态。

---

## 23. 自动测试与最小纵向场景

### 23.1 最小场景

```text
Province A
├── Capitalist Class Pool：持有总部 70%
├── Government A：持有总部 30%、道路 100%
├── Headquarters H
│   ├── 持有 Factory F 100%
│   └── 持有 Store S 80%
├── Factory F：采购原料，雇佣工人，生产商品
├── Store S：采购 Factory 商品，雇佣服务业人员，零售
└── Road R：采购维护，雇佣员工，向 Government 出售可用性服务

Province B
└── Port P：由 Headquarters H 持有 60%，出售装卸服务
```

运行两个月，验收：

1. 所有 Unit 拥有正股本、至少一个股东、独立账户和 Employer。
2. Factory 实际采购后生产，Store 实际收货后销售，不以计划量替代成交量。
3. 工资从各 Unit 支出并准确进入对应 Population Class 收入。
4. Road 在终端零收费时仍从 Government 可用性合同取得收入并支付维护。
5. Port 的实际装卸量不超过 condition 调整后的容量。
6. 月末利润、现金、税费和留存收益可以从 Ledger 对账。
7. 分红严格按股份数分配且整分余数确定性处理。
8. Headquarters 本月收到子单位分红，但最早下月才能继续向自身股东分配。
9. Enterprise Group 从持股图正确派生，不存在额外可修改的成员列表。

### 23.2 必测错误场景

- 创建无股东、零股份或组件缺失的 Unit 时整体失败；
- 增发已记股份但认购现金不足时整体回滚；
- 卖方股份不足的转让不改变现金或股东名册；
- Economic Unit 受让股份形成持股环时拒绝；
- Unit 现金或留存收益不足时分红降为合法上限或零；
- 股东数量和金额导致整分余数时支付总额仍严格守恒；
- 关闭仍有员工、库存、订单或基础设施经营权的 Unit 时拒绝；
- Road 维护不足后 condition 和容量下降，不凭预算自动修复；
- 快照恢复后股权图、控制方、分红和后续经营与连续运行一致。

### 23.3 长期与性能测试

- 固定种子运行至少 100,000 日 Tick，不出现 NaN、负股份或账目失衡；
- 标准规模 50,000 Unit、压力规模 200,000 Unit；
- 股东名册使用稀疏 Position，压力测试至少覆盖 2,000,000 条 Position；
- 每日经营只扫描活动 Unit 及其直接组件，不递归遍历集团；
- 月末分红复杂度为 `O(U + S)`，其中 U 为 Unit 数、S 为 Share Position 数；
- Province、股东、控制方和集团索引可全量重建并与增量结果一致；
- 不同输入插入顺序产生相同快照指纹和事件顺序。

---

## 24. 实施阶段

### Milestone 1：身份、位置、Employer 与生命周期

交付：

- Economic Unit 核心状态、Kind 和组件矩阵；
- Province、Market 和 Industry 引用校验；
- Unit 与 Employer 一对一接入；
- 创建、启用、暂停、迁址和关闭状态机；
- Summary Query 和基础不变量。

验收：工厂、商店和道路能够作为独立 Unit 创建，拥有合法 Province、账户引用和零或正岗位计划。

### Milestone 2：采购、生产、服务与销售

交付：

- Procurement Plan、Sales Plan 和 Market Order 接入；
- 商品库存、生产、零售和即时服务容量；
- Ledger 交付与收入确认；
- 工资和经营成本结算。

验收：Factory → Store → Population 的商品闭环和 Unit → Population 的工资闭环可对账。

### Milestone 3：股本、控制和分红

交付：

- 股东类型、股本和 Share Position；
- 现金增发、股份转让和无环校验；
- 控制方与 Enterprise Group 派生；
- 月末利润、分红预算、确定性分配和一个月传导滞后。

验收：总部控股多个跨省 Unit，所有股份、现金和分红交易守恒，快照回放一致。

### Milestone 4：基础设施、破产与性能

交付：

- 道路、铁路和港口经营组件；
- 运输服务、公共购买、维护与 condition；
- 偿付能力、清算和经营权转移；
- 完整 Inspector、历史、长时间与压力测试。

验收：基础设施既参与 Transport Graph，也作为有员工、有投入、有收入、有股东的 Unit 完成经营闭环；200,000 Unit 压力场景达到总体架构预算。

---

## 25. 后续升级条件

| 能力                           | 启用前必须解决的问题                            |
| ------------------------------ | ----------------------------------------------- |
| 多类别股份与优先权             | 投票、股息优先、清算顺序、稀释和 UI             |
| 证券交易所                     | 订单簿、流动性、估值、参与者和性能预算          |
| 债转股、可转债和期权           | 债务、股本和事件的原子转换                      |
| 循环或交叉持股                 | 控制权算法、集团合并、分红循环和估值            |
| 一个法人经营多个非独立地点     | 法人与地点双层模型、账目分摊、员工和破产边界    |
| 正式合并报表                   | 内部交易抵消、少数股东、商誉和会计口径          |
| 特许经营、公私合营和经营权到期 | 所有权与运营权分离、合同、补偿和资产接管        |
| 跨省单体线性基础设施           | 多省员工、税收、收入成本分摊和 Province Metrics |

只有当新增差异会产生玩家可观察的决策，且通过确定性、会计、存档和性能预算时才升级。

---

## 26. 最终实现原则

1. 每个 Economic Unit 都是独立经营、雇佣、会计和股权主体。
2. 工厂、商店、总部、道路和港口使用同一核心身份，通过专有经营组件表达差异。
3. 每个真实 Unit 就是一个 Employer，不创建并行雇主身份。
4. 每个非 `closed` Unit 都有正数普通股和至少一个股东；公共所有通过 Government 持股表达。
5. 公司集团只从股份控制关系派生，不保存第二份成员和所有权列表。
6. 采购计划、销售 Offer、产能和估值不是成交、现金或利润。
7. 商品使用库存和交付，服务使用期间容量；二者不能混用。
8. 工资、采购、销售、税费、债务、注资、股份转让和分红全部进入 Ledger。
9. 分红受留存收益、现金、义务和储备共同约束，并按股份确定性分配。
10. 基础设施必须有经营者、收入来源、维护投入和股东；免费使用不等于免费运营。
11. 所有生命周期和股权变化在 Tick 边界原子提交，失败不得留下部分状态。
12. 确定性、会计守恒、引用完整性和玩家可解释性优先于公司法与财务工程细节。
