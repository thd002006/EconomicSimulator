import type { JobCategoryId, PopulationStaticData } from "../src/population/types";

const JOB_CATEGORIES = [
  "agriculture",
  "basic_industrial",
  "skilled_technical",
  "consumer_service",
  "office_clerical",
  "professional",
  "middle_management",
  "senior_management"
] as const;

type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends ReadonlyArray<infer Item>
    ? Item[]
    : T[K] extends object
      ? { -readonly [K2 in keyof T[K]]: T[K][K2] }
      : T[K];
};

export function makePopulationStaticData(): Mutable<PopulationStaticData> {
  const compat = (values: Partial<Record<(typeof JOB_CATEGORIES)[number], number>>) => {
    const row = {} as Record<JobCategoryId, number>;
    for (const category of JOB_CATEGORIES) {
      row[category] = values[category] ?? 0;
    }
    return row;
  };

  return {
    dataPackVersion: "test-population-v1",
    socialClasses: [
      {
        id: "farmer",
        nameKey: "social_class.farmer",
        laborParticipationBaseRate: 0.7,
        reservationWageMultiplier: 0.7,
        jobCompatibilityByCategory: compat({
          agriculture: 1,
          basic_industrial: 0.3,
          consumer_service: 0.1
        }),
        consumptionProfileId: "standard",
        savingPropensity: 0.05
      },
      {
        id: "worker",
        nameKey: "social_class.worker",
        laborParticipationBaseRate: 0.85,
        reservationWageMultiplier: 1,
        jobCompatibilityByCategory: compat({
          agriculture: 0.3,
          basic_industrial: 1,
          skilled_technical: 0.4,
          consumer_service: 0.5,
          office_clerical: 0.1,
          middle_management: 0.1
        }),
        consumptionProfileId: "standard",
        savingPropensity: 0.08
      },
      {
        id: "skilled_worker",
        nameKey: "social_class.skilled_worker",
        laborParticipationBaseRate: 0.88,
        reservationWageMultiplier: 1.4,
        jobCompatibilityByCategory: compat({
          agriculture: 0.1,
          basic_industrial: 0.6,
          skilled_technical: 1,
          office_clerical: 0.2,
          professional: 0.3
        }),
        consumptionProfileId: "standard",
        savingPropensity: 0.1
      },
      {
        id: "service_worker",
        nameKey: "social_class.service_worker",
        laborParticipationBaseRate: 0.85,
        reservationWageMultiplier: 0.9,
        jobCompatibilityByCategory: compat({
          agriculture: 0.1,
          basic_industrial: 0.2,
          consumer_service: 1,
          office_clerical: 0.4
        }),
        consumptionProfileId: "standard",
        savingPropensity: 0.07
      },
      {
        id: "office_worker",
        nameKey: "social_class.office_worker",
        laborParticipationBaseRate: 0.85,
        reservationWageMultiplier: 1.2,
        jobCompatibilityByCategory: compat({
          basic_industrial: 0.1,
          consumer_service: 0.5,
          office_clerical: 1,
          professional: 0.2,
          middle_management: 0.3
        }),
        consumptionProfileId: "standard",
        savingPropensity: 0.1
      },
      {
        id: "professional",
        nameKey: "social_class.professional",
        laborParticipationBaseRate: 0.9,
        reservationWageMultiplier: 2.2,
        jobCompatibilityByCategory: compat({
          skilled_technical: 0.5,
          office_clerical: 0.4,
          professional: 1,
          middle_management: 0.3
        }),
        consumptionProfileId: "standard",
        savingPropensity: 0.15
      },
      {
        id: "managerial",
        nameKey: "social_class.managerial",
        laborParticipationBaseRate: 0.92,
        reservationWageMultiplier: 2.8,
        jobCompatibilityByCategory: compat({
          office_clerical: 0.3,
          professional: 0.4,
          middle_management: 1,
          senior_management: 0.8
        }),
        consumptionProfileId: "standard",
        savingPropensity: 0.2
      },
      {
        id: "civil_servant",
        nameKey: "social_class.civil_servant",
        laborParticipationBaseRate: 0.9,
        reservationWageMultiplier: 1.3,
        jobCompatibilityByCategory: compat({
          basic_industrial: 0.1,
          consumer_service: 0.3,
          office_clerical: 0.8,
          professional: 0.5,
          middle_management: 0.7
        }),
        consumptionProfileId: "standard",
        savingPropensity: 0.12
      },
      {
        id: "small_business_owner",
        nameKey: "social_class.small_business_owner",
        laborParticipationBaseRate: 0.8,
        reservationWageMultiplier: 1.1,
        jobCompatibilityByCategory: compat({
          agriculture: 0.6,
          basic_industrial: 0.5,
          skilled_technical: 0.4,
          consumer_service: 0.6,
          office_clerical: 0.3,
          middle_management: 0.5
        }),
        consumptionProfileId: "standard",
        savingPropensity: 0.15
      },
      {
        id: "capitalist",
        nameKey: "social_class.capitalist",
        laborParticipationBaseRate: 0.5,
        reservationWageMultiplier: 3,
        jobCompatibilityByCategory: compat({
          office_clerical: 0.1,
          middle_management: 0.6,
          senior_management: 0.8
        }),
        consumptionProfileId: "affluent",
        savingPropensity: 0.25
      },
      {
        id: "rentier",
        nameKey: "social_class.rentier",
        laborParticipationBaseRate: 0.1,
        reservationWageMultiplier: 2,
        jobCompatibilityByCategory: compat({ consumer_service: 0.05, office_clerical: 0.1 }),
        consumptionProfileId: "affluent",
        savingPropensity: 0.3
      }
    ],
    jobTypes: [
      {
        id: "farm_worker",
        categoryId: "agriculture",
        minimumEducation: "basic",
        minimumSkill: "low",
        productivityMultiplier: 0.8,
        workingConditionScore: 0.95
      },
      {
        id: "production_operator",
        categoryId: "basic_industrial",
        minimumEducation: "basic",
        minimumSkill: "low",
        productivityMultiplier: 1,
        workingConditionScore: 0.95
      },
      {
        id: "technician",
        categoryId: "skilled_technical",
        minimumEducation: "secondary",
        minimumSkill: "medium",
        productivityMultiplier: 1.3,
        workingConditionScore: 1
      },
      {
        id: "sales_clerk",
        categoryId: "consumer_service",
        minimumEducation: "basic",
        minimumSkill: "low",
        productivityMultiplier: 0.8,
        workingConditionScore: 0.98
      },
      {
        id: "office_clerk",
        categoryId: "office_clerical",
        minimumEducation: "secondary",
        minimumSkill: "low",
        productivityMultiplier: 1,
        workingConditionScore: 1.02
      },
      {
        id: "engineer",
        categoryId: "professional",
        minimumEducation: "tertiary",
        minimumSkill: "high",
        productivityMultiplier: 1.8,
        workingConditionScore: 1.05
      },
      {
        id: "department_manager",
        categoryId: "middle_management",
        minimumEducation: "tertiary",
        minimumSkill: "high",
        productivityMultiplier: 1.6,
        workingConditionScore: 1
      },
      {
        id: "executive",
        categoryId: "senior_management",
        minimumEducation: "tertiary",
        minimumSkill: "expert",
        productivityMultiplier: 2.2,
        workingConditionScore: 0.95
      }
    ],
    classTransitionRules: [
      {
        sourceClassId: "*",
        targetClassId: "capitalist",
        priority: 100,
        minimumIncomeShare: { business: 0.6 },
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "rentier",
        priority: 90,
        minimumCombinedIncomeShare: { categories: ["rent", "capital"], share: 0.6 },
        minimumPassiveAssetsCentsPerCapita: 12_000_000,
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "small_business_owner",
        priority: 80,
        minimumIncomeShare: { self_employment: 0.6 },
        minimumProductiveAssetsCentsPerCapita: 2_000_000,
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "civil_servant",
        priority: 70,
        minimumGovernmentJobShare: 0.6,
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "farmer",
        priority: 60,
        minimumJobShare: { agriculture: 0.6 },
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "managerial",
        priority: 51,
        minimumJobShare: { senior_management: 0.6 },
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "managerial",
        priority: 50,
        minimumJobShare: { middle_management: 0.6 },
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "professional",
        priority: 40,
        minimumJobShare: { professional: 0.6 },
        minimumEducationShare: { tertiary: 0.5 },
        minimumSkillShare: { high: 0.5 },
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "skilled_worker",
        priority: 30,
        minimumJobShare: { skilled_technical: 0.6 },
        minimumSkillShare: { high: 0.5 },
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "office_worker",
        priority: 20,
        minimumJobShare: { office_clerical: 0.6 },
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "service_worker",
        priority: 10,
        minimumJobShare: { consumer_service: 0.6 },
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      },
      {
        sourceClassId: "*",
        targetClassId: "worker",
        priority: 0,
        minimumIncomeShare: { labor: 0.6 },
        delayMonths: 12,
        maximumTransferRatePerMonth: 0.01
      }
    ],
    consumptionProfiles: [
      { id: "standard", essentialNeedPerPersonCentsPerMonth: 100_000 },
      { id: "affluent", essentialNeedPerPersonCentsPerMonth: 250_000 }
    ],
    rates: {
      annualCrudeBirthRate: 0.014,
      annualMortalityRateByAge: Array.from({ length: 101 }, (_, age) =>
        age <= 14 ? 0.004 : age <= 24 ? 0.002 : age <= 44 ? 0.003 : age <= 64 ? 0.008 : 0.05
      ),
      monthlyEnrollmentRate: 0.01,
      educationCompletionRate: 0.9,
      monthlyTrainingRate: 0.01,
      monthlyStudentGraduationRate: 0.02
    },
    laborMarketParameters: {
      jobSearchRateAmongEmployed: 0,
      acceptanceRateFloor: 0.8,
      acceptanceRateRange: 0.4,
      monthlyWageAdjustmentRate: 0.05,
      legalMinimumWageCentsPerMonth: 50_000,
      configuredMaximumWageCentsPerMonth: 500_000,
      provinceSubsistenceCostCentsPerMonth: 150_000,
      maxCashDrawdownSharePerMonth: 0.02,
      populationTolerance: 1e-6
    }
  };
}
