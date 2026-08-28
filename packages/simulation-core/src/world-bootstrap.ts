import { POPULATION_DATA_PACK } from "@economic-simulator/game-data";
import {
  createCompanyWorld,
  createExternalShareholderAccounts,
  type CompanyWorld,
  type ExternalShareholderAccounts
} from "./company/index.js";
import { createEquityWorld, type EquityWorld } from "./equity/index.js";
import { createLedgerWorld, type LedgerWorld } from "./ledger/index.js";
import { createOperatingUnitWorld, type OperatingUnitWorld } from "./operating-unit/index.js";
import {
  createPopulationWorld,
  validatePopulationStaticData
} from "./population/index.js";
import type { ObservedProvinceDemographics } from "./population/state.js";
import type { PopulationStaticData, PopulationWorld } from "./population/types.js";
import type {
  CountryId,
  ProvinceId,
  ScenarioBootstrap,
  ScenarioClassSeed,
  ScenarioProvinceDemographics
} from "./types.js";

export interface GameWorldV1 {
  readonly mapId: string;
  readonly population: PopulationWorld;
  readonly provinceOwnership: ReadonlyMap<ProvinceId, CountryId>;
  readonly ledger: LedgerWorld;
  readonly equity: EquityWorld;
  readonly operatingUnits: OperatingUnitWorld;
  readonly companies: CompanyWorld;
  readonly externalShareholders: ExternalShareholderAccounts;
}

function toObservedDemographics(
  demographics: ScenarioProvinceDemographics
): ObservedProvinceDemographics {
  return {
    pop: demographics.pop,
    male: demographics.male,
    female: demographics.female,
    age: demographics.age as ObservedProvinceDemographics["age"],
    education15Plus:
      demographics.education15Plus as ObservedProvinceDemographics["education15Plus"]
  };
}

function applyClassSeedDetails(
  population: PopulationWorld,
  classSeeds: readonly ScenarioClassSeed[]
): void {
  for (const seed of classSeeds) {
    const state = population.classStatesByProvince
      .get(seed.provinceId)
      ?.get(seed.socialClassId);
    if (state === undefined) {
      throw new Error(
        `Scenario class seed missing population state: ${seed.provinceId}|${seed.socialClassId}.`
      );
    }
    const ageEntries = Object.entries(seed.age);
    if (ageEntries.length > 0) {
      const hasNumeric = ageEntries.some(([k]) => Number.isInteger(Number(k)));
      if (hasNumeric) {
        state.ageCounts.fill(0);
        for (const [key, value] of ageEntries) {
          const ageNum = Number(key);
          if (Number.isInteger(ageNum) && ageNum >= 0 && ageNum < state.ageCounts.length) {
            state.ageCounts[ageNum] = value;
          }
        }
      } else {
        state.ageCounts.fill(0);
        const c14 = (seed.age.child_0_14 ?? 0) / 15;
        const y24 = (seed.age.youth_15_24 ?? 0) / 10;
        const p44 = (seed.age.prime_25_44 ?? 0) / 20;
        const m64 = (seed.age.mature_45_64 ?? 0) / 20;
        const s100 = (seed.age.senior_65_plus ?? 0) / 36;
        for (let a = 0; a <= 14; a += 1) state.ageCounts[a] = c14;
        for (let a = 15; a <= 24; a += 1) state.ageCounts[a] = y24;
        for (let a = 25; a <= 44; a += 1) state.ageCounts[a] = p44;
        for (let a = 45; a <= 64; a += 1) state.ageCounts[a] = m64;
        for (let a = 65; a <= 100; a += 1) state.ageCounts[a] = s100;
      }
    }
    state.genderCounts.male = seed.male;
    state.genderCounts.female = seed.female;
    for (const [level, value] of Object.entries(seed.education15Plus)) {
      if (level in state.workingAgeEducationCounts) {
        state.workingAgeEducationCounts[level as keyof typeof state.workingAgeEducationCounts] =
          value;
      }
    }
    if (seed.cashCents !== undefined) {
      state.balanceSheet.cashCents = seed.cashCents;
    }
  }
}

export function bootstrapGameWorld(scenario: ScenarioBootstrap): GameWorldV1 {
  const provinceOwnership = new Map<ProvinceId, CountryId>();
  const provinceDemographics: Record<string, ObservedProvinceDemographics> = {};
  const provinceIds: ProvinceId[] = [];
  const initialClassPopulations: Record<string, Partial<Record<string, number>>> = {};

  for (const province of scenario.provinces) {
    provinceIds.push(province.id);
    provinceOwnership.set(province.id, province.ownerCountryId);
    if (province.demographics !== undefined) {
      provinceDemographics[province.id] = toObservedDemographics(province.demographics);
    }
  }

  if (scenario.seed !== undefined) {
    for (const classSeed of scenario.seed.classSeeds) {
      const bucket = (initialClassPopulations[classSeed.provinceId] ??= {});
      bucket[classSeed.socialClassId] = classSeed.populationPersons;
    }
  }

  const staticData = validatePopulationStaticData(
    POPULATION_DATA_PACK as unknown as PopulationStaticData
  );
  const population = createPopulationWorld(
    provinceIds,
    staticData,
    Object.keys(initialClassPopulations).length > 0 ? initialClassPopulations : undefined,
    { provinceDemographics }
  );

  if (scenario.seed !== undefined) {
    applyClassSeedDetails(population, scenario.seed.classSeeds);
  }

  const ledger = createLedgerWorld();
  const equity = createEquityWorld();
  const operatingUnits = createOperatingUnitWorld();
  const companies = createCompanyWorld();
  const externalShareholders = createExternalShareholderAccounts();

  return {
    mapId: scenario.mapId,
    population,
    provinceOwnership,
    ledger,
    equity,
    operatingUnits,
    companies,
    externalShareholders
  };
}
