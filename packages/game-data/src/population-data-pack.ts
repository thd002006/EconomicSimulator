import { z } from "zod";
import socialClassesJson from "../data/population/social-classes.json";
import jobTypesJson from "../data/population/job-types.json";
import classTransitionRulesJson from "../data/population/class-transition-rules.json";
import consumptionProfilesJson from "../data/population/consumption-profiles.json";
import ratesJson from "../data/population/population-rates.json";
import laborMarketParametersJson from "../data/population/labor-market-parameters.json";

export const POPULATION_DATA_PACK_VERSION = "population-v1";

const probabilitySchema = z.number().min(0).max(1);

export const SocialClassDefinitionSchema = z.object({
  id: z.string().min(1),
  nameKey: z.string().min(1),
  laborParticipationBaseRate: probabilitySchema,
  reservationWageMultiplier: z.number().positive(),
  jobCompatibilityByCategory: z.record(z.string(), probabilitySchema),
  consumptionProfileId: z.string().min(1),
  savingPropensity: probabilitySchema
});

export const JobTypeDefinitionSchema = z.object({
  id: z.string().min(1),
  categoryId: z.enum([
    "agriculture",
    "basic_industrial",
    "skilled_technical",
    "consumer_service",
    "office_clerical",
    "professional",
    "middle_management",
    "senior_management"
  ]),
  minimumEducation: z.enum(["basic", "secondary", "tertiary", "advanced"]),
  minimumSkill: z.enum(["low", "medium", "high", "expert"]),
  productivityMultiplier: z.number().positive(),
  workingConditionScore: z.number().positive()
});

export const ClassTransitionRuleDefinitionSchema = z.object({
  sourceClassId: z.string().min(1),
  targetClassId: z.string().min(1),
  priority: z.number(),
  minimumJobShare: z.record(z.string(), probabilitySchema).optional(),
  minimumGovernmentJobShare: probabilitySchema.optional(),
  minimumIncomeShare: z.record(z.string(), probabilitySchema).optional(),
  minimumCombinedIncomeShare: z
    .object({
      categories: z.array(z.string().min(1)).min(1),
      share: probabilitySchema
    })
    .optional(),
  minimumEducationShare: z.record(z.string(), probabilitySchema).optional(),
  minimumSkillShare: z.record(z.string(), probabilitySchema).optional(),
  minimumProductiveAssetsCentsPerCapita: z.number().nonnegative().optional(),
  minimumPassiveAssetsCentsPerCapita: z.number().nonnegative().optional(),
  delayMonths: z.number().int().nonnegative(),
  maximumTransferRatePerMonth: probabilitySchema
});

export const ConsumptionProfileDefinitionSchema = z.object({
  id: z.string().min(1),
  essentialNeedPerPersonCentsPerMonth: z.number().nonnegative()
});

export const PopulationRatesSchema = z.object({
  annualCrudeBirthRate: probabilitySchema,
  annualMortalityRateByAgeBand: z.record(z.string(), z.number().min(0).max(0.5)),
  ageBandDurationMonths: z.record(z.string(), z.number()),
  monthlyEnrollmentRate: probabilitySchema,
  educationCompletionRate: probabilitySchema,
  monthlyTrainingRate: probabilitySchema,
  monthlyStudentGraduationRate: probabilitySchema
});

export const LaborMarketParametersSchema = z.object({
  jobSearchRateAmongEmployed: probabilitySchema,
  acceptanceRateFloor: probabilitySchema,
  acceptanceRateRange: z.number().positive(),
  monthlyWageAdjustmentRate: probabilitySchema,
  legalMinimumWageCentsPerMonth: z.number().positive(),
  configuredMaximumWageCentsPerMonth: z.number().positive(),
  provinceSubsistenceCostCentsPerMonth: z.number().positive(),
  maxCashDrawdownSharePerMonth: probabilitySchema,
  populationTolerance: z.number().positive()
});

export const PopulationDataPackSchema = z.object({
  dataPackVersion: z.string().min(1),
  socialClasses: z.array(SocialClassDefinitionSchema),
  jobTypes: z.array(JobTypeDefinitionSchema),
  classTransitionRules: z.array(ClassTransitionRuleDefinitionSchema),
  consumptionProfiles: z.array(ConsumptionProfileDefinitionSchema),
  rates: PopulationRatesSchema,
  laborMarketParameters: LaborMarketParametersSchema
});

export const POPULATION_DATA_PACK_RAW = PopulationDataPackSchema.parse({
  dataPackVersion: POPULATION_DATA_PACK_VERSION,
  socialClasses: socialClassesJson,
  jobTypes: jobTypesJson,
  classTransitionRules: classTransitionRulesJson,
  consumptionProfiles: consumptionProfilesJson,
  rates: ratesJson,
  laborMarketParameters: laborMarketParametersJson
});

export const POPULATION_DATA_PACK = {
  ...POPULATION_DATA_PACK_RAW,
  rates: {
    ...POPULATION_DATA_PACK_RAW.rates,
    ageBandDurationMonths: Object.fromEntries(
      Object.entries(POPULATION_DATA_PACK_RAW.rates.ageBandDurationMonths).map(([band, months]) => [
        band,
        months < 0 ? Number.POSITIVE_INFINITY : months
      ])
    )
  }
};

export type PopulationDataPack = z.infer<typeof PopulationDataPackSchema>;
