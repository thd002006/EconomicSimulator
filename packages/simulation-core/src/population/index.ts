import {
  applyExogenousMigration,
  runClassTransitions,
  runVitalEvents,
  updateEducationAndSkills
} from "./dynamics";
export {
  applyExogenousMigration,
  runClassTransitions,
  runVitalEvents,
  updateEducationAndSkills
} from "./dynamics";
export { collectEmploymentAllocationViolations } from "./labor";
import { runLaborMarketStep, collectEmploymentAllocationViolations } from "./labor";
import {
  DEFAULT_CLASS_POPULATION_SHARES,
  laborForcePopulation,
  seedClassState,
  sumRecord,
  workingAgePopulation,
  type ObservedProvinceDemographics
} from "./state";
import { validatePopulationStaticData } from "./static-data";
export { validatePopulationStaticData } from "./static-data";
export { DEFAULT_CLASS_POPULATION_SHARES } from "./state";
export type { ObservedProvinceDemographics } from "./state";
import {
  AGE_BANDS,
  type AgeBandId,
  type ClassConsumptionPlan,
  type EmployerId,
  type EmployerState,
  type EquityReclassificationEvent,
  type ExogenousMigrationCommand,
  type JobDemandState,
  type MonthlyPopulationStepResult,
  type PopulationClassState,
  type PopulationIncomeAccumulator,
  type PopulationStaticData,
  type PopulationWorld,
  type ProvinceId,
  type ProvinceLaborMarketSummary,
  type ProvincePopulationSummary
} from "./types";

export function createPopulationWorld(
  provinces: readonly ProvinceId[],
  staticData: PopulationStaticData,
  initialClassPopulations?: Readonly<Record<ProvinceId, Partial<Record<string, number>>>>,
  options?: {
    readonly governmentEmployerIds?: readonly EmployerId[];
    readonly employerWageMultipliers?: Readonly<Record<EmployerId, number>>;
    readonly provinceDemographics?: Readonly<Record<ProvinceId, ObservedProvinceDemographics>>;
  }
): PopulationWorld {
  const validated = validatePopulationStaticData(staticData);
  const world: PopulationWorld = {
    staticData: validated,
    socialClassById: new Map(
      validated.socialClasses.map((definition) => [definition.id, definition])
    ),
    jobTypeById: new Map(validated.jobTypes.map((definition) => [definition.id, definition])),
    consumptionProfileById: new Map(
      validated.consumptionProfiles.map((profile) => [profile.id, profile])
    ),
    classStatesByProvince: new Map(),
    employers: new Map(),
    employerProvinces: new Map(),
    governmentEmployerIds: new Set(options?.governmentEmployerIds ?? []),
    employerWageMultipliers: new Map(Object.entries(options?.employerWageMultipliers ?? {})),
    allocations: new Map(),
    referenceWages: new Map()
  };

  for (const provinceId of provinces) {
    world.classStatesByProvince.set(provinceId, new Map());
    let populations = initialClassPopulations?.[provinceId] as
      | Partial<Record<string, number>>
      | undefined;
    // If demographics are supplied and no explicit class populations were given,
    // derive them from the uniform default class ratio.
    if (
      (!populations || Object.keys(populations).length === 0) &&
      options?.provinceDemographics?.[provinceId]
    ) {
      const provincePop = options.provinceDemographics[provinceId]!.pop;
      if (provincePop > 0) {
        populations = Object.fromEntries(
          validated.socialClasses.map((definition) => [
            definition.id,
            provincePop * (DEFAULT_CLASS_POPULATION_SHARES[definition.id] ?? 0)
          ])
        ) as Partial<Record<string, number>>;
      }
    }
    const normalizedPopulations = populations ?? {};
    const specifiedTotal = Object.values(normalizedPopulations).reduce<number>(
      (total, persons) => total + (persons ?? 0),
      0
    );
    if (specifiedTotal <= 0) {
      continue;
    }
    const observed = options?.provinceDemographics?.[provinceId];
    for (const definition of validated.socialClasses) {
      const persons = normalizedPopulations[definition.id];
      if (!persons || persons <= 0) {
        continue;
      }
      world.classStatesByProvince
        .get(provinceId)
        ?.set(
          definition.id,
          seedClassState(
            provinceId,
            definition.id,
            persons,
            definition.laborParticipationBaseRate,
            observed
          )
        );
    }
  }

  return world;
}

export function setEmployer(
  world: PopulationWorld,
  provinceId: ProvinceId,
  employer: EmployerState
): void {
  world.employers.set(employer.id, employer);
  world.employerProvinces.set(employer.id, provinceId);
}

export function removeEmployer(world: PopulationWorld, employerId: EmployerId): void {
  for (const [key, allocation] of [...world.allocations.entries()]) {
    if (allocation.employerId !== employerId) {
      continue;
    }
    const state = world.classStatesByProvince
      .get(allocation.provinceId)
      ?.get(allocation.socialClassId);
    if (state) {
      state.employmentStatusCounts.employed -= allocation.employedFte;
      state.employmentStatusCounts.unemployed += allocation.employedFte;
    }
    world.allocations.delete(key);
  }
  world.employers.delete(employerId);
  world.employerProvinces.delete(employerId);
  world.governmentEmployerIds.delete(employerId);
}

export function upsertJobDemand(
  world: PopulationWorld,
  employerId: EmployerId,
  demand: JobDemandState
): void {
  const employer = world.employers.get(employerId);
  if (!employer) {
    throw new Error(`Unknown employer: ${employerId}.`);
  }
  const existing = employer.jobDemands.find(
    (candidate) =>
      candidate.jobTypeId === demand.jobTypeId && candidate.arrangement === demand.arrangement
  );
  if (existing) {
    existing.desiredFte = demand.desiredFte;
    existing.offeredMonthlyWageCentsPerFte = demand.offeredMonthlyWageCentsPerFte;
  } else {
    employer.jobDemands.push({ ...demand });
  }
}

/** 调用方必须处理返回的 EquityReclassificationEvent（携带资产迁移时非 undefined），交给 Equity 模块执行重分类。 */
export function applyExogenousMigrationCommand(
  world: PopulationWorld,
  command: ExogenousMigrationCommand
): EquityReclassificationEvent | undefined {
  return applyExogenousMigration(world, command);
}

export function applyClassIncomeEvent(
  world: PopulationWorld,
  provinceId: ProvinceId,
  socialClassId: string,
  entry: Partial<PopulationIncomeAccumulator>
): void {
  const state = getClassState(world, provinceId, socialClassId);
  if (!state) {
    throw new Error(`Unknown population class: ${provinceId}|${socialClassId}.`);
  }
  const income = state.currentPeriodIncome;
  income.laborIncomeCents += entry.laborIncomeCents ?? 0;
  income.selfEmploymentIncomeCents += entry.selfEmploymentIncomeCents ?? 0;
  income.businessIncomeCents += entry.businessIncomeCents ?? 0;
  income.capitalIncomeCents += entry.capitalIncomeCents ?? 0;
  income.rentIncomeCents += entry.rentIncomeCents ?? 0;
  income.transferIncomeCents += entry.transferIncomeCents ?? 0;
  income.taxesPaidCents += entry.taxesPaidCents ?? 0;
}

function getClassState(
  world: PopulationWorld,
  provinceId: ProvinceId,
  socialClassId: string
): PopulationClassState | undefined {
  return world.classStatesByProvince.get(provinceId)?.get(socialClassId);
}

/**
 * 月度人口步骤，阶段顺序固定（对应 Scheduler 挂接点 §13）：
 * 1. 10e — 依据本月收入累计器生成消费计划（此时收入尚未清零）；
 * 2. 11b — 教育/技能流动 → 阶层流动（读取本期收入份额）→ 出生/死亡/年龄推进；
 * 3. 11c — 裁员、招聘、参考工资与下月报价；
 * 4. 步骤末尾才清零 `currentPeriodIncome`。
 * 下游必须在同一步骤内消费 `consumptionPlans`；跨 Tick 使用属未定义行为。
 */
export function runMonthlyPopulationStep(world: PopulationWorld): MonthlyPopulationStepResult {
  const consumptionPlans = collectConsumptionPlans(world);

  updateEducationAndSkills(world);
  const equityReclassifications = runClassTransitions(world);
  const inheritanceEvents = runVitalEvents(world);
  runLaborMarketStep(world);

  for (const classes of world.classStatesByProvince.values()) {
    for (const state of classes.values()) {
      state.currentPeriodIncome = {
        laborIncomeCents: 0,
        selfEmploymentIncomeCents: 0,
        businessIncomeCents: 0,
        capitalIncomeCents: 0,
        rentIncomeCents: 0,
        transferIncomeCents: 0,
        taxesPaidCents: 0
      };
    }
  }

  return { consumptionPlans, inheritanceEvents, equityReclassifications };
}

function collectConsumptionPlans(world: PopulationWorld): ClassConsumptionPlan[] {
  const consumptionPlans: ClassConsumptionPlan[] = [];
  for (const provinceId of [...world.classStatesByProvince.keys()].sort()) {
    const classes = world.classStatesByProvince.get(provinceId);
    if (!classes) {
      continue;
    }
    for (const socialClassId of [...classes.keys()].sort()) {
      const state = classes.get(socialClassId);
      if (!state || state.populationPersons <= 0) {
        continue;
      }
      consumptionPlans.push(buildConsumptionPlan(world, state));
    }
  }
  return consumptionPlans;
}

function buildConsumptionPlan(
  world: PopulationWorld,
  state: PopulationClassState
): ClassConsumptionPlan {
  const income = state.currentPeriodIncome;
  const preTaxIncome =
    income.laborIncomeCents +
    income.selfEmploymentIncomeCents +
    income.businessIncomeCents +
    income.capitalIncomeCents +
    income.rentIncomeCents +
    income.transferIncomeCents;
  const disposableIncomeCents = preTaxIncome - income.taxesPaidCents;
  const allowedCashDrawdown =
    Math.max(0, state.balanceSheet.cashCents) *
    world.staticData.laborMarketParameters.maxCashDrawdownSharePerMonth;
  const resourcesAvailableCents = disposableIncomeCents + allowedCashDrawdown;

  let essentialNeedPerPerson = 0;
  const definition = world.socialClassById.get(state.socialClassId);
  if (definition) {
    essentialNeedPerPerson =
      world.consumptionProfileById.get(definition.consumptionProfileId)
        ?.essentialNeedPerPersonCentsPerMonth ?? 0;
  }
  const essentialBudgetCents = Math.min(
    resourcesAvailableCents,
    essentialNeedPerPerson * state.populationPersons
  );
  const discretionaryBudgetCents =
    Math.max(0, resourcesAvailableCents - essentialBudgetCents) *
    (1 - (definition?.savingPropensity ?? 0));

  return {
    provinceId: state.provinceId,
    socialClassId: state.socialClassId,
    disposableIncomeCents,
    resourcesAvailableCents,
    essentialBudgetCents,
    discretionaryBudgetCents
  };
}

export interface PopulationInvariantReport {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

export function getPopulationInvariantReport(world: PopulationWorld): PopulationInvariantReport {
  const violations: string[] = [];
  const tolerance = world.staticData.laborMarketParameters.populationTolerance;

  for (const provinceId of [...world.classStatesByProvince.keys()].sort()) {
    const classes = world.classStatesByProvince.get(provinceId);
    if (!classes) {
      continue;
    }
    for (const [socialClassId, state] of classes) {
      const label = `${provinceId}|${socialClassId}`;
      const values = [
        state.populationPersons,
        ...Object.values(state.ageCounts),
        ...Object.values(state.genderCounts),
        ...Object.values(state.workingAgeEducationCounts),
        ...Object.values(state.laborForceSkillCounts),
        ...Object.values(state.employmentStatusCounts),
        ...Object.values(state.ethnicityCounts),
        ...Object.values(state.religionCounts)
      ];
      for (const value of values) {
        if (!Number.isFinite(value)) {
          violations.push(`${label}: non-finite population value.`);
          break;
        }
      }
      if (state.populationPersons < -tolerance) {
        violations.push(`${label}: negative population.`);
      }
      const ageSum = sumRecord(state.ageCounts);
      if (Math.abs(ageSum - state.populationPersons) > tolerance) {
        violations.push(`${label}: ageCounts ${ageSum} != ${state.populationPersons}.`);
      }
      const genderSum = sumRecord(state.genderCounts);
      if (Math.abs(genderSum - state.populationPersons) > tolerance) {
        violations.push(`${label}: genderCounts mismatch.`);
      }
      const statusSum = sumRecord(state.employmentStatusCounts);
      if (Math.abs(statusSum - state.populationPersons) > tolerance) {
        violations.push(`${label}: employmentStatusCounts mismatch.`);
      }
      const ethnicitySum = sumRecord(state.ethnicityCounts);
      if (Math.abs(ethnicitySum - state.populationPersons) > tolerance) {
        violations.push(`${label}: ethnicityCounts mismatch.`);
      }
      const religionSum = sumRecord(state.religionCounts);
      if (Math.abs(religionSum - state.populationPersons) > tolerance) {
        violations.push(`${label}: religionCounts mismatch.`);
      }
      const educationSum = sumRecord(state.workingAgeEducationCounts);
      const workingAge = workingAgePopulation(state);
      if (Math.abs(educationSum - workingAge) > tolerance) {
        violations.push(`${label}: workingAgeEducationCounts mismatch.`);
      }
      const skillSum = sumRecord(state.laborForceSkillCounts);
      const laborForce = laborForcePopulation(state);
      if (Math.abs(skillSum - laborForce) > tolerance) {
        violations.push(`${label}: laborForceSkillCounts mismatch.`);
      }
      if (
        state.employmentStatusCounts.employed + state.employmentStatusCounts.unemployed >
        workingAge + tolerance
      ) {
        violations.push(`${label}: employed + unemployed exceeds working-age population.`);
      }
    }
  }

  violations.push(...collectEmploymentAllocationViolations(world));

  return { valid: violations.length === 0, violations };
}

export function getProvincePopulationSummary(
  world: PopulationWorld,
  provinceId: ProvinceId
): ProvincePopulationSummary {
  const classes = world.classStatesByProvince.get(provinceId);
  const populationBySocialClass: Record<string, number> = {};
  let populationPersons = 0;
  let workingAgePopulationTotal = 0;
  let employed = 0;
  let unemployed = 0;

  for (const definition of world.staticData.socialClasses) {
    populationBySocialClass[definition.id] = 0;
  }
  if (classes) {
    for (const [socialClassId, state] of classes) {
      populationBySocialClass[socialClassId] =
        (populationBySocialClass[socialClassId] ?? 0) + state.populationPersons;
      populationPersons += state.populationPersons;
      workingAgePopulationTotal += workingAgePopulation(state);
      employed += state.employmentStatusCounts.employed;
      unemployed += state.employmentStatusCounts.unemployed;
    }
  }

  const zeroIfNoDenominator = (numerator: number, denominator: number) =>
    denominator > 0 ? numerator / denominator : 0;

  return {
    provinceId,
    populationPersons,
    workingAgePopulation: workingAgePopulationTotal,
    laborForcePopulation: employed + unemployed,
    employedPersons: employed,
    unemployedPersons: unemployed,
    employmentRate: zeroIfNoDenominator(employed, workingAgePopulationTotal),
    unemploymentRate: zeroIfNoDenominator(unemployed, employed + unemployed),
    populationBySocialClass
  };
}

export function getProvinceLaborMarket(
  world: PopulationWorld,
  provinceId: ProvinceId
): ProvinceLaborMarketSummary {
  const desiredFteByJobType: Record<string, number> = {};
  const employedFteByJobType: Record<string, number> = {};

  for (const [employerId, employer] of world.employers) {
    if (world.employerProvinces.get(employerId) !== provinceId) {
      continue;
    }
    for (const demand of employer.jobDemands) {
      desiredFteByJobType[demand.jobTypeId] =
        (desiredFteByJobType[demand.jobTypeId] ?? 0) + demand.desiredFte;
    }
  }
  for (const allocation of world.allocations.values()) {
    if (allocation.provinceId !== provinceId) {
      continue;
    }
    employedFteByJobType[allocation.jobTypeId] =
      (employedFteByJobType[allocation.jobTypeId] ?? 0) + allocation.employedFte;
  }

  const unfilledVacancyFteByJobType: Record<string, number> = {};
  const referenceWageCentsByJobType: Record<string, number> = {};
  for (const jobTypeId of Object.keys(desiredFteByJobType)) {
    unfilledVacancyFteByJobType[jobTypeId] = Math.max(
      0,
      (desiredFteByJobType[jobTypeId] ?? 0) - (employedFteByJobType[jobTypeId] ?? 0)
    );
    referenceWageCentsByJobType[jobTypeId] =
      world.referenceWages.get(`${provinceId}|${jobTypeId}`) ?? 0;
  }

  return {
    provinceId,
    desiredFteByJobType,
    employedFteByJobType,
    unfilledVacancyFteByJobType,
    referenceWageCentsByJobType
  };
}

export interface ProvinceDemographicBreakdown {
  readonly provinceId: ProvinceId;
  readonly male: number;
  readonly female: number;
  readonly age: Readonly<Record<AgeBandId, number>>;
}

export interface CountryPopulationSummary {
  readonly countryId: string;
  readonly provinceCount: number;
  readonly populationPersons: number;
}

export function aggregateProvinceDemographics(
  world: PopulationWorld,
  provinceId: ProvinceId
): ProvinceDemographicBreakdown {
  const classes = world.classStatesByProvince.get(provinceId);
  const age = Object.fromEntries(AGE_BANDS.map((band) => [band, 0])) as Record<AgeBandId, number>;
  let male = 0;
  let female = 0;
  if (classes !== undefined) {
    for (const state of classes.values()) {
      male += state.genderCounts.male;
      female += state.genderCounts.female;
      for (const band of AGE_BANDS) {
        age[band] += state.ageCounts[band];
      }
    }
  }
  return { provinceId, male, female, age };
}

export function getCountryPopulationSummary(
  world: PopulationWorld,
  ownership: ReadonlyMap<ProvinceId, string>,
  countryId: string
): CountryPopulationSummary {
  let provinceCount = 0;
  let populationPersons = 0;
  for (const [provinceId, ownerCountryId] of ownership) {
    if (ownerCountryId !== countryId) continue;
    provinceCount += 1;
    populationPersons += getProvincePopulationSummary(world, provinceId).populationPersons;
  }
  return { countryId, provinceCount, populationPersons };
}
