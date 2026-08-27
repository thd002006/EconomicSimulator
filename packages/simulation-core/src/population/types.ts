export type ProvinceId = string;
export type OperatingUnitId = string;
/** @deprecated Use OperatingUnitId. Kept as alias for existing call sites. */
export type EconomicUnitId = OperatingUnitId;
export type EmployerId = OperatingUnitId;
export type SocialClassId = string;
export type JobTypeId = string;

export const JOB_CATEGORIES = [
  "agriculture",
  "basic_industrial",
  "skilled_technical",
  "consumer_service",
  "office_clerical",
  "professional",
  "middle_management",
  "senior_management"
] as const;

export type JobCategoryId = (typeof JOB_CATEGORIES)[number];

export const INCOME_CATEGORIES = [
  "labor",
  "self_employment",
  "business",
  "capital",
  "rent",
  "transfer"
] as const;

export type IncomeCategoryId = (typeof INCOME_CATEGORIES)[number];

export const AGE_BANDS = [
  "child_0_14",
  "youth_15_24",
  "prime_25_44",
  "mature_45_64",
  "senior_65_plus"
] as const;

export type AgeBandId = (typeof AGE_BANDS)[number];

export const WORKING_AGE_BANDS = ["youth_15_24", "prime_25_44", "mature_45_64"] as const;
export type WorkingAgeBandId = (typeof WORKING_AGE_BANDS)[number];

export const EDUCATION_LEVELS = ["basic", "secondary", "tertiary", "advanced"] as const;
export type EducationLevelId = (typeof EDUCATION_LEVELS)[number];

export const SKILL_LEVELS = ["low", "medium", "high", "expert"] as const;
export type SkillLevelId = (typeof SKILL_LEVELS)[number];

export const EMPLOYMENT_STATUSES = [
  "employed",
  "unemployed",
  "student",
  "retired",
  "not_in_labor_force"
] as const;

export type EmploymentStatusId = (typeof EMPLOYMENT_STATUSES)[number];

export const GENDERS = ["female", "male"] as const;
export type GenderId = (typeof GENDERS)[number];

export type EthnicityId = string;
export type ReligionId = string;

export type NumberById<T extends string> = Record<T, number>;

export const EMPLOYMENT_ARRANGEMENTS = [
  "permanent",
  "fixed_term",
  "temporary",
  "self_employed"
] as const;

export type EmploymentArrangement = (typeof EMPLOYMENT_ARRANGEMENTS)[number];

export const BALANCE_SHEET_FIELDS = [
  "cashCents",
  "bankDepositsCents",
  "securitiesCents",
  "businessEquityCents",
  "landCents",
  "ownerOccupiedHousingCents",
  "rentalPropertyCents",
  "otherAssetsCents",
  "mortgageDebtCents",
  "otherDebtCents"
] as const;

export type BalanceSheetFieldId = (typeof BALANCE_SHEET_FIELDS)[number];

export const INVESTMENT_BALANCE_SHEET_FIELDS = ["securitiesCents", "businessEquityCents"] as const;

export type InvestmentBalanceSheetFieldId = (typeof INVESTMENT_BALANCE_SHEET_FIELDS)[number];

export interface PopulationBalanceSheet {
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

export interface PopulationIncomeAccumulator {
  laborIncomeCents: number;
  selfEmploymentIncomeCents: number;
  businessIncomeCents: number;
  capitalIncomeCents: number;
  rentIncomeCents: number;
  transferIncomeCents: number;
  taxesPaidCents: number;
}

export interface PopulationClassState {
  readonly provinceId: ProvinceId;
  readonly socialClassId: SocialClassId;

  populationPersons: number;

  ageCounts: NumberById<AgeBandId>;
  genderCounts: NumberById<GenderId>;
  workingAgeEducationCounts: NumberById<EducationLevelId>;
  laborForceSkillCounts: NumberById<SkillLevelId>;
  employmentStatusCounts: NumberById<EmploymentStatusId>;
  ethnicityCounts: Record<EthnicityId, number>;
  religionCounts: Record<ReligionId, number>;

  balanceSheet: PopulationBalanceSheet;
  currentPeriodIncome: PopulationIncomeAccumulator;
  classTransitionProgress: Partial<Record<SocialClassId, number>>;
}

export interface JobDemandState {
  readonly jobTypeId: JobTypeId;
  readonly arrangement: EmploymentArrangement;
  desiredFte: number;
  offeredMonthlyWageCentsPerFte: number;
}

export interface EmployerState {
  readonly id: EmployerId;
  jobDemands: JobDemandState[];
}

export interface EmploymentAllocationState {
  readonly provinceId: ProvinceId;
  readonly employerId: EmployerId;
  readonly jobTypeId: JobTypeId;
  readonly socialClassId: SocialClassId;
  readonly arrangement: EmploymentArrangement;

  employedFte: number;
  paidMonthlyWageCentsPerFte: number;
}

export interface SocialClassDefinition {
  readonly id: SocialClassId;
  readonly nameKey: string;
  readonly laborParticipationBaseRate: number;
  readonly reservationWageMultiplier: number;
  readonly jobCompatibilityByCategory: Readonly<Record<JobCategoryId, number>>;
  readonly consumptionProfileId: string;
  readonly savingPropensity: number;
}

export interface JobTypeDefinition {
  readonly id: JobTypeId;
  readonly categoryId: JobCategoryId;
  readonly minimumEducation: EducationLevelId;
  readonly minimumSkill: SkillLevelId;
  readonly productivityMultiplier: number;
  readonly workingConditionScore: number;
}

export interface ClassTransitionRuleDefinition {
  readonly sourceClassId: SocialClassId | "*";
  readonly targetClassId: SocialClassId;
  readonly priority: number;
  readonly minimumJobShare?: Readonly<Partial<Record<JobCategoryId, number>>>;
  readonly minimumGovernmentJobShare?: number;
  readonly minimumIncomeShare?: Readonly<Partial<Record<IncomeCategoryId, number>>>;
  readonly minimumCombinedIncomeShare?: Readonly<{
    readonly categories: readonly IncomeCategoryId[];
    readonly share: number;
  }>;
  readonly minimumEducationShare?: Readonly<Partial<Record<EducationLevelId, number>>>;
  readonly minimumSkillShare?: Readonly<Partial<Record<SkillLevelId, number>>>;
  readonly minimumProductiveAssetsCentsPerCapita?: number;
  readonly minimumPassiveAssetsCentsPerCapita?: number;
  readonly delayMonths: number;
  readonly maximumTransferRatePerMonth: number;
}

export interface ConsumptionProfileDefinition {
  readonly id: string;
  readonly essentialNeedPerPersonCentsPerMonth: number;
}

export interface PopulationRatesDefinition {
  readonly annualCrudeBirthRate: number;
  readonly annualMortalityRateByAgeBand: Readonly<Record<AgeBandId, number>>;
  readonly ageBandDurationMonths: Readonly<Record<AgeBandId, number>>;
  readonly monthlyEnrollmentRate: number;
  readonly educationCompletionRate: number;
  readonly monthlyTrainingRate: number;
  readonly monthlyStudentGraduationRate: number;
}

export interface LaborMarketParameters {
  readonly jobSearchRateAmongEmployed: number;
  readonly acceptanceRateFloor: number;
  readonly acceptanceRateRange: number;
  readonly monthlyWageAdjustmentRate: number;
  readonly legalMinimumWageCentsPerMonth: number;
  readonly configuredMaximumWageCentsPerMonth: number;
  readonly provinceSubsistenceCostCentsPerMonth: number;
  readonly maxCashDrawdownSharePerMonth: number;
  readonly populationTolerance: number;
}

export interface PopulationStaticData {
  readonly dataPackVersion: string;
  readonly socialClasses: readonly SocialClassDefinition[];
  readonly jobTypes: readonly JobTypeDefinition[];
  readonly classTransitionRules: readonly ClassTransitionRuleDefinition[];
  readonly consumptionProfiles: readonly ConsumptionProfileDefinition[];
  readonly rates: PopulationRatesDefinition;
  readonly laborMarketParameters: LaborMarketParameters;
}

export interface PopulationWorld {
  readonly staticData: PopulationStaticData;
  readonly socialClassById: ReadonlyMap<SocialClassId, SocialClassDefinition>;
  readonly jobTypeById: ReadonlyMap<JobTypeId, JobTypeDefinition>;
  readonly consumptionProfileById: ReadonlyMap<string, ConsumptionProfileDefinition>;
  readonly classStatesByProvince: Map<ProvinceId, Map<SocialClassId, PopulationClassState>>;
  readonly employers: Map<EmployerId, EmployerState>;
  readonly employerProvinces: Map<EmployerId, ProvinceId>;
  readonly governmentEmployerIds: Set<EmployerId>;
  readonly employerWageMultipliers: Map<EmployerId, number>;
  readonly allocations: Map<string, EmploymentAllocationState>;
  readonly referenceWages: Map<string, number>;
}

export interface ExogenousMigrationCommand {
  readonly fromProvinceId: ProvinceId;
  readonly toProvinceId: ProvinceId;
  readonly socialClassId: SocialClassId;
  readonly persons: number;
  readonly includeAssets: boolean;
}

export interface ClassConsumptionPlan {
  readonly provinceId: ProvinceId;
  readonly socialClassId: SocialClassId;
  readonly disposableIncomeCents: number;
  readonly resourcesAvailableCents: number;
  readonly essentialBudgetCents: number;
  readonly discretionaryBudgetCents: number;
}

export interface InheritanceEvent {
  readonly provinceId: ProvinceId;
  readonly socialClassId: SocialClassId;
  readonly deceasedPersons: number;
  readonly inheritedAssetsCents: number;
  /**
   * 逝者投资账面价值（securities + businessEquity）。
   * 协议：金额不离开来源 Class，也不走普通比例；本字段是交给 Equity 模块的认领凭据，
   * 由其按 §11.3 规则把 Share Position 与账面一起原子重分类到继承人或 Government 账户。
   */
  readonly inheritedInvestmentBookValueCents: number;
  readonly inheritedDebtCents: number;
}

/**
 * 投资资产持有人重分类钩子。金额不随 moveProportion 移动；
 * Equity 模块消费本事件后，把 Share Position 与对应账面价值在 from→to 之间原子搬运。
 */
export interface EquityReclassificationEvent {
  readonly fromProvinceId: ProvinceId;
  readonly toProvinceId: ProvinceId;
  readonly fromSocialClassId: SocialClassId;
  readonly toSocialClassId: SocialClassId;
  readonly reason: "class_transition" | "migration";
  readonly sourceShare: number;
}

export interface MonthlyPopulationStepResult {
  readonly consumptionPlans: readonly ClassConsumptionPlan[];
  readonly inheritanceEvents: readonly InheritanceEvent[];
  readonly equityReclassifications: readonly EquityReclassificationEvent[];
}

export interface ProvincePopulationSummary {
  readonly provinceId: ProvinceId;
  readonly populationPersons: number;
  readonly workingAgePopulation: number;
  readonly laborForcePopulation: number;
  readonly employedPersons: number;
  readonly unemployedPersons: number;
  readonly employmentRate: number;
  readonly unemploymentRate: number;
  readonly populationBySocialClass: Readonly<Record<SocialClassId, number>>;
}

export interface ProvinceLaborMarketSummary {
  readonly provinceId: ProvinceId;
  readonly desiredFteByJobType: Readonly<Record<JobTypeId, number>>;
  readonly employedFteByJobType: Readonly<Record<JobTypeId, number>>;
  readonly unfilledVacancyFteByJobType: Readonly<Record<JobTypeId, number>>;
  readonly referenceWageCentsByJobType: Readonly<Record<JobTypeId, number>>;
}
