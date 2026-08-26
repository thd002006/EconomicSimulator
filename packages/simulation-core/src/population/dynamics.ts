import {
  AGE_BANDS,
  BALANCE_SHEET_FIELDS,
  EDUCATION_LEVELS,
  SKILL_LEVELS,
  type AgeBandId,
  type ClassTransitionRuleDefinition,
  type EducationLevelId,
  type EquityReclassificationEvent,
  type ExogenousMigrationCommand,
  type InheritanceEvent,
  type PopulationClassState,
  type PopulationWorld,
  type SkillLevelId,
  type SocialClassId
} from "./types";
import {
  createEmptyClassState,
  laborForcePopulation,
  moveProportion,
  ORDINARY_BALANCE_SHEET_FIELDS,
  workingAgePopulation
} from "./state";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function skillLevelIndex(level: SkillLevelId): number {
  return SKILL_LEVELS.indexOf(level);
}

const AGE_BAND_TRANSITIONS: readonly (readonly [AgeBandId, AgeBandId])[] = [
  ["child_0_14", "youth_15_24"],
  ["youth_15_24", "prime_25_44"],
  ["prime_25_44", "mature_45_64"],
  ["mature_45_64", "senior_65_plus"]
];

const SKILL_MINIMUM_EDUCATION_INDEX: Readonly<Record<SkillLevelId, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  expert: 3
};

function sortedProvinceIds(world: PopulationWorld): string[] {
  return [...world.classStatesByProvince.keys()].sort();
}

function scaleClassAllocations(
  world: PopulationWorld,
  provinceId: string,
  socialClassId: SocialClassId,
  factor: number
): void {
  for (const allocation of world.allocations.values()) {
    if (allocation.provinceId === provinceId && allocation.socialClassId === socialClassId) {
      allocation.employedFte *= factor;
    }
  }
}

export function updateEducationAndSkills(world: PopulationWorld): void {
  for (const provinceId of sortedProvinceIds(world)) {
    const classes = world.classStatesByProvince.get(provinceId);
    if (!classes) {
      continue;
    }

    const shortageBySkillIndex: number[] = [];
    for (let level = 1; level < SKILL_LEVELS.length; level += 1) {
      let desired = 0;
      let filled = 0;
      for (const [employerId, employer] of world.employers) {
        if (world.employerProvinces.get(employerId) !== provinceId) {
          continue;
        }
        for (const demand of employer.jobDemands) {
          const jobType = world.jobTypeById.get(demand.jobTypeId);
          if (jobType && skillLevelIndex(jobType.minimumSkill) >= level) {
            desired += demand.desiredFte;
          }
        }
      }
      for (const allocation of world.allocations.values()) {
        if (allocation.provinceId !== provinceId) {
          continue;
        }
        const jobType = world.jobTypeById.get(allocation.jobTypeId);
        if (jobType && skillLevelIndex(jobType.minimumSkill) >= level) {
          filled += allocation.employedFte;
        }
      }
      const unfilled = Math.max(0, desired - filled);
      shortageBySkillIndex[level] = desired > 0 ? clamp(unfilled / desired, 0, 1) : 0;
    }

    for (const socialClassId of [...classes.keys()].sort()) {
      const state = classes.get(socialClassId);
      if (!state) {
        continue;
      }

      for (let index = 0; index < EDUCATION_LEVELS.length - 1; index += 1) {
        const source = EDUCATION_LEVELS[index] as EducationLevelId;
        const target = EDUCATION_LEVELS[index + 1] as EducationLevelId;
        const graduates =
          state.workingAgeEducationCounts[source] *
          world.staticData.rates.monthlyEnrollmentRate *
          world.staticData.rates.educationCompletionRate;
        state.workingAgeEducationCounts[source] -= graduates;
        state.workingAgeEducationCounts[target] += graduates;
      }

      const workingAge = workingAgePopulation(state);
      for (let index = 0; index < SKILL_LEVELS.length - 1; index += 1) {
        const source = SKILL_LEVELS[index] as SkillLevelId;
        const target = SKILL_LEVELS[index + 1] as SkillLevelId;
        const requiredEducationIndex = SKILL_MINIMUM_EDUCATION_INDEX[target];
        let educated = 0;
        for (let edu = requiredEducationIndex; edu < EDUCATION_LEVELS.length; edu += 1) {
          educated += state.workingAgeEducationCounts[EDUCATION_LEVELS[edu] as EducationLevelId];
        }
        const compatibility = workingAge > 0 ? educated / workingAge : 0;
        const upgraded =
          state.laborForceSkillCounts[source] *
          world.staticData.rates.monthlyTrainingRate *
          compatibility *
          (shortageBySkillIndex[index + 1] ?? 0);
        state.laborForceSkillCounts[source] -= upgraded;
        state.laborForceSkillCounts[target] += upgraded;
      }
    }
  }
}

interface ClassTransitionMetrics {
  totalEmployedFte: number;
  jobFteByCategory: Map<string, number>;
  governmentEmployedFte: number;
  grossIncomeCents: number;
  incomeCentsByCategory: Map<string, number>;
  productiveAssetsCentsPerCapita: number;
  passiveAssetsCentsPerCapita: number;
}

const INCOME_FIELD_BY_CATEGORY: Readonly<Record<string, string>> = {
  labor: "laborIncomeCents",
  self_employment: "selfEmploymentIncomeCents",
  business: "businessIncomeCents",
  capital: "capitalIncomeCents",
  rent: "rentIncomeCents",
  transfer: "transferIncomeCents"
};

function measureClassTransitionMetrics(
  world: PopulationWorld,
  state: PopulationClassState
): ClassTransitionMetrics {
  const metrics: ClassTransitionMetrics = {
    totalEmployedFte: 0,
    jobFteByCategory: new Map(),
    governmentEmployedFte: 0,
    grossIncomeCents: 0,
    incomeCentsByCategory: new Map(),
    productiveAssetsCentsPerCapita: 0,
    passiveAssetsCentsPerCapita: 0
  };

  for (const allocation of world.allocations.values()) {
    if (
      allocation.provinceId !== state.provinceId ||
      allocation.socialClassId !== state.socialClassId
    ) {
      continue;
    }
    const jobType = world.jobTypeById.get(allocation.jobTypeId);
    const category = jobType?.categoryId ?? "office_clerical";
    metrics.totalEmployedFte += allocation.employedFte;
    metrics.jobFteByCategory.set(
      category,
      (metrics.jobFteByCategory.get(category) ?? 0) + allocation.employedFte
    );
    if (world.governmentEmployerIds.has(allocation.employerId)) {
      metrics.governmentEmployedFte += allocation.employedFte;
    }
  }

  const income = state.currentPeriodIncome;
  for (const category of Object.keys(INCOME_FIELD_BY_CATEGORY)) {
    const amount = income[INCOME_FIELD_BY_CATEGORY[category] as keyof typeof income];
    metrics.grossIncomeCents += amount;
    metrics.incomeCentsByCategory.set(category, amount);
  }

  const population = state.populationPersons;
  metrics.productiveAssetsCentsPerCapita =
    population > 0 ? state.balanceSheet.businessEquityCents / population : 0;
  metrics.passiveAssetsCentsPerCapita =
    population > 0
      ? (state.balanceSheet.securitiesCents + state.balanceSheet.rentalPropertyCents) / population
      : 0;

  return metrics;
}

function evaluateRuleThresholds(
  state: PopulationClassState,
  rule: ClassTransitionRuleDefinition,
  metrics: ClassTransitionMetrics
): { satisfied: boolean; eligibleShare: number } {
  const shares: number[] = [];

  if (rule.minimumJobShare) {
    for (const category of Object.keys(rule.minimumJobShare)) {
      const minimum = rule.minimumJobShare[category as keyof typeof rule.minimumJobShare] ?? 0;
      const share =
        metrics.totalEmployedFte > 0
          ? (metrics.jobFteByCategory.get(category) ?? 0) / metrics.totalEmployedFte
          : 0;
      if (share < minimum) {
        return { satisfied: false, eligibleShare: 0 };
      }
      shares.push(share);
    }
  }

  if (rule.minimumGovernmentJobShare !== undefined) {
    const share =
      metrics.totalEmployedFte > 0 ? metrics.governmentEmployedFte / metrics.totalEmployedFte : 0;
    if (share < rule.minimumGovernmentJobShare) {
      return { satisfied: false, eligibleShare: 0 };
    }
    shares.push(share);
  }

  if (rule.minimumIncomeShare) {
    for (const category of Object.keys(rule.minimumIncomeShare)) {
      const minimum =
        rule.minimumIncomeShare[category as keyof typeof rule.minimumIncomeShare] ?? 0;
      const share =
        metrics.grossIncomeCents > 0
          ? (metrics.incomeCentsByCategory.get(category) ?? 0) / metrics.grossIncomeCents
          : 0;
      if (share < minimum) {
        return { satisfied: false, eligibleShare: 0 };
      }
      shares.push(share);
    }
  }

  if (rule.minimumCombinedIncomeShare) {
    const minimum = rule.minimumCombinedIncomeShare.share;
    let combined = 0;
    for (const category of rule.minimumCombinedIncomeShare.categories) {
      combined += metrics.incomeCentsByCategory.get(category) ?? 0;
    }
    const share = metrics.grossIncomeCents > 0 ? combined / metrics.grossIncomeCents : 0;
    if (share < minimum) {
      return { satisfied: false, eligibleShare: 0 };
    }
    shares.push(share);
  }

  if (rule.minimumEducationShare) {
    const workingAge = workingAgePopulation(state);
    for (const level of Object.keys(rule.minimumEducationShare)) {
      const minimum =
        rule.minimumEducationShare[level as keyof typeof rule.minimumEducationShare] ?? 0;
      let meeting = 0;
      for (
        let index = EDUCATION_LEVELS.indexOf(level as EducationLevelId);
        index < EDUCATION_LEVELS.length;
        index += 1
      ) {
        meeting += state.workingAgeEducationCounts[EDUCATION_LEVELS[index] as EducationLevelId];
      }
      const share = workingAge > 0 ? meeting / workingAge : 0;
      if (share < minimum) {
        return { satisfied: false, eligibleShare: 0 };
      }
      shares.push(share);
    }
  }

  if (rule.minimumSkillShare) {
    const laborForce = laborForcePopulation(state);
    for (const level of Object.keys(rule.minimumSkillShare)) {
      const minimum = rule.minimumSkillShare[level as keyof typeof rule.minimumSkillShare] ?? 0;
      let meeting = 0;
      for (
        let index = SKILL_LEVELS.indexOf(level as SkillLevelId);
        index < SKILL_LEVELS.length;
        index += 1
      ) {
        meeting += state.laborForceSkillCounts[SKILL_LEVELS[index] as SkillLevelId];
      }
      const share = laborForce > 0 ? meeting / laborForce : 0;
      if (share < minimum) {
        return { satisfied: false, eligibleShare: 0 };
      }
      shares.push(share);
    }
  }

  if (
    rule.minimumProductiveAssetsCentsPerCapita !== undefined &&
    metrics.productiveAssetsCentsPerCapita < rule.minimumProductiveAssetsCentsPerCapita
  ) {
    return { satisfied: false, eligibleShare: 0 };
  }

  if (
    rule.minimumPassiveAssetsCentsPerCapita !== undefined &&
    metrics.passiveAssetsCentsPerCapita < rule.minimumPassiveAssetsCentsPerCapita
  ) {
    return { satisfied: false, eligibleShare: 0 };
  }

  return { satisfied: true, eligibleShare: shares.length > 0 ? Math.min(...shares) : 1 };
}

export function rekeyAllocations(
  world: PopulationWorld,
  provinceId: string,
  fromSocialClassId: SocialClassId,
  toSocialClassId: SocialClassId,
  share: number
): void {
  for (const key of [...world.allocations.keys()]) {
    const allocation = world.allocations.get(key);
    if (
      !allocation ||
      allocation.provinceId !== provinceId ||
      allocation.socialClassId !== fromSocialClassId
    ) {
      continue;
    }
    const movedFte = allocation.employedFte * share;
    allocation.employedFte -= movedFte;
    if (allocation.employedFte <= 1e-9) {
      world.allocations.delete(key);
    }
    const targetKey = `${provinceId}|${allocation.employerId}|${allocation.jobTypeId}|${toSocialClassId}|${allocation.arrangement}`;
    const target = world.allocations.get(targetKey);
    if (target) {
      target.employedFte += movedFte;
    } else {
      world.allocations.set(targetKey, {
        provinceId,
        employerId: allocation.employerId,
        jobTypeId: allocation.jobTypeId,
        socialClassId: toSocialClassId,
        arrangement: allocation.arrangement,
        employedFte: movedFte,
        paidMonthlyWageCentsPerFte: allocation.paidMonthlyWageCentsPerFte
      });
    }
  }
}

export function runClassTransitions(world: PopulationWorld): EquityReclassificationEvent[] {
  const equityReclassifications: EquityReclassificationEvent[] = [];
  const orderedRules = [...world.staticData.classTransitionRules].sort(
    (first, second) =>
      second.priority - first.priority || first.targetClassId.localeCompare(second.targetClassId)
  );

  for (const provinceId of sortedProvinceIds(world)) {
    const classes = world.classStatesByProvince.get(provinceId);
    if (!classes) {
      continue;
    }

    for (const sourceClassId of [...classes.keys()].sort()) {
      const source = classes.get(sourceClassId);
      if (!source || source.populationPersons <= 0) {
        continue;
      }

      const metrics = measureClassTransitionMetrics(world, source);
      const applicableRules = orderedRules.filter(
        (rule) =>
          (rule.sourceClassId === "*" || rule.sourceClassId === sourceClassId) &&
          rule.targetClassId !== sourceClassId
      );
      const maximumRate = Math.max(
        0,
        ...applicableRules.map((rule) => rule.maximumTransferRatePerMonth)
      );
      let remainingBudget = source.populationPersons * maximumRate;

      const satisfiedRuleByTarget = new Map<string, ClassTransitionRuleDefinition>();
      const eligibleShareByTarget = new Map<string, number>();
      const targetsWithFailedRule = new Set<string>();
      for (const rule of applicableRules) {
        const evaluation = evaluateRuleThresholds(source, rule, metrics);
        if (!evaluation.satisfied) {
          targetsWithFailedRule.add(rule.targetClassId);
          continue;
        }
        if (!satisfiedRuleByTarget.has(rule.targetClassId)) {
          satisfiedRuleByTarget.set(rule.targetClassId, rule);
          eligibleShareByTarget.set(rule.targetClassId, evaluation.eligibleShare);
        }
      }

      for (const targetClassId of targetsWithFailedRule) {
        if (!satisfiedRuleByTarget.has(targetClassId)) {
          delete source.classTransitionProgress[targetClassId];
        }
      }

      for (const [targetClassId, rule] of satisfiedRuleByTarget) {
        const progress = (source.classTransitionProgress[targetClassId] ?? 0) + 1;
        source.classTransitionProgress[targetClassId] = progress;
        if (progress < rule.delayMonths) {
          continue;
        }

        const transfer = Math.min(
          source.populationPersons * (eligibleShareByTarget.get(targetClassId) ?? 0),
          source.populationPersons * rule.maximumTransferRatePerMonth,
          remainingBudget
        );
        if (transfer <= 1e-9 || transfer >= source.populationPersons) {
          continue;
        }

        let target = classes.get(targetClassId);
        if (!target) {
          target = createEmptyClassState(provinceId, targetClassId);
          classes.set(targetClassId, target);
        }

        const share = transfer / source.populationPersons;
        moveProportion(source, target, share, ORDINARY_BALANCE_SHEET_FIELDS);
        rekeyAllocations(world, provinceId, sourceClassId, targetClassId, share);
        equityReclassifications.push({
          fromProvinceId: provinceId,
          toProvinceId: provinceId,
          fromSocialClassId: sourceClassId,
          toSocialClassId: targetClassId,
          reason: "class_transition",
          sourceShare: share
        });
        remainingBudget -= transfer;
      }
    }
  }
  return equityReclassifications;
}

export function runVitalEvents(world: PopulationWorld): InheritanceEvent[] {
  const inheritanceEvents: InheritanceEvent[] = [];
  for (const provinceId of sortedProvinceIds(world)) {
    const classes = world.classStatesByProvince.get(provinceId);
    if (!classes) {
      continue;
    }

    for (const socialClassId of [...classes.keys()].sort()) {
      const state = classes.get(socialClassId);
      if (!state || state.populationPersons <= 0) {
        continue;
      }

      const graduations =
        state.employmentStatusCounts.student * world.staticData.rates.monthlyStudentGraduationRate;
      state.employmentStatusCounts.student -= graduations;
      state.employmentStatusCounts.unemployed += graduations;
      state.laborForceSkillCounts.low += graduations;

      const births = state.populationPersons * (world.staticData.rates.annualCrudeBirthRate / 12);
      if (births > 0) {
        const birthFactor = (state.populationPersons + births) / state.populationPersons;
        for (const gender of Object.keys(state.genderCounts)) {
          state.genderCounts[gender as keyof typeof state.genderCounts] *= birthFactor;
        }
        for (const ethnicity of Object.keys(state.ethnicityCounts)) {
          state.ethnicityCounts[ethnicity] = (state.ethnicityCounts[ethnicity] ?? 0) * birthFactor;
        }
        for (const religion of Object.keys(state.religionCounts)) {
          state.religionCounts[religion] = (state.religionCounts[religion] ?? 0) * birthFactor;
        }
        state.ageCounts.child_0_14 += births;
        state.employmentStatusCounts.not_in_labor_force += births;
        state.populationPersons += births;
      }

      let totalDeaths = 0;
      let workingAgeDeaths = 0;
      for (const band of AGE_BANDS) {
        const deaths =
          state.ageCounts[band] * (world.staticData.rates.annualMortalityRateByAgeBand[band] / 12);
        state.ageCounts[band] -= deaths;
        totalDeaths += deaths;
        if (band !== "child_0_14" && band !== "senior_65_plus") {
          workingAgeDeaths += deaths;
        }
      }
      if (totalDeaths > 1e-12) {
        state.populationPersons -= totalDeaths;
        const populationBeforeDeaths = state.populationPersons + totalDeaths;

        for (const gender of Object.keys(state.genderCounts)) {
          state.genderCounts[gender as keyof typeof state.genderCounts] *=
            state.populationPersons / populationBeforeDeaths;
        }
        for (const ethnicity of Object.keys(state.ethnicityCounts)) {
          state.ethnicityCounts[ethnicity] =
            (state.ethnicityCounts[ethnicity] ?? 0) *
            (state.populationPersons / populationBeforeDeaths);
        }
        for (const religion of Object.keys(state.religionCounts)) {
          state.religionCounts[religion] =
            (state.religionCounts[religion] ?? 0) *
            (state.populationPersons / populationBeforeDeaths);
        }

        let inheritedAssetsCents = 0;
        let deceasedInvestmentBookValueCents = 0;
        let inheritedDebtCents = 0;
        const survivalFactor = state.populationPersons / populationBeforeDeaths;
        const inheritanceShare = totalDeaths / populationBeforeDeaths;
        for (const field of BALANCE_SHEET_FIELDS) {
          const deceased = state.balanceSheet[field] * inheritanceShare;
          if (field === "mortgageDebtCents" || field === "otherDebtCents") {
            inheritedDebtCents += deceased;
            state.balanceSheet[field] *= survivalFactor;
          } else if (field === "securitiesCents" || field === "businessEquityCents") {
            // 投资账面不按比例扣减：留在原 Class，由 Equity 模块按事件原子重分类（§11.3 协议）。
            deceasedInvestmentBookValueCents += deceased;
          } else {
            inheritedAssetsCents += deceased;
            state.balanceSheet[field] *= survivalFactor;
          }
        }
        inheritanceEvents.push({
          provinceId,
          socialClassId,
          deceasedPersons: totalDeaths,
          inheritedAssetsCents,
          inheritedInvestmentBookValueCents: deceasedInvestmentBookValueCents,
          inheritedDebtCents
        });

        const workingAgeAfter = workingAgePopulation(state);
        if (workingAgeAfter + workingAgeDeaths > 0) {
          const educationFactor = workingAgeAfter / (workingAgeAfter + workingAgeDeaths);
          for (const level of EDUCATION_LEVELS) {
            state.workingAgeEducationCounts[level] *= educationFactor;
          }
        }

        const laborForceBefore = laborForcePopulation(state);
        const nonLaborForceBefore =
          state.employmentStatusCounts.student +
          state.employmentStatusCounts.retired +
          state.employmentStatusCounts.not_in_labor_force;
        const workingAgeBefore = workingAgeAfter + workingAgeDeaths;
        const laborDeaths =
          workingAgeBefore > 0 && laborForceBefore > 0
            ? laborForceBefore * (workingAgeDeaths / workingAgeBefore)
            : 0;
        const nonLaborDeaths = Math.max(0, totalDeaths - laborDeaths);

        if (laborForceBefore > 1e-12) {
          const laborSurvivalFactor = (laborForceBefore - laborDeaths) / laborForceBefore;
          state.employmentStatusCounts.employed *= laborSurvivalFactor;
          state.employmentStatusCounts.unemployed *= laborSurvivalFactor;
          scaleClassAllocations(world, provinceId, socialClassId, laborSurvivalFactor);
          for (const level of SKILL_LEVELS) {
            state.laborForceSkillCounts[level] *= laborSurvivalFactor;
          }
        }
        if (nonLaborForceBefore > 1e-12) {
          const nonLaborSurvivalFactor =
            (nonLaborForceBefore - nonLaborDeaths) / nonLaborForceBefore;
          state.employmentStatusCounts.student *= nonLaborSurvivalFactor;
          state.employmentStatusCounts.retired *= nonLaborSurvivalFactor;
          state.employmentStatusCounts.not_in_labor_force *= nonLaborSurvivalFactor;
        }
      }

      for (const [band, nextBand] of AGE_BAND_TRANSITIONS) {
        const duration = world.staticData.rates.ageBandDurationMonths[band];
        if (!Number.isFinite(duration)) {
          continue;
        }
        const movers = state.ageCounts[band] / duration;
        if (movers <= 0) {
          continue;
        }
        const workingAgeBefore = band === "mature_45_64" ? workingAgePopulation(state) : 0;
        const laborForceBefore = band === "mature_45_64" ? laborForcePopulation(state) : 0;
        state.ageCounts[band] -= movers;
        state.ageCounts[nextBand] += movers;

        if (band === "child_0_14") {
          state.employmentStatusCounts.not_in_labor_force -= movers;
          state.employmentStatusCounts.student += movers;
          state.workingAgeEducationCounts.basic += movers;
        } else if (band === "mature_45_64") {
          if (workingAgeBefore > 0) {
            const educationFactor = (workingAgeBefore - movers) / workingAgeBefore;
            for (const level of EDUCATION_LEVELS) {
              state.workingAgeEducationCounts[level] *= educationFactor;
            }
          }
          const nonLaborForceBefore =
            state.employmentStatusCounts.student +
            state.employmentStatusCounts.retired +
            state.employmentStatusCounts.not_in_labor_force;
          if (laborForceBefore > 0 && workingAgeBefore > 0 && state.populationPersons > 0) {
            const laborLoss = Math.min(movers * (laborForceBefore / workingAgeBefore), movers);
            const laborFactor = (laborForceBefore - laborLoss) / laborForceBefore;
            state.employmentStatusCounts.employed *= laborFactor;
            state.employmentStatusCounts.unemployed *= laborFactor;
            for (const level of SKILL_LEVELS) {
              state.laborForceSkillCounts[level] *= laborFactor;
            }
            scaleClassAllocations(world, provinceId, socialClassId, laborFactor);
            const nonLaborLoss = movers - laborLoss;
            if (nonLaborForceBefore > 1e-12 && nonLaborLoss > 0) {
              const nonLaborFactor = (nonLaborForceBefore - nonLaborLoss) / nonLaborForceBefore;
              state.employmentStatusCounts.student *= nonLaborFactor;
              state.employmentStatusCounts.retired *= nonLaborFactor;
              state.employmentStatusCounts.not_in_labor_force *= nonLaborFactor;
            }
          } else if (nonLaborForceBefore > 1e-12 && movers <= nonLaborForceBefore) {
            const nonLaborFactor = (nonLaborForceBefore - movers) / nonLaborForceBefore;
            state.employmentStatusCounts.student *= nonLaborFactor;
            state.employmentStatusCounts.retired *= nonLaborFactor;
            state.employmentStatusCounts.not_in_labor_force *= nonLaborFactor;
          } else {
            state.employmentStatusCounts.student = 0;
            state.employmentStatusCounts.retired = 0;
            state.employmentStatusCounts.not_in_labor_force = 0;
          }
          state.employmentStatusCounts.retired += movers;
        }
      }
    }
  }
  return inheritanceEvents;
}

export function applyExogenousMigration(
  world: PopulationWorld,
  command: ExogenousMigrationCommand
): EquityReclassificationEvent | undefined {
  const sourceClasses = world.classStatesByProvince.get(command.fromProvinceId);
  const source = sourceClasses?.get(command.socialClassId);
  if (!source || source.populationPersons <= 0) {
    return undefined;
  }

  const persons = clamp(command.persons, 0, source.populationPersons);
  if (persons <= 0) {
    return undefined;
  }

  let targetClasses = world.classStatesByProvince.get(command.toProvinceId);
  if (!targetClasses) {
    targetClasses = new Map();
    world.classStatesByProvince.set(command.toProvinceId, targetClasses);
  }
  let target = targetClasses.get(command.socialClassId);
  if (!target) {
    target = createEmptyClassState(command.toProvinceId, command.socialClassId);
    targetClasses.set(command.socialClassId, target);
  }

  const employedBefore = target.employmentStatusCounts.employed;
  const share = persons / source.populationPersons;
  moveProportion(source, target, share, command.includeAssets ? ORDINARY_BALANCE_SHEET_FIELDS : []);

  const migratedEmployed = target.employmentStatusCounts.employed - employedBefore;
  if (migratedEmployed > 0) {
    target.employmentStatusCounts.employed -= migratedEmployed;
    target.employmentStatusCounts.unemployed += migratedEmployed;
  }

  pruneAllocations(world, command.fromProvinceId, command.socialClassId, share);

  if (!command.includeAssets) {
    return undefined;
  }
  return {
    fromProvinceId: command.fromProvinceId,
    toProvinceId: command.toProvinceId,
    fromSocialClassId: command.socialClassId,
    toSocialClassId: command.socialClassId,
    reason: "migration",
    sourceShare: share
  };
}

function pruneAllocations(
  world: PopulationWorld,
  provinceId: string,
  socialClassId: SocialClassId,
  share: number
): void {
  for (const key of [...world.allocations.keys()]) {
    const allocation = world.allocations.get(key);
    if (
      !allocation ||
      allocation.provinceId !== provinceId ||
      allocation.socialClassId !== socialClassId
    ) {
      continue;
    }
    allocation.employedFte *= 1 - share;
    if (allocation.employedFte <= 1e-9) {
      world.allocations.delete(key);
    }
  }
}
