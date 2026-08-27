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
    for (const [band, value] of Object.entries(seed.age)) {
      if (band in state.ageCounts) {
        state.ageCounts[band as keyof typeof state.ageCounts] = value;
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

  return {
    mapId: scenario.mapId,
    population,
    provinceOwnership,
    ledger: createLedgerWorld(),
    equity: createEquityWorld(),
    operatingUnits: createOperatingUnitWorld(),
    companies: createCompanyWorld(),
    externalShareholders: createExternalShareholderAccounts()
  };
}
