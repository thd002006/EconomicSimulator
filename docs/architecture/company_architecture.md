# 经济模拟器公司系统实施规格

> 文档状态：可实施基线（Implementation Baseline）
> 适用版本：公司系统 V1
> 基础 Tick：1 日；公司结账、投资收益和分红按月结算
> 相关文档：`equity_architecture.md`、`operating_unit_architecture.md`、`province_architecture.md`、`economic_simulator_population_system.md`、`economic_simulation_web_architecture.md`
> 核心取舍：Company 是组织、融资、持股和资本配置主体；Operating Unit 是具体经营主体；每个活动公司必有且仅有一个总部经营单元

---

## 1. 已定决策

1. Company 是独立于 Operating Unit 的上层组织单位，拥有稳定 ID、独立账户、自己的股份和股东。
2. Company 不直接雇佣、采购原料、生产商品或向市场出售商品；这些行为必须通过它控制的 Operating Unit 完成。
3. Company 可以持有 Operating Unit 股份，也可以持有其他 Company 股份。Operating Unit 不能持有任何股份。
4. Company 持有某 Operating Unit 超过 50% 股份时直接控制它；普通经营单元也可以由 Population Class 或 Government 持有多数或全部股份。
5. 每个 `active` Company 必须有且只有一个 `headquarters` Operating Unit。总部是公司的附属物，由该公司持有 100%，不允许少数股东。
6. 公司本身不是 Employer。总部管理、财务、法务和行政人员受雇于 Headquarters Operating Unit。
7. 每个非 `closed` Company 都必须有正数普通股和至少一个股东。V1 只模拟一种同权普通股。
8. 公司股东可以是 Population Class 投资池、Government 或其他 Company；个人居民不直接登记。
9. 公司间直接控制由持股超过 50% 判定；Company Group 是公司控制图的派生读模型，不保存成员数组。
10. V1 禁止 Company 直接或间接持有自身股份，整个公司持股图必须无环。
11. Equity 是独立跨主体模块，不归 Company 所有；Population Class、Government 和 Company 作为股东共用同一登记与结算路径。
12. Company 与 Operating Unit 分别结账。跨层资金必须通过 Ledger 表现为注资、贷款、还款、利息、服务付款或分红。
13. 本月收到的分红最早下月进入本公司可分红预算，避免同月递归分红受结算顺序影响。
14. 公司创建、总部建立、股份发行或转让、控制变化、合并式收购和清算只在完整 Tick 边界原子提交。
15. Province 归属属于经营单元；Company 没有唯一 Province。公司注册国、总部所在地和经营范围是不同概念。

V1 明确不做：

- 自然人级证券账户；
- 优先股、期权、可转债、不同投票权和股东协议；
- 循环持股、交叉持股和一致行动人；
- 证券交易所订单簿和连续股价；
- 合并财务报表、商誉、少数股东损益和复杂税务；
- 没有总部的“纯持股壳公司”；
- 把品牌、集团、总部或经营单元当作 Company 的别名。

---

## 2. 概念边界

| 概念 | 回答的问题 | 是否雇佣 | 是否经营 | 是否持股 | 是否有自己的股东 |
| --- | --- | ---: | ---: | ---: | ---: |
| Company | 谁组织、融资、控制和配置资本 | 否 | 否 | 是 | 是 |
| Operating Unit | 在哪里由谁具体做什么生意 | 是 | 是 | 否 | 是 |
| Headquarters | 公司管理活动在哪里发生 | 是 | 是，提供管理服务 | 否 | 是，且公司持有 100% |
| Company Group | 哪些公司受同一最终控制 | 否 | 否 | 否 | 否，纯派生 |
| Brand | 市场展示使用什么身份 | 否 | 否 | 否 | 否 |

```text
Population Class / Government / Company
                 │ 持有 Company 股份
                 ▼
             Parent Company
              │          │
     持有 Company 股份   └──持有 Operating Unit 股份
              ▼                         ▼
       Subsidiary Company        Factory / Store / HQ
```

“Company 控制 Operating Unit”是直接关系；“母公司最终控制子公司的工厂”是从 Company→Company 与 Company→Operating Unit 两段权威股份派生的间接关系。

---

## 3. 权威数据与派生数据

### 3.1 四层数据

```text
Definition  公司类型、资本规划参数、允许的公司行动与默认策略
State       Company 身份、账户引用、总部引用和公司策略
Metrics     收入、费用、资产净值、控制范围、集团汇总和估值
View Model  公司摘要、持股树、股东名册、集团和历史分页
```

权威来源：

- `CompanyState`：公司身份、状态、注册国、总部引用和公司策略；
- 独立 Equity 模块：Company 与 Operating Unit 的股本和当前 Share Position；
- Ledger：现金、投资资产、债务、收入、费用和留存收益；
- `OperatingUnitState`：经营单元位置、状态和经营结果。

以下不得保存为第二份业务真相：

- `company.operatingUnitIds[]`；
- `company.subsidiaryCompanyIds[]`；
- `company.shareholders[]`；
- 手工维护的 Group 成员或最终控制人；
- 公司名下工厂、商店或省份计数；
- 总部员工和成本副本。

### 3.2 公共 ID

```ts
type CompanyId = string;
type OperatingUnitId = string;
type CountryId = string;
type ProvinceId = string;
type SocialClassId = string;
type LedgerAccountId = string;
type Tick = number;
```

所有 ID 稳定且不复用。显示名称可以改变，不参与引用和排序。

---

## 4. Company State

```ts
type CompanyStatus =
  | "active"
  | "insolvent"
  | "liquidating"
  | "closed";

interface CompanyState {
  readonly id: CompanyId;
  legalName: string;
  registrationCountryId: CountryId;
  status: CompanyStatus;
  readonly headquartersOperatingUnitId: OperatingUnitId;
  readonly foundedTick: Tick;
  closedTick: Tick | null;
  readonly accountRefs: CompanyAccountRefs;
  dividendPolicy: CompanyDividendPolicyState;
  capitalPolicy: CompanyCapitalPolicyState;
}

interface CompanyAccountRefs {
  readonly cash: LedgerAccountId;
  readonly receivables: LedgerAccountId;
  readonly payables: LedgerAccountId;
  readonly debt: LedgerAccountId;
  readonly investments: LedgerAccountId;
  readonly contributedCapital: LedgerAccountId;
  readonly retainedEarnings: LedgerAccountId;
}

interface CompanyDividendPolicyState {
  targetPayoutRate: number;
  minimumCashReserveCents: number;
}

interface CompanyCapitalPolicyState {
  minimumOwnershipForNewOperatingUnit: number;
  maximumDebtToEquity: number;
  headquartersFundingReserveCents: number;
}
```

V1 不保存 `public`、`private`、`holding` 等 Company Kind。公共或私人所有由 Equity 的实际股东表达，控股属性由实际持仓表达；没有产生不同业务规则前不增加分类状态。

`registrationCountryId` 决定公司法和公司税归属，不由总部 Province 自动覆盖。总部迁往外国不自动变更注册国，注册国变更必须是独立公司行动。

---

## 5. 总部

总部附属关系只由 Company 保存：

```text
CompanyState.headquartersOperatingUnitId
    └──► Headquarters Operating Unit
```

规则：

- `active`、`insolvent` 和 `liquidating` Company 恰有一个非 `closed` Headquarters；
- Headquarters 的 Kind 必须是 `headquarters`；
- Company 必须持有总部 100% 已发行股份；
- Headquarters 不得成为其他公司的总部；
- 总部不能通过普通经营单元关闭命令关闭；
- 总部迁址保持同一个 OperatingUnitId，或用原子替换命令同时创建新总部、切换引用、转移员工和资产、关闭旧总部；
- 公司清算期间总部继续处理清算工作，直到 Company 最终关闭。

总部可以向本公司或受控公司提供管理服务。为避免虚构利润，V1 推荐母公司直接拨款维持总部；若启用集团内管理服务费，必须按普通服务成交进入双方 Ledger，集团 Metrics 再进行内部交易标记，不能直接改写经营利润。

---

## 6. 独立 Equity 模块接口

股本、Share Position、发行、转让、股东名册冻结和确定性分配以 `equity_architecture.md` 为唯一规格。Equity 不归 Company 模块所有，因为 Population Class 和 Government 也是一等股东。

Company 模块只通过 Equity API：

```text
getShareholders({ kind: "company", companyId }, asOfTick)
getHoldings({ kind: "company", companyId }, asOfTick)
getMajorityShareholder(issuer, asOfTick)
IssueSharesCommand
TransferSharesCommand
AllocateDividendCommand
```

Company 负责判断资本计划、总部和公司状态是否合法；Equity 负责登记、通用守恒、无环检查和 Ledger 原子结算。任何一方校验失败，整个 World Command 回滚。

---

## 7. 创建、发行与股份转让

### 7.1 创建公司

`CreateCompany` 必须在一个原子批次中：

1. 创建 Company 和账户；
2. 发行正数 Company 普通股并建立至少一个 Share Position；
3. 把认购现金记入公司现金与实收资本；
4. 创建 Headquarters Operating Unit、Employer、账户和组件；
5. 由新 Company 认购总部 100% 股份并拨付总部初始资金；
6. 写入 Company 的总部引用；
7. 校验全部不变量后把 Company 切换为 `active`；
8. 产生 `CompanyFounded`、`OperatingUnitFounded` 和股份事件。

不允许先提交无股东公司或无总部活动公司，再等待未来 Tick 修复。

### 7.2 创建经营单元

Company 创建工厂、商店等经营单元时，必须提供初始资本、股份数和其他股东方案。若资本计划要求控制该 Unit，交易后 Company 持股必须超过 50%。创建命令不得直接写所有权索引；多数股东由 Share Position 派生。

### 7.3 增发

Company 提交 Equity 规格中的 `IssueSharesCommand`。公司模块校验状态和资本计划，Equity 校验登记、现金和股份守恒。Headquarters 增发只能由所属 Company 全额认购。

### 7.4 二级转让

Company 提交 Equity 规格中的 `TransferSharesCommand`。支付发生在买卖双方账户间，不改变发行主体现金或收入。涉及 Company 买入时由 Equity 执行无环检查。多数股东变化与股份交易在同一批次产生事件。

---

## 8. 控制、子公司与集团

直接持有超过 50% 已发行股份的单一股东是多数股东。只有多数股东 Kind 为 `company` 时，才存在直接控制 Company；Population Class 和 Government 可以直接成为普通 Operating Unit 的多数或唯一股东。

Company 可以没有上级控制 Company，此时它是独立顶层公司；若另一 Company 持股超过 50%，则成为其母公司。

```text
getDirectParentCompany(companyId)
getDirectSubsidiaryCompanies(companyId)
getDirectlyControlledOperatingUnits(companyId)
getCompanyGroup(companyId)
getUltimateShareholders(companyId)
```

Company Group 从 Company→Company 控制边派生。集团中的 Operating Unit 是各成员 Company 直接控制 Unit 的并集。集团树和最终股东只用于 Query、AI 低频决策和 Metrics，不得在每日经营热路径重复递归。

公司受让 Company 股份时，Equity 必须从目标公司沿持股边检查是否能到达买方，能到达则拒绝。V1 不尝试计算循环持股下的有效控制比例。

---

## 9. 资本配置与公司行为

Company 可以发出以下资本计划：

```ts
type CompanyCapitalAction =
  | FundHeadquartersAction
  | FoundOperatingUnitAction
  | CapitalizeOperatingUnitAction
  | LendToOperatingUnitAction
  | AcquireSharesAction
  | SellSharesAction
  | RepayCompanyDebtAction;
```

资本计划只是意图。执行必须检查公司现金、债务限制、目标状态和 Headquarters 约束，并由 Equity 检查持股无环和通用股权守恒，最后生成 Ledger 与 Equity 交易。

Company 不能直接支付某工厂员工工资或把商品放入市场。资金不足的受控 Operating Unit 只能通过新注资、股东贷款、外部融资、出售资产或缩减/退出经营解决。

公司可以跨 Province、跨 Country 控制经营单元。经营地域由当前受控 Unit 的 `provinceId` 聚合，不保存公司级固定经营 Province 列表。

---

## 10. 公司收入、费用与分红

公司层收入主要包括：

- Operating Unit 分红；
- 所持 Company 分红；
- 股权出售已实现损益；
- 公司层合同或金融收入（只有对应模块实际成交时）。

公司层费用主要包括利息、公司税、专业服务以及对总部的资金或管理服务采购。总部自身工资和办公室成本留在 Headquarters Ledger，不再重复记为公司员工成本。

公司月末可分配上限：

```text
earningsLimit = max(0, companyRetainedEarningsAfterClose)
cashLimit = max(0,
  companyCashAfterMandatoryPayments
  - minimumCashReserve
  - headquartersFundingReserve
  - committedPaymentsBeforeNextClose)
maximumDividend = min(earningsLimit, cashLimit)
targetDividend = floor(maximumDividend * targetPayoutRate)
```

公司分红按冻结股东名册和股份数确定性分配。`insolvent`、`liquidating`、`closed` Company 不得分红。10d 本月收到的任何分红不能增加同一 10d 已冻结的公司分红预算，最早下月向上游传导。

---

## 11. 注册国、总部位置与省份关系

Company 不直接属于 Province。三个概念必须分开：

```text
registrationCountryId                 公司法、公司税和注册监管
headquartersOperatingUnit.provinceId  总部员工、地方市场和空间位置
controlled Units 的 provinceId 集合   实际经营地域
```

省份转属：

- 不改变 Company 股份、公司注册国或控制关系；
- 不搬迁 Headquarters 或其他 Operating Unit；
- 更新总部和其他 Unit 当前所在 Country 的派生视图；
- 是否触发未来迁址、再注册或资产出售由公司 AI 在后续 Tick 决策。

---

## 12. 偿付能力、清算与关闭

Company 无法支付到期公司层义务时进入 `insolvent`。这不会自动使所有受控 Unit 破产；经营单元依据自己的现金和义务判断。反之，子 Unit 破产也不自动使 Company 破产，但会导致投资减值和分红减少。

公司清算顺序：

```text
冻结新投资和公司分红
→ 处置可出售的 Company / Operating Unit 股份
→ 偿还担保债权、税费和普通债权
→ 维持总部完成清算
→ 剩余价值按 Company 股份分配
→ 关闭总部并将 Company 标记 closed
```

出售受控 Operating Unit 股份可以使其多数股东变为另一 Company、Government、Population Class 或 `null`，但交易后仍须至少有一个合法股东。关闭 Company 前必须处置全部当前持股、债务、合同和非总部资产。

V1 不实现公司法律合并。所谓“收购”是股份转让并可能改变控制关系；CompanyId、历史和被收购公司自己的总部保持不变。

---

## 13. Scheduler 挂接点

标准顺序只以 `economic_simulation_web_architecture.md` 为准。

| 阶段 | Company 读取 | Company 输出 |
| --- | --- | --- |
| 1 | 已确认公司、总部和股份 Command | 原子 Company、Equity、总部引用和 Event 变化 |
| 3 | 现金、持股、上期结果与受控 Unit 计划 | 资本计划、总部资金和投资意图 |
| 10a | 公司层融资、合同、税费 | Ledger Transaction |
| 10b | 本月公司 Ledger | 公司利润、投资减值和留存收益 |
| 10c | 现金、义务、策略和冻结前股东名册 | 偿付能力和冻结分红预算 |
| 10d | 冻结预算与名册、下层分红 | 公司分红与股东收入；新收入留待下月再分配 |
| 11a | 偿付能力和控制关系 | 重组、资产出售、清算或关闭决定 |
| 13～14 | Company、Equity、Ledger 和 Unit 状态 | Metrics、历史和 UI Delta |

公司资本计划必须在对应经营阶段开始前冻结，不能在市场撮合中因临时结果反复改写。

---

## 14. Command、Event 与结构化错误

推荐 Command：

```text
CreateCompany
RenameCompany
ChangeCompanyRegistrationCountry
UpdateCompanyCapitalPolicy
UpdateCompanyDividendPolicy
RelocateCompanyHeadquarters
ReplaceCompanyHeadquarters
BeginCompanyLiquidation
CloseCompany
```

股份发行、转让和分红分配使用 Equity 规格中的 Command；公司行动可以在同一 World Command 中组合它们，但不能另定义公司专属版本。

推荐 Event：

```text
CompanyFounded
CompanyRenamed
CompanyRegistrationChanged
CompanyHeadquartersRelocated
CompanyHeadquartersReplaced
CompanyBecameInsolvent
CompanyLiquidationStarted
CompanyClosed
```

关键错误码：

```text
COMPANY_NOT_FOUND
INVALID_COMPANY_STATUS
INVALID_REGISTRATION_COUNTRY
HEADQUARTERS_REQUIRED
HEADQUARTERS_ALREADY_ASSIGNED
INVALID_HEADQUARTERS_KIND
HEADQUARTERS_NOT_FULLY_OWNED
INVALID_SHARE_ISSUER
INVALID_SHAREHOLDER
INVALID_SHARE_COUNT
INSUFFICIENT_SHARES
INSUFFICIENT_CASH
OWNERSHIP_CYCLE
COMPANY_HAS_OUTSTANDING_HOLDINGS
COMPANY_HAS_OUTSTANDING_OBLIGATIONS
STALE_QUERY_TICK
```

错误包含 `commandId`、相关主体 ID、Tick 和失败前置条件。任何多实体操作失败都不得留下部分公司、总部、股份或现金变化。

---

## 15. Query、索引与 View Model

```ts
interface CompanySummaryView {
  readonly companyId: CompanyId;
  readonly legalName: string;
  readonly status: CompanyStatus;
  readonly registrationCountryId: CountryId;
  readonly headquarters: {
    readonly operatingUnitId: OperatingUnitId;
    readonly provinceId: ProvinceId;
  };
  readonly directParentCompanyId: CompanyId | null;
  readonly directSubsidiaryCompanyCount: number;
  readonly directlyControlledOperatingUnitCount: number;
  readonly operatingProvinceCount: number;
  readonly employeeCount: number;
  readonly cashCents: number;
  readonly investmentBookValueCents: number;
  readonly dividendIncomeCentsThisMonth: number;
  readonly profitCentsThisMonth: number;
}
```

`employeeCount` 是受控 Operating Unit 员工的派生汇总，不表示 Company 是 Employer。

推荐 Query：

```text
getCompanySummary
getCompanyAccounts
getCompanyShareholders
getCompanyHoldings
getDirectlyControlledOperatingUnits
getDirectSubsidiaryCompanies
getCompanyGroup
getUltimateShareholders
getCompanyOwnershipHistory
getCompanyDividendHistory
getCompanyTransactions
getCompanyInvariantReport
```

Company 模块只维护自身状态所需的可重建反向索引：

```text
companyIdByHeadquartersOperatingUnit
companyIdsByRegistrationCountry
```

直接母公司、子公司、受控 Unit 和集团查询直接消费 Equity 的多数股东索引，不在 Company 保存第二份控制索引。索引不是权威状态。股东、持股、集团成员、交易和历史必须分页，使用 `asOfTick` 与稳定 Cursor。

---

## 16. 必须满足的不变量

```text
每个 CompanyId 唯一且不复用
每个非 closed Company 引用有效注册 Country 和账户
每个非 closed Company 的已发行股份为正且至少有一个股东
每个 active / insolvent / liquidating Company 恰有一个非 closed Headquarters
headquartersOperatingUnitId 指向合法 Headquarters，且该 Unit 由所属 Company 持有 100%
同一 Headquarters 不属于两个 Company
Company 不是 Employer，所有员工只属于 Operating Unit Employer
Operating Unit 不出现在 ShareholderRef 中
公司分红不超过现金和留存收益上限
closed Company 不持有股份、债务、合同或活动总部
Company 自有反向索引与 CompanyState 全量扫描一致
所有金额、数量、比例和 Metrics 有限且不为 NaN
```

股份总和、Position 唯一性、持股无环和分红支付守恒由 Equity 不变量报告负责；Company 不实现第二套审计。

---

## 17. 存档、回放与测试

存档包含：

```text
CompanyState[]
Company 事件历史或事件日志检查点
Ledger 权威状态
```

Equity State 和 Share Position 由独立 Equity 快照保存。集团树、最终控制人、公司估值、反向索引和 View Model 不存档。加载顺序为 Country 与静态定义 → Company 和账户 → Operating Unit → Equity → 总部引用与 100% 持股校验 → 全量不变量 → 重建索引。

最小纵向场景：

```text
Capitalist Class Pool ──70%──► Alpha Holdings
Government A ──────────30%──► Alpha Holdings

Alpha Holdings
├── HQ Alpha（100%）
├── Factory F（100%）
├── Store S（80%）
└── 60% Beta Logistics
      ├── HQ Beta（100%）
      └── Port P（100%）
```

必须验证：

1. 两家公司各自只有一个总部，所有经营人员属于各自 Unit Employer。
2. Alpha 直接控制 Factory、Store 和 Beta，间接控制 Port；派生集团不保存成员副本。
3. Store 少数股东分红与 Alpha 收入严格按股份分配。
4. Port 分红先进入 Beta，Beta 分红进入 Alpha，再进入 Alpha 股东；每层最多每月向上传导一次。
5. 试图让 Port 或 HQ 持股时被类型或命令校验拒绝。
6. Beta 受让 Alpha 股份形成循环时整个交易回滚。
7. Alpha 总部迁往另一 Province 后 CompanyId、注册国和持股不变。
8. Province 转属后所有 Company 和 Unit 股权不变，经营地域派生结果更新。
9. Company 破产不自动关闭健康 Unit；出售后新控制关系和现金同时生效。
10. 快照往返、固定命令回放和不同输入插入顺序得到相同状态指纹。

性能基线：标准规模 10,000、压力规模 50,000 Company；Equity Registry 压力测试至少 2,000,000 条 Position。每日资本规划只扫描活动 Company 及其直接持股，集团递归只在缓存失效、AI 低频决策或查询时执行。

---

## 18. 实施阶段

### Milestone 1：公司身份、账户与总部

- 实现 Company State、状态机和账户；
- 原子创建 Company、股份和 Headquarters；
- 实现总部引用唯一性、100% 持股和迁址规则。

验收：任何可观察 Tick 都不存在活动但无总部或双总部的 Company。

### Milestone 2：接入统一股权登记

- 接入 Equity 的两类 Share Issuer 和三类 Shareholder；
- 组合公司状态、资本计划与 Equity 发行/转让校验；
- 消费控制方、持股和股东名册查询，不复制 Position。

验收：Company 能持有 Unit 和其他 Company，账目与股份严格守恒。

### Milestone 3：控制、集团与资本配置

- 消费 Equity 的多数股东和无环持股结果；
- 实现创建 Unit、注资、股东贷款、收购和出售；
- 实现集团与最终股东派生 Query。

验收：跨省、跨层公司集团正确派生，任何失败交易均完整回滚。

### Milestone 4：结账、清算与性能

- 实现公司利润、分红上限和月度传导滞后；
- 实现公司偿付能力、持股处置和关闭；
- 完成 Inspector、历史、快照、回放和压力测试。

验收：50,000 Company、2,000,000 Position 场景达到总体架构预算。

---

## 19. 最终实现原则

1. Company 与 Operating Unit 是不同实体、不同账户、不同生命周期，不能共享身份。
2. Company 是唯一可作为资本投资者的企业实体；Operating Unit 永远不持股。
3. 每个活动 Company 必有且只有一个总部，总部永远是经营单元而不是公司本体。
4. Company 没有唯一 Province；注册国、总部位置和经营地域分别建模。
5. Company Group 只从 Company 持股控制关系派生。
6. 所有 Company 与 Operating Unit 股份共用独立 Equity 模块，Company 不保存专属股东名册。
7. 跨层资金必须有明确交易语义，集团现金不能掩盖单体偿付能力。
8. 分红逐层按月传导，避免同 Tick 递归和遍历顺序差异。
9. 所有创建、控制变化、总部替换和清算均原子提交。
10. 确定性、会计守恒、引用完整性和清晰玩家语义优先于现实公司法细节。
