import { POPULATION_DATA_PACK } from "@economic-simulator/game-data";
import { createPopulationWorld, validatePopulationStaticData } from "./population/index.js";
import type { ObservedProvinceDemographics } from "./population/state.js";
import type { PopulationStaticData, PopulationWorld } from "./population/types.js";
import type {
  CountryId,
  ProvinceId,
  ScenarioBootstrap,
  ScenarioProvinceDemographics
} from "./types.js";

export interface GameWorldV1 {
  readonly mapId: string;
  readonly population: PopulationWorld;
  readonly provinceOwnership: ReadonlyMap<ProvinceId, CountryId>;
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

export function bootstrapGameWorld(scenario: ScenarioBootstrap): GameWorldV1 {
  const provinceOwnership = new Map<ProvinceId, CountryId>();
  const provinceDemographics: Record<string, ObservedProvinceDemographics> = {};
  const provinceIds: ProvinceId[] = [];

  for (const province of scenario.provinces) {
    provinceIds.push(province.id);
    provinceOwnership.set(province.id, province.ownerCountryId);
    if (province.demographics !== undefined) {
      provinceDemographics[province.id] = toObservedDemographics(province.demographics);
    }
  }

  const staticData = validatePopulationStaticData(POPULATION_DATA_PACK as unknown as PopulationStaticData);
  const population = createPopulationWorld(provinceIds, staticData, undefined, {
    provinceDemographics
  });

  return {
    mapId: scenario.mapId,
    population,
    provinceOwnership
  };
}
