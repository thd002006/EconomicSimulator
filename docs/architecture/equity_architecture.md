# 经济模拟器股权系统实施规格

> 文档状态：可实施基线（Implementation Baseline）
> 适用版本：股权系统 V1
> 相关文档：`company_architecture.md`、`operating_unit_architecture.md`、`economic_simulator_population_system.md`、`province_architecture.md`
> 核心取舍：Equity 是独立的跨主体登记与结算模块；Company 和 Operating Unit 是股份发行主体，Population Class、Government 和 Company 都可以成为股东

---

## 1. 已定决策

1. Equity 模块是股本、当前股东名册和股份变动的唯一权威来源，不归 Company、Population、Government 或 Operating Unit 任一模块所有。
2. V1 的股份发行主体有两类：Company 和 Operating Unit。
3. V1 的股东有三类：Population Class 投资池、Government 和 Company。Operating Unit 不能成为股东。
4. 每个非 `closed` 发行主体必须有正数已发行普通股和至少一个股东。
5. V1 只模拟一种同权普通股；股份数量使用正安全整数，所有权比例从股份数派生。
6. 股份发行、转让、注销、现金结算和事件必须在同一 Tick 边界原子提交。
7. Equity 负责登记事实与通用守恒；发行主体自己的合法性由 World API 调用对应领域校验器共同检查。
8. Population Class、Government 和 Company 分别拥有自己的投资账户；Equity 不复制它们的现金、财富或投资账面价值。
9. Company 可以持有 Company 和 Operating Unit 股份；Operating Unit 不得持股，从类型层阻止经营资金形成隐式集团。
10. Company 持有 Company 的图不得有直接或间接循环。
11. 股东名册在月末分红阶段开始时冻结；同阶段股份变化从下月分红生效。
12. 股权比例、控制方、集团、最终股东、估值和按 Province 的股东分布都是派生读模型。

V1 明确不做：

- 个人级证券账户；
- 优先股、不同投票权、期权、可转债和卖空；
- 证券交易所订单簿、连续报价和市值作为权威状态；
- 股东协议、一致行动人和复杂控制权推断；
- 循环或交叉持股；
- 把 Population 财富、Government 财政或 Company 投资账户复制到 Equity。

---

## 2. 模块边界

```text
Population ─────┐
Government ─────┼── ShareholderRef ──┐
Company ────────┘                     │
                                      ▼
                              Equity Registry
                                      ▲
Company ───────── ShareIssuerRef ─────┤
Operating Unit ── ShareIssuerRef ─────┘
                                      │
                                      ├── Ledger 原子结算
                                      └── 持股、比例和多数股东 View
```

Equity 模块负责：

- 发行主体股本；
- 当前 Share Position；
- 发行、转让、注销和历史事件；
- 股份数、现金和持仓通用守恒；
- 公司持股无环校验；
- 股东名册快照、规范排序和分页；
- 股东、发行主体和直接持有关系的可重建索引。

Equity 模块不负责：

- Population Class 的人数、财富和消费；
- Government 的预算、政策和财政；
- Company 的资本计划、总部、破产和集团策略；
- Operating Unit 的经营、利润和分红预算；
- 决定某次增发或收购是否符合领域政策。

领域规则由统一 World API 在提交前组合校验：

| 发行主体 | 额外约束的权威模块 |
| --- | --- |
| Company | Company：状态、公司行动权限和无自持规则 |
| 普通 Operating Unit | Operating Units：必须保留正股本和至少一个合法股东 |
| Headquarters | Company：所属 Company 必须持有 100% |
| Population Class 股东 | Population：投资账户和资产重分类合法性 |
| Government 股东 | Country / Fiscal：财政账户和授权 |
| Company 股东 | Company：现金、状态、授权和资本计划；持股无环由 Equity 统一校验 |

---

## 3. 权威类型

```ts
type CompanyId = string;
type OperatingUnitId = string;
type ProvinceId = string;
type SocialClassId = string;
type CountryId = string;
type Tick = number;

type ShareIssuerRef =
  | { readonly kind: "company"; readonly companyId: CompanyId }
  | { readonly kind: "operating_unit"; readonly operatingUnitId: OperatingUnitId };

type ShareholderRef =
  | {
      readonly kind: "population_class";
      readonly provinceId: ProvinceId;
      readonly socialClassId: SocialClassId;
    }
  | { readonly kind: "government"; readonly countryId: CountryId }
  | { readonly kind: "company"; readonly companyId: CompanyId };

interface EquityState {
  readonly issuer: ShareIssuerRef;
  totalSharesOutstanding: number;
}

interface SharePositionState {
  readonly issuer: ShareIssuerRef;
  readonly shareholder: ShareholderRef;
  sharesOwned: number;
  lastChangedTick: Tick;
}
```

权威键：

```text
issuerKey:
  company:<companyId>
  operating_unit:<operatingUnitId>

shareholderKey:
  population_class:<provinceId>:<socialClassId>
  government:<countryId>
  company:<companyId>

positionKey = issuerKey + "|" + shareholderKey
```

同一 `positionKey` 只有一条当前记录。零股份记录立即从当前表删除，历史事件保留。

```text
ownershipShare = sharesOwned / totalSharesOutstanding
```

不得保存可独立修改的所有权百分比。

---

## 4. 股东账户接口

Equity 通过只读接口解析认购、转让和分红使用的账户：

```ts
interface EquityAccountResolver {
  getCashAccount(shareholder: ShareholderRef): LedgerAccountId;
  getInvestmentAccount(shareholder: ShareholderRef): LedgerAccountId;
  getIssuerCashAccount(issuer: ShareIssuerRef): LedgerAccountId;
  getIssuerContributedCapitalAccount(issuer: ShareIssuerRef): LedgerAccountId;
  getIssuerRetainedEarningsAccount(issuer: ShareIssuerRef): LedgerAccountId;
}
```

解析器只返回账户 ID，不允许 Equity 直接修改其他模块状态。所有资金变化通过 Ledger Transaction 提交。

Population Class 的投资账户是按 `provinceId + socialClassId` 聚合的资产池。Class 流动、继承或迁移如果转移投资资产，Population 模块必须提交显式 `ReclassifySharePositionCommand`，同时转移股份和投资账面价值；不得仅改人口比例。

Government 使用财政模块的投资和现金账户。Company 使用公司层投资和现金账户。Operating Unit 没有投资账户解析分支。

---

## 5. Command 与原子提交

```ts
interface IssueSharesCommand {
  readonly kind: "issue-shares";
  readonly commandId: string;
  readonly issuer: ShareIssuerRef;
  readonly subscriber: ShareholderRef;
  readonly sharesToIssue: number;
  readonly totalSubscriptionPriceCents: number;
}

interface TransferSharesCommand {
  readonly kind: "transfer-shares";
  readonly commandId: string;
  readonly issuer: ShareIssuerRef;
  readonly seller: ShareholderRef;
  readonly buyer: ShareholderRef;
  readonly shares: number;
  readonly totalPriceCents: number;
}

interface ReclassifySharePositionCommand {
  readonly kind: "reclassify-share-position";
  readonly commandId: string;
  readonly issuer: ShareIssuerRef;
  readonly from: ShareholderRef;
  readonly to: ShareholderRef;
  readonly shares: number;
  readonly transferredBookValueCents: number;
  readonly reason: "class_mobility" | "migration" | "inheritance" | "government_reorganization";
}
```

重分类不是通用无偿转让：`class_mobility`、`migration`、`inheritance` 的 `from` 和 `to` 必须都是 `population_class`；`government_reorganization` 的两端必须都是 `government`。Company 永远不能参与重分类，只能通过发行或有对价转让改变持仓。

发行顺序：

```text
校验 issuer 与 subscriber
→ 校验认购现金和领域约束
→ 增加 totalSharesOutstanding
→ 增加 Share Position
→ 认购现金转入 issuer
→ 更新双方会计账户
→ 再次检查领域不变量
→ 提交 SharesIssued
```

二级转让不改变发行主体现金、收入或利润。买卖双方现金、投资账户、处置损益、股份和事件必须原子提交。交易价格只是本次事实，不成为权威估值。

重分类不产生市场成交和资本利得，只在领域事件确实转移投资资产时使用。股份和账面价值必须按同一规则同时转移。

V1 不提供任意 `SetOwnershipPercentage`、`SetShareholderList` 或直接写 Position 的接口。

---

## 6. 控制关系与领域约束

Equity 提供通用派生：

```ts
getOwnershipShare(issuer, shareholder, asOfTick)
getMajorityShareholder(issuer, asOfTick)
getShareholders(issuer, asOfTick)
getHoldings(shareholder, asOfTick)
```

`getMajorityShareholder` 在任一股东持股超过 50% 时返回该 `ShareholderRef`，否则返回 `null`。Company 模块只在返回 Kind 为 `company` 时派生直接控制 Company。

Company 和 Operating Unit 模块在 World API 提交时追加约束：

- 非 `closed` Operating Unit 必须有正股本和至少一个合法股东；
- Headquarters 必须只有一个股东，且是所属 Company，持股 100%；
- Company 可以没有多数 Company 股东，也可以被另一个 Company 控制；
- Company 不能直接或间接持有自身股份；
- `closed` 主体不能发行或受让新股份。

Company Group 由 Company 模块根据 Equity 的 Company→Company 多数持股边派生。Equity 只提供边和无环保证，不拥有集团业务语义。

---

## 7. 股东名册快照与分红接口

分红预算由发行主体模块计算：Operating Units 计算经营单元预算，Companies 计算公司预算。Equity 不决定是否分红，只负责按冻结名册确定性拆分已批准总额。

```ts
interface AllocateDividendCommand {
  readonly kind: "allocate-dividend";
  readonly commandId: string;
  readonly issuer: ShareIssuerRef;
  readonly totalDividendCents: number;
  readonly shareholderSnapshotTick: Tick;
}
```

```text
basePayment_i
= floor(totalDividend * sharesOwned_i / totalSharesOutstanding)
```

整分余数按 `shareholderKey` 升序逐分分配，直至支付总额等于批准总额。支付从发行主体留存收益和现金账户进入各股东现金/投资收入账户。

10d 开始后冻结名册。同阶段发行或转让从下月分红生效。Company 本月收到的分红最早下月再分配，防止公司链按遍历顺序递归支付。

---

## 8. Event、错误和 Query

推荐 Event：

```text
EquityCreated
SharesIssued
SharesTransferred
SharePositionReclassified
SharesCancelled
MajorityShareholderChanged
DividendAllocated
EquityClosed
```

关键错误码：

```text
ISSUER_NOT_FOUND
SHAREHOLDER_NOT_FOUND
INVALID_SHARE_ISSUER
INVALID_SHAREHOLDER_KIND
INVALID_SHARE_COUNT
INSUFFICIENT_SHARES
INSUFFICIENT_CASH
OWNERSHIP_CYCLE
DOMAIN_OWNERSHIP_CONSTRAINT_FAILED
STALE_SHAREHOLDER_SNAPSHOT
STALE_QUERY_TICK
```

推荐 Query：

```text
getEquity
getShareholders
getHoldings
getOwnershipShare
getMajorityShareholder
getOwnershipHistory
getDividendAllocation
getEquityInvariantReport
```

所有列表按规范键排序并分页，携带 `asOfTick`。后续页 Tick 变化返回 `STALE_QUERY_TICK`。

---

## 9. 索引、存档与 Scheduler

可重建索引：

```text
sharePositionsByIssuer
sharePositionsByShareholder
majorityShareholderByIssuer
companyOwnershipEdges
```

索引不是权威业务状态。存档只包含 `EquityState[]`、`SharePositionState[]` 和必要事件/交易历史；控制方、集团、最终股东、比例和估值在恢复后重建。

Scheduler 挂接：

| 阶段 | 行为 |
| --- | --- |
| 1 | 原子应用已确认发行、转让、重分类和公司行动中的股权变化 |
| 3 | 向 Company AI 和 Operating Unit 计划提供冻结持股视图 |
| 10c | 为每个发行主体冻结股东名册 |
| 10d | 按已批准预算分配分红并写 Ledger |
| 11a | 应用清算中的股份注销或资产处置 |
| 13～14 | 重建 Metrics、历史采样、索引审计和 UI Delta |

标准端到端顺序仍以总体架构为准。

---

## 10. 不变量与测试

```text
每个 issuer 只有一条 EquityState
每个非 closed issuer 的 totalSharesOutstanding 为正
同一 issuer + shareholder 只有一条当前 Share Position
每条当前 Position 的 sharesOwned 为正安全整数
每个 issuer 的 Position 股份总和等于 totalSharesOutstanding
每个 ShareholderRef 指向存在且允许持股的主体
Operating Unit 永不作为 shareholder
Company 持股图无环
发行与转让的股份、现金和 Ledger 交易守恒
分红支出总额等于所有股东收入总额
所有比例仅派生且位于 0～1
所有索引与权威 Position 全量扫描一致
```

最小场景同时包含 Population Class、Government 和 Company 三种股东，并覆盖 Company 与 Operating Unit 两种 issuer：

```text
Capitalist Class Pool ──70%──► Alpha Company
Government A ──────────30%──► Alpha Company
Alpha Company ────────100%──► Alpha Headquarters
Alpha Company ─────────80%──► Store S
Worker Class Pool ──────20%──► Store S
Alpha Company ─────────60%──► Beta Company
```

必须验证三类股东认购、转让、重分类和分红；Operating Unit 持股被拒绝；公司循环持股被拒绝；总部稀释被拒绝；转让控制权失败时股份和现金完整回滚；快照往返和不同插入顺序结果一致。

性能基线为 2,000,000 条当前 Share Position。月末名册冻结和分红复杂度为 `O(I + S)`，其中 I 为发行主体数、S 为 Position 数；单主体查询只扫描该 issuer 索引。

---

## 11. 实施阶段

1. 实现 tagged issuer/shareholder、股本、Position、规范键和不变量。
2. 接入三类股东账户解析与两类发行主体校验。
3. 实现发行、转让、重分类、无环检查和原子 Ledger。
4. 实现冻结名册、确定性分红、分页 Query、快照和压力测试。

验收标准：任何模块都不能绕过 Equity API 修改股份；Population、Government 与 Company 作为股东使用同一登记和结算路径，不出现公司系统专属的第二套股东名册。
