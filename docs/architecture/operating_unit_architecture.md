# 经济模拟器经营单元系统实施规格

> 文档状态：可实施基线（Implementation Baseline）
> 适用版本：经营单元系统 V1
> 基础 Tick：1 日；工资、利润、税费和分红按月结算
> 相关文档：`equity_architecture.md`、`company_architecture.md`、`province_architecture.md`、`economic_simulator_population_system.md`、`economic_simulation_web_architecture.md`
> 核心取舍：经营单元负责具体经营，公司负责组织、持股和资本配置；二者分别拥有账户和生命周期

---

## 1. 名称与已定决策

本文使用“经营单元”（Operating Unit），不再使用“经济单位”（Economic Unit）。后者容易与公司、家庭、政府等广义经济主体混淆；“经营单元”更准确地表达“在一个地点实际雇佣、采购、生产或提供服务并销售”的对象。

V1 采用以下设计：

1. Operating Unit 是经济活动的最小独立经营与结算单位，包括工厂、农场、商店、服务机构、仓库、道路、铁路、港口、公用事业、政府服务设施和总部。
2. Company 是上层组织、融资和持股主体，不是 Employer，也不直接生产或销售。公司规则以 `company_architecture.md` 为准。
3. 每个非 `closed` Operating Unit 必须有至少一个股东；Company、Population Class 投资池或 Government 都可以成为多数、少数或唯一股东。
4. Operating Unit 可以被持股，但不能持有任何 Operating Unit 或 Company 股份。所有公司间持股和集团关系发生在 Company 层。
5. 每个 Operating Unit 拥有稳定 ID、一个 Province、独立账户、一个 Employer 身份、独立经营组件、独立利润和分红能力。
6. `EmployerId = OperatingUnitId`，不建立第二套雇主身份；公司员工实际受雇于其总部或其他经营单元。
7. 工资、采购、销售、维护、税费、债务、公司注资和分红必须进入统一 Ledger。
8. 商品进入 Inventory；即时服务和运输能力按期间出售，不创建虚假库存。
9. 道路、铁路和港口也是经营单元：它们雇佣人员、购买维护投入、出售服务并结算损益。免费通行时必须有 Government 等明确付款方购买可用性服务。
10. 每个 Operating Unit 只能属于一个 Province。跨省道路或铁路在省界处分段为多个经营单元，并由 Transport Graph 连接。
11. 总部是 `headquarters` Kind 的经营单元，是对应公司的必需附属物；总部不持股，公司才持股。
12. 计划、报价、产能、利润率、估值和汇总均不是权威交易事实。

V1 明确不做：

- 让 Operating Unit 持有证券或派生集团；
- 把公司与总部合并成同一个 ID；
- 一个跨省经营单元同时归属多个 Province；
- 没有账户、Employer 或合法股东的“轻量经营点”；
- 证券交易所、复杂股份类别和公司法细节；
- 将计划采购、计划产量或挂牌销售额视为已实现交易。

---

## 2. 公司与经营单元的边界

```text
Company（组织与资本层）
├── 必有一个 Headquarters Operating Unit
├── 可控制零到多个 Factory / Store / Port / ...
├── 可持有其他 Company 股份
└── 接收投资收益、配置资本、承担公司层融资并向自身股东分红

Operating Unit（地点与经营层）
├── 位于一个 Province
├── 是一个 Employer
├── 采购投入、组织生产或服务、形成销售
├── 持有库存或经营基础设施
└── 独立结账，并按股权向股东分红
```

同一公司的多个经营单元不能共享一个可任意透支的现金余额。资金从 Company 到 Operating Unit 必须表现为注资、股东借款、采购或服务付款；经营单元向 Company 回流资金表现为还款、利息或分红。这样单个工厂或商店的偿付能力仍可解释。

总部也是经营单元，因此管理人员、办公室费用和管理服务收入都落在总部账目中。`CompanyState` 只保存公司层资金、投资和义务，不复制总部员工或运营成本。

---

## 3. 系统闭环与模块边界

```text
Company Capital Plan
        │ 注资 / 贷款
        ▼
Operating Unit ──岗位计划──► Labor Market
        │                         │
        ├──采购订单─────────► Markets / Transport
        │                         │
        ├──生产 / 零售 / 服务 ◄──员工与已交付投入
        │
        ├──销售 Offer────────► Markets
        │                         │
        └──月末结账 ◄────────成交、交付与 Ledger
                │
                └──分红──────► Shareholders
```

经营单元模块负责：

- 身份、Kind、Province、生命周期和通用引用；
- Employer 一对一接入；
- 通用采购、产出、服务和销售计划契约；
- 各专有经营组件的完整性校验；
- 月末经营结账、偿付能力状态和分红预算；
- 按 Province、Kind、Industry 和状态建立可重建索引。

经营单元模块不负责：

- Company 的身份、股权投资、集团、总部唯一性或资本计划；
- 权威股份和股东名册；
- 劳动力匹配、市场撮合、运输寻路和生产配方算法；
- Population Class 财富分配或 Country 政策；
- Province、Company 或集团最终统计口径。

---

## 4. ID、Definition 与权威状态

### 4.1 公共 ID

```ts
type OperatingUnitId = string;
type ProvinceId = string;
type IndustryId = string;
type MarketId = string;
type LedgerAccountId = string;
type Tick = number;
```

所有 ID 全局稳定且不复用。跨模块只传 ID，不持有可变对象引用。

### 4.2 Kind 与状态

```ts
type OperatingUnitKind =
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

type OperatingUnitOperatingStatus =
  | "planned"
  | "under_construction"
  | "active"
  | "suspended"
  | "insolvent"
  | "liquidating"
  | "closed";
```

### 4.3 Definition

```ts
interface OperatingUnitKindDefinition {
  readonly kind: OperatingUnitKind;
  readonly requiredComponentKind: OperatingComponentKind;
  readonly permitsInventory: boolean;
  readonly permitsRelocation: boolean;
  readonly offeredCommodityOrServiceIds: readonly string[];
}
```

Definition 描述种类规则，不保存某个实例的产量、员工、现金或股东。

### 4.4 State

```ts
interface OperatingUnitState {
  readonly id: OperatingUnitId;
  readonly kind: OperatingUnitKind;
  provinceId: ProvinceId;
  industryId: IndustryId;
  defaultMarketId: MarketId;
  operatingStatus: OperatingUnitOperatingStatus;
  readonly foundedTick: Tick;
  activatedTick: Tick | null;
  closedTick: Tick | null;
  readonly accountRefs: OperatingUnitAccountRefs;
  dividendPolicy: OperatingUnitDividendPolicyState;
}

interface OperatingUnitAccountRefs {
  readonly cash: LedgerAccountId;
  readonly receivables: LedgerAccountId;
  readonly payables: LedgerAccountId;
  readonly debt: LedgerAccountId;
  readonly inventory: LedgerAccountId;
  readonly fixedAssets: LedgerAccountId;
  readonly accumulatedDepreciation: LedgerAccountId;
  readonly contributedCapital: LedgerAccountId;
  readonly retainedEarnings: LedgerAccountId;
}

interface OperatingUnitDividendPolicyState {
  targetPayoutRate: number;
  minimumCashReserveCents: number;
}
```

`OperatingUnitState` 不保存 `companyId` 或所有者字段。多数股东和持股比例从独立 Equity 模块的权威 Share Position 派生；没有任何股东超过 50% 时，多数股东为 `null`。

---

## 5. 经营组件

每个经营单元恰有一个主经营组件：

| Kind | 主经营组件 | 主要行为 |
| --- | --- | --- |
| factory | `ProductionSiteState` | 采购原料并按配方生产商品 |
| farm | `ProductionSiteState` | 使用土地、劳动力和投入生产农产品 |
| store | `RetailSiteState` | 补货并向本地需求销售商品 |
| service_business | `ServiceSiteState` | 出售不可库存的期间服务容量 |
| headquarters | `HeadquartersSiteState` | 为所属公司提供管理与共享服务 |
| warehouse | `WarehouseSiteState` | 提供库存空间和装卸服务 |
| road / railway / port | `InfrastructureOperatorState` | 运营 Transport Asset 并出售运输服务 |
| utility | `UtilitySiteState` | 生产并输送公用服务 |
| government_service | `GovernmentServiceSiteState` | 履行政府采购的公共服务 |

组件由对应业务模块持有，核心状态只保存引用。禁止把专有库存、配方、Transport Edge、零售规则全部塞进 `OperatingUnitState`。

```ts
interface HeadquartersSiteState {
  readonly operatingUnitId: OperatingUnitId;
  managementServiceIds: readonly string[];
}
```

总部附属关系只由 `CompanyState.headquartersOperatingUnitId` 表达；`HeadquartersSiteState` 不反向保存 `companyId`。所属 Company 可由该字段建立的反向索引查询。

---

## 6. Employer、岗位与工资

```ts
type EmployerId = OperatingUnitId;
```

每个 Operating Unit 恰对应一个 Employer。Province 和 Kind 从经营单元解析，不另存可独立修改的副本。经营单元根据经营计划和支付能力生成下一月岗位需求；人口模块执行匹配、招聘和就业分配。

经营单元不得直接修改 `PopulationClassState`。工资必须从经营单元现金或应付账户支付并写入 Ledger；现金不足时进入欠薪、缩减岗位或破产流程，不得凭空发薪。

公司层管理人员也在 Headquarters Operating Unit 任职。Company 本身不能出现在 `EmploymentAllocationState.employerId` 中。

---

## 7. 采购、生产与销售

```ts
interface OperatingUnitProcurementPlan {
  readonly operatingUnitId: OperatingUnitId;
  readonly marketId: MarketId;
  readonly lines: readonly ProcurementPlanLine[];
  readonly planTick: Tick;
}

interface OperatingUnitSalesPlan {
  readonly operatingUnitId: OperatingUnitId;
  readonly marketId: MarketId;
  readonly lines: readonly SalesPlanLine[];
  readonly planTick: Tick;
}
```

采购计划只生成订单上限。只有市场成交、运输完成和验收后，才形成库存、费用、应付或现金交易。生产只能消耗已到货库存和已分配劳动力；销售只能确认已交付商品或服务。

商品产出进入 Inventory。零售库存属于 Store，不与 Factory 库存合并。服务使用“期间容量、已售容量、实际交付量”，期间结束后未售容量归零，不能结转为库存。

---

## 8. 道路、铁路和港口

```ts
interface InfrastructureOperatorState {
  readonly operatingUnitId: OperatingUnitId;
  readonly assetRefs: readonly TransportAssetRef[];
  pricingMode: "user_fee" | "contracted_availability" | "mixed";
}
```

Transport Asset Definition 是几何和设计容量的唯一来源。实际容量由 Transport 模块根据 `designCapacity × condition × staffingFactor × availabilityFactor` 派生；经营单元不保存第二个容量上限。

基础设施可以向使用者收费，也可以由 Government 购买可用性服务后免费开放。两种方式都必须形成收入和付款交易。维护不足会降低 condition 和可用容量；预算本身不等于已交付维护。

同一经营权资产最多绑定一个活动 Operating Unit。经营者破产不会删除地图几何；必须把经营权转给另一个经营单元、交由政府控制的公司接管，或明确关闭容量。

---

## 9. 股权与多数股东接口

Operating Unit 是股份发行主体，但股本、Share Position、交易和多数股东关系由独立 `equity_architecture.md` 定义和持有。经营单元模块只读取：

```ts
getOperatingUnitShareholders(operatingUnitId, asOfTick)
getMajorityShareholder(operatingUnitId, asOfTick)
getOperatingUnitOwnershipHistory(operatingUnitId)
```

规则如下：

- 非 `closed` Operating Unit 的已发行股份为正且至少有一个股东；
- 多数股东可以是 Company、Population Class、Government 或 `null`；
- Operating Unit 不属于 `ShareholderRef` 的合法 Kind；
- Headquarters 必须由其所属 Company 持有 100%；
- 股份发行、转让、现金和控制方事件在同一原子批次提交；
- 转让价格不是经营单元收入，也不自动成为全部股份估值；
- Province 转属不改变经营单元股权或多数股东。

经营单元不得保存可修改的 `ownerCompanyId`、股东数组或集团成员数组。

---

## 10. 结账、利润与分红

月度结账只读取已完成 Ledger Transaction：

```text
Operating Revenue
- Delivered Input and Service Expense
- Wage and Employer Cost
- Maintenance and Depreciation
- Interest Expense
- Taxes
= Accounting Profit Before Distribution
```

股东注资不是收入，借款不是收入，还本不是费用，股份转让不是被投资经营单元的交易，分红不是经营费用。亏损减少留存收益；负利润本身不立即等于破产。

可分配上限：

```text
earningsLimit = max(0, retainedEarningsAfterClose)
cashLimit = max(0,
  cashAfterMandatoryPayments
  - minimumCashReserve
  - committedPaymentsBeforeNextClose)
maximumDividend = min(earningsLimit, cashLimit)
targetDividend = floor(maximumDividend * targetPayoutRate)
```

`insolvent`、`liquidating` 或 `closed` 的经营单元不得分红。分红使用 10d 阶段开始时冻结的股东名册，按股份数确定性分配；整分余数按股东规范键升序逐分分配。

公司本月收到的经营单元分红可以记为投资收入，但不得增加公司本月已经冻结的分红预算，最早下月向公司股东继续分配。这一月滞后消除结算顺序依赖。

---

## 11. 生命周期、迁址与破产

```text
planned → under_construction → active ↔ suspended
                                    │
                                    └→ insolvent → liquidating → closed
```

迁址是同一 Operating Unit 的 Province 变化，只允许 Kind Definition 明确许可的种类。工厂、港口、道路等固定资产通常应关闭旧单元并创建新单元；商店、服务机构或总部可以在原子命令中迁址。

关闭前必须处理员工、库存、未结订单、债务、资产和经营权。清算顺序为担保债权、员工欠薪、税费、普通债权，剩余价值最后按股份分配。清算完成后股份可归零并关闭；历史股权和交易继续保留。

总部不得单独关闭。总部迁址或替换必须由公司命令原子提交，确保活动 Company 在任何可观察 Tick 上都有且仅有一个合法 Headquarters。

---

## 12. Command、Event 与错误

推荐 Command：

```text
CreateOperatingUnit
ActivateOperatingUnit
SuspendOperatingUnit
RelocateOperatingUnit
UpdateOperatingPlan
UpdateOperatingUnitDividendPolicy
BeginOperatingUnitLiquidation
CloseOperatingUnit
```

创建命令必须提供至少一个初始股东和初始股权方案，并由 Operating Units、相关股东领域与 Equity 模块原子校验和提交。股份发行与转让命令定义在 Equity 规格中，不能直接修改经营单元股东名册。

推荐 Event：

```text
OperatingUnitFounded
OperatingUnitActivated
OperatingUnitSuspended
OperatingUnitRelocated
OperatingUnitBecameInsolvent
OperatingUnitLiquidationStarted
OperatingUnitClosed
```

关键错误码：

```text
OPERATING_UNIT_NOT_FOUND
INVALID_OPERATING_UNIT_STATUS
INVALID_PROVINCE_REFERENCE
MISSING_REQUIRED_COMPONENT
INVALID_INITIAL_SHAREHOLDER
HEADQUARTERS_REQUIRES_COMPANY_COMMAND
OUTSTANDING_EMPLOYMENT
OUTSTANDING_ORDERS
OUTSTANDING_INFRASTRUCTURE_RIGHT
INSUFFICIENT_CASH
INSUFFICIENT_RETAINED_EARNINGS
STALE_QUERY_TICK
```

失败命令不得留下部分账户、组件、股权或现金变化。

---

## 13. Scheduler 挂接点

端到端顺序只以 `economic_simulation_web_architecture.md` 的标准 Tick 为准。

| 阶段 | 读取 | 输出 |
| --- | --- | --- |
| 1 | 已确认创建、迁址和状态命令 | 原子状态变化、索引更新和 Event |
| 3 | 公司资本计划、价格、库存、资产和上期结果 | 岗位、采购、生产、服务和销售计划 |
| 5～9 | 已分配员工、成交、运输和交付 | 产出、服务、库存、收入和 condition 变化 |
| 10a | 本月就业、交付、融资和税费 | 工资、成本、利息、税费和债务交易 |
| 10b | 本月 Ledger | 利润、亏损和留存收益 |
| 10c | 现金、到期义务和股权快照 | 偿付能力与冻结分红预算 |
| 10d | 冻结预算和股东名册 | 分红交易与股东收入 |
| 11a | 偿付能力与清算决定 | 重组、经营权转让、清算或关闭 |
| 13～14 | 权威状态与交易 | Metrics、历史采样和 UI Delta |

经营单元模块不得自行调用其他阶段，也不得修改标准顺序。

---

## 14. Query、索引与 View Model

```ts
interface OperatingUnitSummaryView {
  readonly operatingUnitId: OperatingUnitId;
  readonly kind: OperatingUnitKind;
  readonly provinceId: ProvinceId;
  readonly majorityShareholder: ShareholderRef | null;
  readonly industryId: IndustryId;
  readonly operatingStatus: OperatingUnitOperatingStatus;
  readonly employeeCount: number;
  readonly revenueCentsThisMonth: number;
  readonly profitCentsThisMonth: number;
  readonly cashCents: number;
  readonly capacityUtilization: number | null;
}
```

推荐 Query：

```text
getOperatingUnitSummary
getOperatingUnitOperations
getOperatingUnitEmployment
getOperatingUnitProcurement
getOperatingUnitSales
getOperatingUnitAccounts
getOperatingUnitShareholders
getOperatingUnitDividendHistory
getOperatingUnitInfrastructure
getOperatingUnitInvariantReport
```

可重建索引：

```text
operatingUnitIdsByProvince
operatingUnitIdsByKind
operatingUnitIdsByIndustry
operatingUnitIdsByStatus
```

索引不是业务真相，不进入事件语义；恢复后按稳定 ID 重建。列表查询使用 `asOfTick`、稳定复合排序和 Cursor，Tick 不一致返回 `STALE_QUERY_TICK`。

---

## 15. 必须满足的不变量

```text
每个 OperatingUnitId 唯一且不复用
每个非 closed Operating Unit 引用有效 Province、Market、Industry 和账户
每个 Operating Unit 恰有一个 Employer，且 EmployerId = OperatingUnitId
每个 Unit 恰有一个符合 Kind 的主经营组件
每个非 closed Unit 有正股本和至少一个有效股东
Operating Unit 从不作为任何股份的 shareholder
每个 Headquarters 最多被一个 Company.headquartersOperatingUnitId 引用
Headquarters 由该 Company 持有 100%
active Unit 不得缺少必需员工、许可或经营权条件
销售量不超过已交付商品或服务容量
基础设施实际流量不超过派生可用容量
同一经营权资产最多绑定一个活动 Unit
分红不超过现金和留存收益上限
分红支付总额等于股东收入总额
所有金额、数量、比例和指标有限且不为 NaN
所有可重建索引与权威状态全量扫描一致
```

---

## 16. 存档、确定性与测试

存档包含 `OperatingUnitState[]`、各经营组件、Employer、Inventory、Transport 和 Ledger 的权威状态。股份由 Equity 模块存档，公司和总部关系由 Company 模块存档。Metrics、Summary、多数股东索引和分页缓存不存档。

最小纵向场景：

```text
Company Alpha
├── Headquarters H（Province A）
├── Factory F（Province A）
├── Store S（Province A）
└── Port P（Province B）

Public Infrastructure Company
└── Road R（Province A，Government 购买可用性服务）
```

必须验证：

1. 每个活动 Unit 有账户、Employer、主组件和至少一个合法股东。
2. Factory 实际收料后生产，Store 实际收货后销售，计划量不冒充成交量。
3. 工资、采购、销售、税费和分红能从 Ledger 对账。
4. Road 终端零收费时仍有合同收入、维护投入和可解释亏损。
5. Port 的流量不超过 condition 调整后的容量。
6. Unit 分红进入 Company 后最早下月继续向上分配。
7. Company、Government、Population 或 Province 变化后所有索引能重建且与增量结果一致。
8. 总部迁址在任何 Tick 都不产生无总部或双总部公司。
9. 快照往返、固定命令回放和不同输入插入顺序得到相同结果。

性能基线：标准规模 50,000、压力规模 200,000 Operating Unit；每日只扫描活动 Unit 及直接组件，分页只扫描命中索引，Tick 末聚合满足总体架构预算。

---

## 17. 实施阶段

### Milestone 1：身份、位置、Employer 与组件

- 实现核心 State、Kind、引用校验和状态机；
- 接入 Province、Market、Industry 和 Employer；
- 为每个 Kind 建立唯一主组件约束。

验收：工厂、商店、总部和道路可创建并通过不变量检查。

### Milestone 2：经营闭环

- 接入采购、生产、服务、销售、库存和运输；
- 完成工资、成本、收入与月末利润结算；
- 验证商品与即时服务使用不同交付语义。

验收：Factory → Store → Population 和 Unit → Population 工资闭环可对账。

### Milestone 3：公司与股权接入

- 接入独立 Equity 模块的多数股东与股东名册查询；
- 实现 Company 创建 Unit、注资、融资与接收分红；
- 实现 Headquarters 唯一性和原子迁址。

验收：Company 跨省持有 Unit，Government 独资 Road，Population Class 共同持有 Store；持股、现金和分红一致。

### Milestone 4：基础设施、破产与性能

- 完成道路、铁路、港口经营和维护；
- 完成清算、关闭和经营权转移；
- 完成 Inspector、历史、回放和压力测试。

验收：200,000 Unit 场景达到总体性能预算，所有索引与全量扫描一致。

---

## 18. 最终实现原则

1. 公司回答“谁组织、控制和配置资本”，经营单元回答“在哪里、由谁工作、做什么生意”。
2. 经营单元有自己的经营账目和股东；Company、Population Class 与 Government 是平等的合法股东，经营单元本身不能持股。
3. 总部是公司必需的经营附属物，不是公司本身，也不是控股代理。
4. 所有真实经营单元都是 Employer；公司不是 Employer。
5. 商品使用库存和交付，服务使用期间容量。
6. 基础设施必须有经营者、收入来源、维护投入和合法股东。
7. 股权只有一个独立权威 Equity 模块，所有者数组、集团树和反向索引均为派生数据。
8. 生命周期和跨模块资金变化在 Tick 边界原子提交。
9. 确定性、会计守恒、引用完整性和玩家可解释性优先于公司法细节。
