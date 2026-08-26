# 经济模拟器人口、劳动力与社会阶层系统实施规格

> 文档状态：可实施基线（Implementation Baseline）  
> 适用版本：人口系统 V1  
> 基础 Tick：1 日；劳动力、工资、人口和阶层按月更新  
> 相关文档：`province_architecture.md`、`economic_unit_architecture.md`  
> 核心取舍：优先保证玩法可解释、状态可对账和性能稳定，不追求微观人口统计精度

---

## 1. 已定决策

V1 采用以下设计：

1. 省份是人口、劳动力和本地招聘的基本地理单位。
2. 每个省份最多保存 11 个 PopulationClassState，不创建 Population Cohort。
3. Social Class 是玩家可理解、会缓慢变化的社会经济群体，也是人口系统的聚合计算单元。
4. 年龄、教育、技能、就业、财富、民族和信仰以 Class 内部的计数分布保存，不按属性组合拆分人口对象。
5. 需要“大学学历且高技能且正在求职”的人数时，使用 Class 内边际分布乘法估算。
6. 边际分布乘法表示 Class 内属性近似独立。这是明确接受的游戏简化，不是统计事实声明。
7. 工厂、农场、商店、总部、道路和港口等真实 Economic Unit 都是一对一 Employer；Employer 发布岗位，不直接拥有人口。
8. 招聘结果记录在 EmploymentAllocationState；职业变化不创建新人口对象。
9. 收入是交易产生的期间流量和派生统计；财富是需要存档和对账的资产负债存量。
10. 人口、就业、岗位、资产和资金必须满足守恒检查；百分比只用于显示和计算，不作为唯一权威数据。
11. 零工、临时工和正式工属于 Employment Arrangement，不新增 Social Class。同一 Class 可以同时包含不同雇佣关系的劳动者。

V1 明确不做：

- 个人级模拟；
- Cohort 或全属性笛卡尔积 POP；
- 家庭结构、婚姻和亲属关系；
- 跨省通勤；
- 民族或信仰与就业、教育的联合分布；
- 同月内反复迭代到一般均衡；
- 企业与劳动者逐人签订合同。

---

## 2. 系统闭环与边界

```text
Province Population Classes
        │
        ├── 人口、年龄、教育、技能
        ├── 求职人数和保留工资
        └── 消费倾向与资产存量
                │
                ▼
         Province Labor Market
        ┌───────┴────────┐
        │                │
   Labor Supply      Employer Jobs
        │                │
        └──── Matching ──┘
                │
                ▼
     Employment Allocations
        │               │
        ▼               ▼
    Production      Wage Settlement
        │               │
        ▼               ▼
   Goods Supply    Population Income
        │               │
        └── Market ─────┘
                │
                ▼
       Consumption / Saving
                │
                ▼
             Wealth
```

人口模块负责：

- Class 人数和人口结构；
- 劳动参与、就业状态和求职供给；
- 教育、技能和阶层的缓慢变化；
- 出生、死亡、年龄推进和迁移；
- 人口账户的资产负债存量；
- 向商品市场提交消费需求。

劳动力市场负责：

- 接收 Employer 岗位需求；
- 估算各 Class 对岗位的合格供给；
- 按确定性顺序裁员和招聘；
- 保存 Employer、Job Type 与 Class 之间的就业分配；
- 根据空缺和失业压力更新参考工资。

人口模块不负责企业生产、商品清算、税率制定、银行货币创造或 UI 聚合。

---

## 3. Social Class

### 3.1 Class 的性质

V1 的 Social Class 是游戏化的社会经济原型，故意综合主要工作领域、技能层级、雇主性质和资产关系。它不是严格的社会学分类，也不等于当前职业。

同一人口在任意时点只属于一个 Class。Class 按月缓慢变化，不能因一次换工作立即改变。

| ID                   | 显示名称     | 主要识别依据                                 | 主要收入来源             |
| -------------------- | ------------ | -------------------------------------------- | ------------------------ |
| farmer               | 农民         | 农业工作或小规模农业经营占主导               | 农业工资、自营农业收入   |
| worker               | 普通工人     | 基础或中等技能生产性工资劳动                 | 工资                     |
| skilled_worker       | 技术工人     | 高技能技术岗位占主导                         | 较高工资                 |
| service_worker       | 服务业人员   | 服务、零售和基础生活服务岗位占主导           | 工资                     |
| office_worker        | 普通白领     | 文职、行政、财务、销售和一般办公室岗位占主导 | 工资                     |
| professional         | 专业人士     | 专业知识、执业资格或专业技术岗位占主导       | 高技能工资、专业服务收入 |
| managerial           | 管理人员     | 私营部门的中高层管理和组织决策岗位占主导     | 管理薪酬、奖金、股权激励 |
| civil_servant        | 公务员       | 政府 Employer 岗位占主导                     | 政府工资                 |
| small_business_owner | 小业主       | 自营收入占主导、企业规模较小                 | 自营收入                 |
| capitalist           | 企业主       | 雇主型企业权益和利润占主导                   | 企业利润、分红           |
| rentier              | 资产收益阶层 | 被动资产收入持续占主导                       | 租金、利息、股息         |

### 3.2 Class 与其他概念

```text
Social Class       长期社会经济位置，按月缓慢变化
Job Type           当前岗位类型，由就业分配表示
Employment Status  就业、失业、学生、退休、非劳动力
Education          正规教育资格
Skill              当前劳动能力
Income             本期交易流量
Wealth             跨期资产负债存量
```

短期内允许 Class 与当前岗位不一致。例如公务员进入私企后不会立即变成 Professional；连续满足目标条件后才逐步转换。

管理职级首先由 Job Type 表示，持续担任私营部门中高层管理岗位的人口逐步归入 managerial。没有企业控制权、主要领取工资的职业经理人属于 managerial；持有并控制企业、主要依靠企业利润的管理者属于 capitalist。政府管理人员仍属于 civil_servant，小企业所有者兼经理仍属于 small_business_owner。普通购买上市公司股票或获得少量股权激励不会产生企业控制权。

### 3.3 静态 Class Definition

```ts
interface SocialClassDefinition {
  readonly id: SocialClassId;
  readonly nameKey: string;
  readonly laborParticipationBaseRate: number;
  readonly reservationWageMultiplier: number;
  readonly jobCompatibilityByCategory: Readonly<Record<JobCategoryId, number>>;
  readonly consumptionProfileId: ConsumptionProfileId;
  readonly savingPropensity: number;
}
```

所有比例范围为 0～1。Definition 由 game-data 加载和校验，不在每个省份重复存档。

---

## 4. 权威人口状态

### 4.1 PopulationClassState

```ts
interface PopulationClassState {
  readonly provinceId: ProvinceId;
  readonly socialClassId: SocialClassId;

  populationPersons: number;

  ageCounts: NumberById<AgeBandId>;
  genderCounts: NumberById<GenderId>;
  workingAgeEducationCounts: NumberById<EducationLevelId>;
  laborForceSkillCounts: NumberById<SkillLevelId>;
  employmentStatusCounts: NumberById<EmploymentStatusId>;
  ethnicityCounts: NumberById<EthnicityId>;
  religionCounts: NumberById<ReligionId>;

  balanceSheet: PopulationBalanceSheet;
  currentPeriodIncome: PopulationIncomeAccumulator;
  classTransitionProgress: NumberById<SocialClassId>;
}
```

NumberById 初期使用普通对象；只有性能分析证明必要时才改成稠密数组或 TypedArray。

### 4.2 每个分布的分母

| 字段                      | 守恒目标                   |
| ------------------------- | -------------------------- |
| ageCounts                 | 合计等于 populationPersons |
| genderCounts              | 合计等于 populationPersons |
| workingAgeEducationCounts | 合计等于工作年龄人口       |
| laborForceSkillCounts     | 合计等于劳动力人口         |
| employmentStatusCounts    | 合计等于 populationPersons |
| ethnicityCounts           | 合计等于 populationPersons |
| religionCounts            | 合计等于 populationPersons |

内部允许聚合人口出现小数。UI 显示时取整；守恒比较使用统一容差。

### 4.3 V1 枚举

```text
AgeBand:
  child_0_14
  youth_15_24
  prime_25_44
  mature_45_64
  senior_65_plus

EducationLevel:
  basic
  secondary
  tertiary
  advanced

SkillLevel:
  low
  medium
  high
  expert

EmploymentStatus:
  employed
  unemployed
  student
  retired
  not_in_labor_force
```

职业不在 PopulationClassState 中保存。当前职业的权威来源是就业分配表。

### 4.4 联合人数估算

系统不保存“Worker + 25～44 岁 + 大学 + 高技能 + 失业”这样的对象。

需要联合人数时：

```text
大学且高技能且失业人数估计
= Class劳动力人口
× 大学学历在工作年龄人口中的比例
× 高技能在劳动力人口中的比例
× 失业在劳动力人口中的比例
```

通用公式：

```text
estimatedIntersection
= basePopulation
× P(attribute A | class)
× P(attribute B | class)
× ...
```

约束：

1. 只在同一 Province、同一 Class 内相乘。
2. 每个概率使用正确分母。
3. 结果不得超过任一参与条件的边际人数。
4. 估计只用于匹配和行为计算，不回写成新人口分组。
5. 如果某个相关性以后成为核心玩法，只增加针对性的二维表，不自动引入 Cohort。

---

## 5. Employer、岗位与就业分配

### 5.1 统一 Employer

```ts
type EmployerId = EconomicUnitId;

interface EmployerState {
  readonly id: EmployerId;
  jobDemands: JobDemandState[];
}
```

每个 Employer 必须满足 `id = EconomicUnitId`。其 Province 和 Kind 每次从对应 Economic Unit 解析，不作为第二份可独立修改的状态。V1 不创建没有账户和股东的合成 Employer。

### 5.2 Job Type Definition

```ts
interface JobTypeDefinition {
  readonly id: JobTypeId;
  readonly categoryId: JobCategoryId;
  readonly minimumEducation: EducationLevelId;
  readonly minimumSkill: SkillLevelId;
  readonly productivityMultiplier: number;
  readonly workingConditionScore: number;
}
```

V1 的 Job Category 至少区分 agriculture、basic_industrial、skilled_technical、consumer_service、office_clerical、professional、middle_management 和 senior_management。是否属于政府岗位由对应 Economic Unit 的 `government_service` Kind 判断，不需要复制一套政府职业。管理岗位表示受雇管理工作；企业控制权来自权威 Share Position，不由 Job Category 推断。

### 5.3 Job Demand

所有岗位统一使用全职当量 FTE：

```ts
type EmploymentArrangement =
  "permanent" | "fixed_term" | "temporary" | "gig_platform" | "informal" | "self_employed";
```

```ts
interface JobDemandState {
  readonly jobTypeId: JobTypeId;
  readonly arrangement: EmploymentArrangement;
  desiredFte: number;
  offeredMonthlyWageCentsPerFte: number;
}
```

V1 假设一名就业人员等于一个 FTE，不模拟兼职。V1 正式启用 permanent、fixed_term、temporary 和 self_employed；`self_employed` 也必须指向真实 Economic Unit，由该 Unit 的账户支付所有者劳动报酬，股息另行结算。gig_platform 与 informal 只保留数据定义，在实现 engagedPersons、工作利用率和多重就业前不得由游戏数据生成。保留 FTE 单位是为了以后扩展。

Employment Arrangement 影响岗位稳定性、Employer 税费和福利、保留工资、裁员概率及收入波动，但不直接决定 Social Class。例如外卖骑手通常属于 service_worker，自由程序员通常属于 professional，临时建筑工仍属于 worker 或 skilled_worker。

### 5.4 Employment Allocation

```ts
interface EmploymentAllocationState {
  readonly provinceId: ProvinceId;
  readonly employerId: EmployerId;
  readonly jobTypeId: JobTypeId;
  readonly socialClassId: SocialClassId;
  readonly arrangement: EmploymentArrangement;

  employedFte: number;
  paidMonthlyWageCentsPerFte: number;
}
```

唯一键：

```text
provinceId + employerId + jobTypeId + socialClassId + arrangement
```

零就业记录立即删除，避免稀疏表长期膨胀。

---

## 6. 劳动力供给

### 6.1 可求职人数

```text
unemployedAvailable
= employmentStatusCounts.unemployed

optionalJobSwitchers
= employmentStatusCounts.employed
× jobSearchRateAmongEmployed

availableJobSeekers
= unemployedAvailable + optionalJobSwitchers
```

第一阶段令 jobSearchRateAmongEmployed 为零，完成基本闭环后再启用在职跳槽。

### 6.2 岗位合格概率

对 Class c 和 Job Type j：

```text
educationEligibility(c, j)
= 符合最低教育要求人数 / 工作年龄人口

skillEligibility(c, j)
= 符合最低技能要求人数 / 劳动力人口

classCompatibility(c, j)
= ClassDefinition.jobCompatibilityByCategory[j.category]

estimatedEligible(c, j)
= remainingJobSeekers(c)
× educationEligibility(c, j)
× skillEligibility(c, j)
× classCompatibility(c, j)
```

每个因子限制到 0～1；分母为零时结果为零。

### 6.3 接受岗位

```text
effectiveOffer
= offeredMonthlyWage
× workingConditionMultiplier

reservationWage
= provinceSubsistenceCost
× class.reservationWageMultiplier

acceptanceRate
= clamp((effectiveOffer / max(reservationWage, 1) - 0.8) / 0.4, 0, 1)

hireable
= min(vacancyFte, remainingJobSeekers, estimatedEligible × acceptanceRate)
```

0.8 和 0.4 必须作为具名静态参数保存，不能散落在代码中。

---

## 7. 确定性招聘算法

劳动力市场每月执行一次。

### 7.1 裁员

1. 按 employerId、jobTypeId、socialClassId 升序遍历现有分配。
2. 如果岗位就业超过 desiredFte，裁减超额部分。
3. 被裁人数从 employed 转入 unemployed。
4. 分配和就业人数不得变成负数。

### 7.2 空缺队列

```text
vacancyFte = max(0, desiredFte - currentEmployedFte)
```

空缺岗位排序：

1. offeredMonthlyWage 降序；
2. workingConditionScore 降序；
3. employerId 升序；
4. jobTypeId 升序。

### 7.3 招聘

对每个空缺岗位：

1. 为每个 Class 计算 hireable。
2. 候选 Class 按岗位适配分数降序、socialClassId 升序排序。
3. 依次填充空缺。
4. 每招聘一人，同时减少该 Class 的 remainingJobSeekers 和 unemployed。
5. 增加对应就业分配和 employed。
6. 空缺填满或无可招聘者时停止。

remainingJobSeekers 是本轮招聘的共享临时预算，因此同一批失业者不能被多个岗位重复雇佣。

招聘后必须满足：

```text
sum(EmploymentAllocation.employedFte for province + class)
= employmentStatusCounts.employed
```

超过容差时本月 Tick 失败并输出诊断，不能静默修正。

---

## 8. 工资形成

### 8.1 三种工资

```text
referenceWage  省级、岗位类型的市场参考工资
offeredWage    Employer 下个月愿意提供的工资
paidWage       当前就业分配实际结算工资
```

三者不能复用同一字段。

### 8.2 参考工资更新

每月招聘后按 Province 和 Job Type 汇总：

```text
vacancyRate
= unfilledVacancyFte / max(totalDesiredFte, 1)

unemploymentPressure
= compatibleUnemployed / max(compatibleLaborForce, 1)

wageSignal
= clamp(vacancyRate - unemploymentPressure, -1, 1)

nextReferenceWage
= clamp(
    currentReferenceWage × (1 + monthlyWageAdjustmentRate × wageSignal),
    legalMinimumWage,
    configuredMaximumWage
  )
```

V1 默认 monthlyWageAdjustmentRate 为 0.05，由静态数据配置。

### 8.3 Employer 报价

```text
nextOfferedWage
= nextReferenceWage × employerWageMultiplier
```

Employer 支付能力在 Economic Unit 生成岗位计划时处理。无法支付工资时必须减少岗位或进入欠薪/破产流程，不能凭空支付。

工资信号只影响下个月报价，避免招聘过程中即时改价造成顺序依赖。

---

## 9. 收入、消费、储蓄与财富

### 9.1 收入是流量

```ts
interface PopulationIncomeAccumulator {
  laborIncomeCents: number;
  selfEmploymentIncomeCents: number;
  businessIncomeCents: number;
  capitalIncomeCents: number;
  rentIncomeCents: number;
  transferIncomeCents: number;
  taxesPaidCents: number;
}
```

```text
disposableIncome
= 所有税前收入 - taxesPaid
```

Low、Middle、High Income 只能是 Metrics，不进入权威 State。

### 9.2 财富是存量

```ts
interface PopulationBalanceSheet {
  cashCents: number;
  bankDepositsCents: number;
  securitiesCents: number;
  businessEquityCents: number;
  landCents: number;
  ownerOccupiedHousingCents: number;
  rentalPropertyCents: number;
  otherAssetsCents: number;
  mortgageDebtCents: number;
  otherDebtCents: number;
}
```

```text
netWealth = assets - debt
```

资产变化必须对应交易对手或明确的重估事件，不能因 Class 改变而生成或销毁财富。所有 Class 都可以拥有住房、证券和其他资产。自住房主要影响住房成本和净财富，不作为转入 rentier 的依据；只有投资房产及其他被动资产产生的收入才参与资产收益阶层判定。

`SharePositionState` 是持股数量和控制关系的唯一权威来源；`securitiesCents` 与 `businessEquityCents` 是对应投资账户的账面价值。认购、转让和清算必须原子更新 Position、现金和账面价值；重估只通过独立 Ledger Entry 更新账面价值，不改变股份数或现金。金额字段必须能按持股交易与估值记录对账，不能用来反推或改写股份数。

### 9.3 消费预算

```text
resourcesAvailable
= disposableIncome + allowedCashDrawdown

essentialBudget
= min(resourcesAvailable, essentialNeedPerPerson × population)

discretionaryBudget
= max(0, resourcesAvailable - essentialBudget)
× (1 - savingPropensity)
```

实际消费由商品市场成交和配给结果决定。未成交预算不能算作已消费。

```text
changeInLiquidAssets
= disposableIncome
- actualConsumption
- debtService
+ newBorrowing
```

---

## 10. 教育与技能

V1 按月以比例流动更新，不创建 Cohort。

教育升级：

```text
graduates
= sourceEducationCount
× monthlyEnrollmentRate
× completionRate
```

技能升级：

```text
skillUpgradeDemandSignal
= clamp(shortageRateForHigherSkillJobs, 0, 1)

upgraded
= sourceSkillCount
× monthlyTrainingRate
× educationCompatibility
× skillUpgradeDemandSignal
```

所有流动都从来源档扣除并加入目标档，不得超过来源人数。技能退化第一阶段设为零。

教育和技能变化不会直接改变 Class；Class 流动单独处理。

---

## 11. Social Class 流动

### 11.1 目标 Class 判定

Class 转换规则由静态数据定义，不能把判断阈值硬编码在流程中：

```ts
interface ClassTransitionRuleDefinition {
  readonly sourceClassId: SocialClassId;
  readonly targetClassId: SocialClassId;
  readonly priority: number;
  readonly minimumJobShare?: Readonly<Record<JobCategoryId, number>>;
  readonly minimumIncomeShare?: Readonly<Record<IncomeCategoryId, number>>;
  readonly minimumEducationShare?: Readonly<Record<EducationLevelId, number>>;
  readonly minimumSkillShare?: Readonly<Record<SkillLevelId, number>>;
  readonly minimumProductiveAssetsCentsPerCapita?: number;
  readonly minimumPassiveAssetsCentsPerCapita?: number;
  readonly delayMonths: number;
  readonly maximumTransferRatePerMonth: number;
}
```

岗位份额来自就业分配，收入份额来自本期收入累计器；生产性资产门槛使用企业权益等 Class 人均经营性资产，被动资产门槛使用证券和投资房产等 Class 人均非经营性资产，自住房不计入两者。某项实际值低于规则门槛时，该规则本月不满足且进度归零；全部门槛满足时，`estimatedEligibleShare` 取实际岗位份额、收入份额、教育份额和技能份额中参与本规则的最小值。只含资产门槛而没有份额条件时，满足门槛后的 `estimatedEligibleShare` 为 1。规则按 priority 降序、targetClassId 升序执行，并共享来源 Class 的剩余可转移人口预算。

默认规则表达以下优先级：

1. 企业利润和雇主型权益占主导 → capitalist；
2. 租金、利息和被动资产收入占主导 → rentier；
3. 自营收入占主导 → small_business_owner；
4. 政府岗位就业占主导 → civil_servant；
5. 农业岗位就业占主导 → farmer；
6. 私营部门中高层管理岗位占主导 → managerial；
7. 专业技术岗位占主导，且教育、技能达标 → professional；
8. 技术岗位且高技能占主导 → skilled_worker；
9. 文职、行政、财务、销售或一般办公室岗位占主导 → office_worker；
10. 服务岗位占主导 → service_worker；
11. 其他以工资劳动为主 → worker。

“占主导”的默认阈值是相关就业或收入达到对应总量的 60%。具体阈值全部来自 `ClassTransitionRuleDefinition`。

### 11.2 滞后与速度

目标条件连续满足 `rule.delayMonths` 后才允许转移，默认 12 个月；任一条件中断就把对应目标的 `classTransitionProgress` 清零。

```text
monthlyTransfer
= min(
    sourceClassPopulation × estimatedEligibleShare,
    sourceClassPopulation × rule.maximumTransferRatePerMonth,
    remainingTransferBudget
  )
```

默认每月上限为来源 Class 人口的 1%。

### 11.3 转移内容

Class 转移是重新分类，不是出生或死亡。按相同比例转移：

- 人口；
- 年龄、性别、教育、技能、就业、民族和信仰计数；
- 对应就业分配；
- 现金、存款、土地、住房、房产、其他资产、债务和当期收入。

`securitiesCents`、`businessEquityCents` 和 Share Position 不走上述普通金额比例路径。月内所有 Class 流动确定后，以来源 Class 的转移比例计算各目标应承接的股份，用最大余数法把整数股份确定性分配给目标 Class；对应账面价值严格按实际转移股份比例移动。该操作属于持有人重分类，不发生现金支付，但必须写成同一原子 Ledger/Equity 批次。若来源 Class 人数归零，其剩余股份和账面价值必须全部分配完毕。

由于没有联合分布，其他内容按来源 Class 的平均比例转移。目标 Class 已存在时直接合并；每省每种 Class 最多一个 State。

---

## 12. 人口变化

人口变化按月执行。

### 12.1 出生

```text
births
= populationPersons × annualCrudeBirthRate / 12
```

出生人口加入同一 Class 的 child_0_14 和 not_in_labor_force。workingAgeEducationCounts 的分母不包含儿童，因此出生时不修改教育分布。性别、民族和信仰按父母 Class 当前边际分布分配。

### 12.2 死亡

```text
deathsByAgeBand
= ageBandCount × annualMortalityRate[ageBand] / 12
```

死亡人口先从对应年龄档和总人口扣除；性别、民族和信仰按 Class 当前边际比例扣除。只有工作年龄死亡才按比例扣除教育分布，只有劳动力死亡才按比例扣除技能和劳动力状态。资产进入继承人 Class 或 Government 账户；任何处理都必须写交易。投资资产必须按 11.3 的显式股权重分类规则把 Share Position 与账面价值一起转移，不允许产生无股东股份。

### 12.3 年龄推进

```text
monthlyAgingOut
= ageBandCount / ageBandDurationMonths
```

senior_65_plus 不自然流出，只通过死亡减少。儿童进入工作年龄时，按照当期教育政策结果加入教育分布，并从非劳动力转入学生、就业、失业或其他状态。工作年龄人口进入 senior 时，按比例从教育、技能和劳动力状态扣除并加入 retired 或 not_in_labor_force。所有转移共用 aging out 人数预算。

### 12.4 迁移

第一阶段只支持外生省际迁移命令。迁移量从来源 Province、Class 按比例扣除，加入目标 Province 的相同 Class；资产是否随迁由命令规则明确指定。携带投资资产时，必须在来源与目标 Class 投资账户之间显式重分类 Share Position 和对应账面价值。

内生迁移后续再加入，信号包括实际工资、失业率、住房成本和迁移成本。跨省通勤不在 V1 范围。

---

## 13. Scheduler 挂接点

端到端顺序只以 `economic_simulation_web_architecture.md` 的标准 Tick 为准。人口与劳动力模块在月末挂接：

| Scheduler 阶段 | 人口与劳动力行为                                                              |
| -------------- | ----------------------------------------------------------------------------- |
| 10a            | 接收工资、税后转移、利息和租金等双方同步结算结果                              |
| 10d            | 按冻结股东名册接收股息                                                        |
| 10e            | 接收商品市场的实际消费结果，更新 Population Class 资产负债表                  |
| 11b            | 更新教育、技能和 Class 进度，依次执行有限阶层流动、出生、死亡、年龄和外生迁移 |
| 11c            | 读取 Unit 岗位计划，依次裁员、招聘并更新下月参考工资与报价                    |
| 12             | 检查人口、就业、岗位、资金和资产不变量                                        |
| 13～14         | 输出 Metrics、历史采样、Event 和 UI Delta                                     |

新招聘人员从下个月开始生产和领取工资，不能参与刚结束月份的结算。工资报价使用一个月滞后，不在招聘循环中反复改价；下月生产开始前，Employment Allocation 必须已经确定。人口模块只接收 Ledger 结算结果，不自行结算 Economic Unit 利润或分红。

---

## 14. 必须满足的不变量

### 14.1 人口

```text
populationPersons >= 0
sum(ageCounts) = populationPersons
sum(genderCounts) = populationPersons
sum(employmentStatusCounts) = populationPersons
sum(ethnicityCounts) = populationPersons
sum(religionCounts) = populationPersons
sum(workingAgeEducationCounts) = workingAgePopulation
sum(laborForceSkillCounts) = laborForcePopulation
```

### 14.2 就业与岗位

```text
employed >= 0
unemployed >= 0
employed + unemployed <= workingAgePopulation
sum(class employment allocations) = class employed
sum(job allocations) <= employer desiredFte
allocation.employedFte >= 0
```

### 14.3 资金与财富

```text
Employer工资成本
= Population劳动收入 + 代扣项目

Population期末流动资产
= 期初流动资产
+ 净收入
- 实际消费
- 净偿债
+ 资产交易净流入
```

资产转移、继承和 Class 重新分类的双方变化必须相等。资产重估必须单独记录。

### 14.4 数值安全

- 所有数值必须有限，禁止 NaN 和 Infinity。
- 人口比较默认绝对容差 1e-6 persons。
- 金额使用整数 cents；超出安全整数范围时模拟失败并报告。
- 所有率必须位于 Definition 允许范围。
- 分母为零时公式必须返回显式零或结构化错误。

---

## 15. Metrics 与查询

以下都是派生数据：

- Province 人口和各 Class 人口；
- 劳动参与率、就业率、失业率；
- 按 Job Type 的岗位、就业、空缺和参考工资；
- Class 平均工资、可支配收入、人均净财富；
- 各收入来源占比；
- 年龄、教育、技能、民族和信仰比例；
- 消费、储蓄和生活必需品满足率；
- Class 流入、流出和转换进度。

建议查询：

```text
getProvincePopulationSummary
getPopulationClassDetails
getProvinceLaborMarket
getEmployerEmployment
getClassIncomeAndWealth
getPopulationInvariantReport
```

UI 只能查询和显示，不得为了凑成 100% 修改模拟分布。

---

## 16. 静态数据和校验

静态数据至少包括：

```text
social-classes.json
class-transition-rules.json
job-types.json
education-levels.json
skill-levels.json
population-rates.json
labor-market-parameters.json
consumption-profiles.json
```

加载时校验：

- 所有 ID 唯一且引用存在；
- 11 个 Social Class 定义齐全；
- Class—Job Category 兼容度在 0～1；
- 教育和技能等级顺序明确；
- Job Demand 的 Employment Arrangement 有效，且未启用的 gig_platform、informal 不得出现在 V1 游戏数据中；
- 工资、人口和期间单位明确；
- 所有概率在 0～1；
- 出生、死亡、转换和工资调整率有合理上限；
- 消费档案引用的商品存在。

游戏数据版本进入存档。更改枚举 ID、含义或单位视为存档迁移。

---

## 17. 推荐模块边界

| 模块           | 主要读取                 | 主要写入                 |
| -------------- | ------------------------ | ------------------------ |
| Population     | 人口、政策、结算结果     | 人口分布、消费计划、资产 |
| Labor          | 人口供给、岗位需求       | 就业分配、参考工资       |
| Economic Units | 价格、库存、工资、技术   | 岗位需求                 |
| Accounting     | 就业分配、市场成交、税费 | 交易和账户余额           |
| Statistics     | 所有只读状态             | 可重算 Metrics           |

跨模块通过阶段输出或受控 World API 提交变化，不得直接修改其他模块内部状态。

---

## 18. 实施阶段

### Milestone 1：人口状态与守恒

实现：

- 11 个 Population Class 初始化；
- 年龄、教育、技能和就业计数；
- 分布校验和快照往返；
- Province 人口汇总查询。

验收：固定世界运行 1,200 个月，分布无负数和 NaN，存档恢复后结果一致。

### Milestone 2：劳动力市场

实现：

- Employer、Job Type 和 Job Demand；
- 分布乘法合格人数估算；
- 裁员、招聘、就业分配和参考工资；
- 劳动力市场 Inspector。

验收：不存在重复招聘；Class 就业人数与分配表一致；劳动力短缺使工资逐步上升而不是单月爆炸。

### Milestone 3：收入、消费与财富

实现：

- 工资和转移支付结算；
- 消费预算与商品市场接口；
- 现金、存款和债务；
- 人口账户对账。

验收：Employer 工资成本与人口劳动收入一致，存款变化能由收入、消费和债务流解释。

### Milestone 4：人口与阶层动态

实现：

- 教育和技能流动；
- Class 滞后转换；
- 出生、死亡和年龄推进；
- 外生迁移。

验收：转换保持世界人口守恒；重新分类不生成或销毁资产；长期趋势稳定且可解释。

---

## 19. 最小纵向测试场景

```text
人口：
  Farmer          20,000
  Worker          60,000
  Skilled Worker  15,000
  Office Worker    8,000
  Professional     5,000
  Managerial        2,000

Employer：
  Farm Cooperative
  Basic Factory
  Advanced Factory

岗位：
  农业岗位       15,000
  基础工业岗位   45,000
  高级技术岗位   12,000
  专业岗位        4,000
```

必须覆盖：

1. 岗位少于劳动力时产生失业并压低参考工资。
2. 高技能岗位供不应求时出现空缺并逐月提高参考工资。
3. 工厂缩产后先裁员，再在后续月份重新招聘。
4. 教育和技能提升增加高级岗位的估计合格供给。
5. 存档后继续运行与不中断分支完全一致。
6. 连续运行 1,200 个月不存在负人口、负就业、NaN 或无法解释的资金变化。

---

## 20. 性能预算

```text
标准场景：2,000 Province × 最多 11 Class = 22,000 PopulationClassState
压力场景：5,000 Province × 最多 11 Class = 55,000 PopulationClassState
```

优化原则：

1. 不为零人口 Class 创建 State。
2. 不保留零就业分配。
3. Employer 只访问本省劳动力市场索引。
4. 招聘按 Job Category 预计算 Class 兼容度和教育、技能累计比例。
5. UI 不接收完整 World State，只接收查询结果和变化摘要。
6. 先使用可读对象模型；只有基准证明热点时才迁移到扁平数组。

禁止每个 Employer 扫描世界全部人口。复杂度目标：

```text
每月招聘
≈ 各省（本省空缺岗位数 × 本省非零 Class 数）
```

---

## 21. 后续升级条件

只有同时满足以下条件才增加联合分布：

1. 某个相关性已经成为明确玩法机制；
2. 当前乘法近似产生玩家可观察且无法接受的错误；
3. 有自动测试描述预期改进；
4. 新状态通过对象数量、Tick 时间和存档大小预算。

升级顺序：

```text
独立边际分布
→ 针对性二维表，例如 Education × Skill
→ 少量条件分布
→ 最后才评估 Cohort
```

不得因为“现实中属性有关联”就提前引入 Cohort。

### 21.1 启用平台零工的前置条件

gig_platform 不需要新的 Social Class，但需要扩展就业分配：

```ts
interface GigEmploymentQuantities {
  engagedPersons: number;
  employedFte: number;
}
```

启用前必须同时实现：

- engagedPersons 与 employedFte 分离；
- 工作利用率和工作不足；
- 一个人参与多个零工池时的人数去重规则；
- 平台费用、税费、福利和收入波动；
- 零工进入、退出和失业统计口径；
- 对应的人口、FTE 和资金不变量。

在这些规则完成前，零散临时工作使用 temporary 表示，不使用 gig_platform。

---

## 22. 最终实现原则

1. 人口只在 PopulationClassState.populationPersons 中保存一份权威总量。
2. 每省每 Class 最多一个 State，不存在隐含 POP。
3. 联合人数默认通过 Class 内分布乘法估计。
4. 当前职业由就业分配表示，不通过拆分人口表示。
5. 招聘使用共享剩余求职预算，防止同一人口重复雇佣。
6. 工资按月缓慢响应供需，计划和结算有明确时间滞后。
7. 收入是流量和派生统计，财富是需要对账的存量。
8. Class 流动是有限速度的重新分类，不能改变世界人口和总资产。
9. 所有公式、单位、排序、容差和参数必须显式且可测试。
10. 先完成最小经济闭环，再增加人口统计精度。
11. 零工是雇佣关系而不是阶层；未实现参与人数、FTE 和多重就业口径前不启用平台零工。
