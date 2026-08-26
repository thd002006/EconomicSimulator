import {
  AGE_BANDS,
  EDUCATION_LEVELS,
  INCOME_CATEGORIES,
  JOB_CATEGORIES,
  SKILL_LEVELS,
  type AgeBandId,
  type ClassTransitionRuleDefinition,
  type IncomeCategoryId,
  type JobCategoryId,
  type JobTypeDefinition,
  type PopulationStaticData,
  type SocialClassDefinition
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function fail(message: string): never {
  throw new Error(`Invalid population static data: ${message}`);
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array.`);
  }
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} must be a finite number.`);
  }
  return value;
}

function expectProbability(value: unknown, label: string): number {
  const number = expectNumber(value, label);
  if (number < 0 || number > 1) {
    fail(`${label} must be within [0, 1], got ${number}.`);
  }
  return number;
}

function expectPositive(value: unknown, label: string): number {
  const number = expectNumber(value, label);
  if (number <= 0) {
    fail(`${label} must be positive, got ${number}.`);
  }
  return number;
}

function expectNonNegative(value: unknown, label: string): number {
  const number = expectNumber(value, label);
  if (number < 0) {
    fail(`${label} must be non-negative, got ${number}.`);
  }
  return number;
}

function expectEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const text = expectString(value, label);
  if (!(allowed as readonly string[]).includes(text)) {
    fail(`${label} must be one of ${allowed.join(", ")}, got "${text}".`);
  }
  return text as T;
}

function validateSocialClass(raw: unknown, label: string): SocialClassDefinition {
  const record = expectObject(raw, label);
  const compatibility = expectObject(
    record.jobCompatibilityByCategory,
    `${label}.jobCompatibilityByCategory`
  );
  const jobCompatibilityByCategory = {} as Record<string, number>;
  for (const category of JOB_CATEGORIES) {
    jobCompatibilityByCategory[category] = expectProbability(
      compatibility[category],
      `${label}.jobCompatibilityByCategory.${category}`
    );
  }
  return {
    id: expectString(record.id, `${label}.id`),
    nameKey: expectString(record.nameKey, `${label}.nameKey`),
    laborParticipationBaseRate: expectProbability(
      record.laborParticipationBaseRate,
      `${label}.laborParticipationBaseRate`
    ),
    reservationWageMultiplier: expectPositive(
      record.reservationWageMultiplier,
      `${label}.reservationWageMultiplier`
    ),
    jobCompatibilityByCategory: jobCompatibilityByCategory as Record<JobCategoryId, number>,
    consumptionProfileId: expectString(
      record.consumptionProfileId,
      `${label}.consumptionProfileId`
    ),
    savingPropensity: expectProbability(record.savingPropensity, `${label}.savingPropensity`)
  };
}

function validateJobType(raw: unknown, label: string): JobTypeDefinition {
  const record = expectObject(raw, label);
  return {
    id: expectString(record.id, `${label}.id`),
    categoryId: expectEnum(record.categoryId, JOB_CATEGORIES, `${label}.categoryId`),
    minimumEducation: expectEnum(
      record.minimumEducation,
      EDUCATION_LEVELS,
      `${label}.minimumEducation`
    ),
    minimumSkill: expectEnum(record.minimumSkill, SKILL_LEVELS, `${label}.minimumSkill`),
    productivityMultiplier: expectPositive(
      record.productivityMultiplier,
      `${label}.productivityMultiplier`
    ),
    workingConditionScore: expectPositive(
      record.workingConditionScore,
      `${label}.workingConditionScore`
    )
  };
}

export function validateClassTransitionRule(
  raw: unknown,
  label: string,
  knownClassIds: ReadonlySet<string>
): ClassTransitionRuleDefinition {
  const record = expectObject(raw, label);
  const sourceClassId = expectString(record.sourceClassId, `${label}.sourceClassId`);
  if (sourceClassId !== "*" && !knownClassIds.has(sourceClassId)) {
    fail(`${label}.sourceClassId references unknown social class "${sourceClassId}".`);
  }
  const targetClassId = expectString(record.targetClassId, `${label}.targetClassId`);
  if (!knownClassIds.has(targetClassId)) {
    fail(`${label}.targetClassId references unknown social class "${targetClassId}".`);
  }

  let thresholdCount = 0;
  let rule: ClassTransitionRuleDefinition = {
    sourceClassId,
    targetClassId,
    priority: expectNumber(record.priority, `${label}.priority`),
    delayMonths: expectNonNegative(
      expectNumber(record.delayMonths, `${label}.delayMonths`),
      `${label}.delayMonths`
    ),
    maximumTransferRatePerMonth: expectProbability(
      record.maximumTransferRatePerMonth,
      `${label}.maximumTransferRatePerMonth`
    )
  };

  const shareField = (field: string): Record<string, number> | undefined => {
    const raw2 = record[field];
    if (raw2 === undefined) {
      return undefined;
    }
    const result: Record<string, number> = {};
    for (const key of Object.keys(expectObject(raw2, `${label}.${field}`))) {
      result[key] = expectProbability(
        (raw2 as Record<string, unknown>)[key],
        `${label}.${field}.${key}`
      );
    }
    thresholdCount += Object.keys(result).length;
    return result;
  };

  const jobShare = shareField("minimumJobShare");
  if (jobShare) {
    for (const category of Object.keys(jobShare)) {
      expectEnum(category, JOB_CATEGORIES, `${label}.minimumJobShare key`);
    }
    rule = { ...rule, minimumJobShare: jobShare };
  }

  if (record.minimumGovernmentJobShare !== undefined) {
    rule = {
      ...rule,
      minimumGovernmentJobShare: expectProbability(
        record.minimumGovernmentJobShare,
        `${label}.minimumGovernmentJobShare`
      )
    };
    thresholdCount += 1;
  }

  const incomeShare = shareField("minimumIncomeShare");
  if (incomeShare) {
    for (const category of Object.keys(incomeShare)) {
      expectEnum(category, INCOME_CATEGORIES, `${label}.minimumIncomeShare key`);
    }
    rule = { ...rule, minimumIncomeShare: incomeShare };
  }

  if (record.minimumCombinedIncomeShare !== undefined) {
    const combined = expectObject(
      record.minimumCombinedIncomeShare,
      `${label}.minimumCombinedIncomeShare`
    );
    const categories = expectArray(
      combined.categories,
      `${label}.minimumCombinedIncomeShare.categories`
    );
    if (categories.length === 0) {
      fail(`${label}.minimumCombinedIncomeShare.categories must not be empty.`);
    }
    for (const category of categories) {
      expectEnum(
        category,
        INCOME_CATEGORIES,
        `${label}.minimumCombinedIncomeShare.categories entry`
      );
    }
    rule = {
      ...rule,
      minimumCombinedIncomeShare: {
        categories: categories as readonly IncomeCategoryId[],
        share: expectProbability(combined.share, `${label}.minimumCombinedIncomeShare.share`)
      }
    };
    thresholdCount += 1;
  }

  const educationShare = shareField("minimumEducationShare");
  if (educationShare) {
    for (const level of Object.keys(educationShare)) {
      expectEnum(level, EDUCATION_LEVELS, `${label}.minimumEducationShare key`);
    }
    rule = { ...rule, minimumEducationShare: educationShare };
  }

  const skillShare = shareField("minimumSkillShare");
  if (skillShare) {
    for (const level of Object.keys(skillShare)) {
      expectEnum(level, SKILL_LEVELS, `${label}.minimumSkillShare key`);
    }
    rule = { ...rule, minimumSkillShare: skillShare };
  }

  if (record.minimumProductiveAssetsCentsPerCapita !== undefined) {
    rule = {
      ...rule,
      minimumProductiveAssetsCentsPerCapita: expectNonNegative(
        record.minimumProductiveAssetsCentsPerCapita,
        `${label}.minimumProductiveAssetsCentsPerCapita`
      )
    };
    thresholdCount += 1;
  }

  if (record.minimumPassiveAssetsCentsPerCapita !== undefined) {
    rule = {
      ...rule,
      minimumPassiveAssetsCentsPerCapita: expectNonNegative(
        record.minimumPassiveAssetsCentsPerCapita,
        `${label}.minimumPassiveAssetsCentsPerCapita`
      )
    };
    thresholdCount += 1;
  }

  if (thresholdCount === 0) {
    fail(`${label} must define at least one threshold.`);
  }
  return rule;
}

export function validatePopulationStaticData(input: unknown): PopulationStaticData {
  const data = expectObject(input, "population static data");

  const socialClasses = expectArray(data.socialClasses, "socialClasses").map((entry, index) =>
    validateSocialClass(entry, `socialClasses[${index}]`)
  );
  if (socialClasses.length !== 11) {
    fail(`exactly 11 social classes are required, got ${socialClasses.length}.`);
  }
  const classIds = new Set(socialClasses.map((definition) => definition.id));
  if (classIds.size !== socialClasses.length) {
    fail("social class IDs must be unique.");
  }

  const consumptionProfiles = expectArray(data.consumptionProfiles, "consumptionProfiles").map(
    (entry, index) => {
      const record = expectObject(entry, `consumptionProfiles[${index}]`);
      return {
        id: expectString(record.id, `consumptionProfiles[${index}].id`),
        essentialNeedPerPersonCentsPerMonth: expectNonNegative(
          record.essentialNeedPerPersonCentsPerMonth,
          `consumptionProfiles[${index}].essentialNeedPerPersonCentsPerMonth`
        )
      };
    }
  );
  const profileIds = new Set(consumptionProfiles.map((profile) => profile.id));
  for (const definition of socialClasses) {
    if (!profileIds.has(definition.consumptionProfileId)) {
      fail(
        `social class "${definition.id}" references unknown consumption profile "${definition.consumptionProfileId}".`
      );
    }
  }

  const jobTypes = expectArray(data.jobTypes, "jobTypes").map((entry, index) =>
    validateJobType(entry, `jobTypes[${index}]`)
  );
  const jobTypeIds = new Set(jobTypes.map((jobType) => jobType.id));
  if (jobTypeIds.size !== jobTypes.length) {
    fail("job type IDs must be unique.");
  }

  const classTransitionRules = expectArray(data.classTransitionRules, "classTransitionRules").map(
    (entry, index) => validateClassTransitionRule(entry, `classTransitionRules[${index}]`, classIds)
  );

  const rates = expectObject(data.rates, "rates");
  const mortality = expectObject(
    rates.annualMortalityRateByAgeBand,
    "rates.annualMortalityRateByAgeBand"
  );
  const annualMortalityRateByAgeBand = {} as Record<AgeBandId, number>;
  for (const band of AGE_BANDS) {
    annualMortalityRateByAgeBand[band] = expectProbability(
      mortality[band],
      `rates.annualMortalityRateByAgeBand.${band}`
    );
    if (annualMortalityRateByAgeBand[band] > 0.5) {
      fail(`rates.annualMortalityRateByAgeBand.${band} has an unreasonable upper bound.`);
    }
  }
  const durations = expectObject(rates.ageBandDurationMonths, "rates.ageBandDurationMonths");
  const ageBandDurationMonths = {} as Record<AgeBandId, number>;
  for (const band of AGE_BANDS) {
    const months = durations[band];
    if (typeof months !== "number" || (!Number.isFinite(months) && band !== "senior_65_plus")) {
      fail(`rates.ageBandDurationMonths.${band} must be a finite month count.`);
    }
    if (months <= 0 && Number.isFinite(months)) {
      fail(`rates.ageBandDurationMonths.${band} must be positive.`);
    }
    ageBandDurationMonths[band] = months;
  }

  const parameters = expectObject(data.laborMarketParameters, "laborMarketParameters");
  const legalMinimumWageCentsPerMonth = expectPositive(
    parameters.legalMinimumWageCentsPerMonth,
    "laborMarketParameters.legalMinimumWageCentsPerMonth"
  );
  const configuredMaximumWageCentsPerMonth = expectPositive(
    parameters.configuredMaximumWageCentsPerMonth,
    "laborMarketParameters.configuredMaximumWageCentsPerMonth"
  );
  if (legalMinimumWageCentsPerMonth > configuredMaximumWageCentsPerMonth) {
    fail(
      "laborMarketParameters.legalMinimumWageCentsPerMonth exceeds configuredMaximumWageCentsPerMonth."
    );
  }

  return {
    dataPackVersion: expectString(data.dataPackVersion, "dataPackVersion"),
    socialClasses,
    jobTypes,
    classTransitionRules,
    consumptionProfiles,
    rates: {
      annualCrudeBirthRate: expectProbability(
        rates.annualCrudeBirthRate,
        "rates.annualCrudeBirthRate"
      ),
      annualMortalityRateByAgeBand,
      ageBandDurationMonths,
      monthlyEnrollmentRate: expectProbability(
        rates.monthlyEnrollmentRate,
        "rates.monthlyEnrollmentRate"
      ),
      educationCompletionRate: expectProbability(
        rates.educationCompletionRate,
        "rates.educationCompletionRate"
      ),
      monthlyTrainingRate: expectProbability(
        rates.monthlyTrainingRate,
        "rates.monthlyTrainingRate"
      ),
      monthlyStudentGraduationRate: expectProbability(
        rates.monthlyStudentGraduationRate,
        "rates.monthlyStudentGraduationRate"
      )
    },
    laborMarketParameters: {
      jobSearchRateAmongEmployed: expectProbability(
        parameters.jobSearchRateAmongEmployed,
        "laborMarketParameters.jobSearchRateAmongEmployed"
      ),
      acceptanceRateFloor: expectProbability(
        parameters.acceptanceRateFloor,
        "laborMarketParameters.acceptanceRateFloor"
      ),
      acceptanceRateRange: expectPositive(
        parameters.acceptanceRateRange,
        "laborMarketParameters.acceptanceRateRange"
      ),
      monthlyWageAdjustmentRate: expectProbability(
        parameters.monthlyWageAdjustmentRate,
        "laborMarketParameters.monthlyWageAdjustmentRate"
      ),
      legalMinimumWageCentsPerMonth,
      configuredMaximumWageCentsPerMonth,
      provinceSubsistenceCostCentsPerMonth: expectPositive(
        parameters.provinceSubsistenceCostCentsPerMonth,
        "laborMarketParameters.provinceSubsistenceCostCentsPerMonth"
      ),
      maxCashDrawdownSharePerMonth: expectProbability(
        parameters.maxCashDrawdownSharePerMonth,
        "laborMarketParameters.maxCashDrawdownSharePerMonth"
      ),
      populationTolerance: expectPositive(
        parameters.populationTolerance,
        "laborMarketParameters.populationTolerance"
      )
    }
  };
}
