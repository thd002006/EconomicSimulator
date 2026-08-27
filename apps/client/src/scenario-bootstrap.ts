import type { LoadedMapPack } from "@economic-simulator/map-runtime";
import type { ScenarioBootstrap, ScenarioMapSeed } from "@economic-simulator/simulation-core";

export function buildScenarioBootstrap(pack: LoadedMapPack): ScenarioBootstrap {
  if (pack.scenarioSeed !== undefined) {
    const seed: ScenarioMapSeed = {
      mapId: pack.scenarioSeed.mapId,
      provinces: pack.scenarioSeed.provinces.map((province) => ({
        id: province.id,
        ownerCountryId: province.ownerCountryId
      })),
      classSeeds: pack.scenarioSeed.classSeeds.map((classSeed) => ({
        provinceId: classSeed.provinceId,
        socialClassId: classSeed.socialClassId,
        populationPersons: classSeed.populationPersons,
        male: classSeed.male,
        female: classSeed.female,
        age: classSeed.age,
        education15Plus: classSeed.education15Plus,
        ...(classSeed.cashCents === undefined ? {} : { cashCents: classSeed.cashCents })
      }))
    };
    const demographicsByProvince = pack.demographics ?? {};
    return {
      mapId: pack.manifest.id,
      provinces: seed.provinces.map((province) => {
        const raw = demographicsByProvince[province.id];
        if (raw === undefined) {
          return { id: province.id, ownerCountryId: province.ownerCountryId };
        }
        return {
          id: province.id,
          ownerCountryId: province.ownerCountryId,
          demographics: {
            pop: raw.pop,
            male: raw.male,
            female: raw.female,
            age: raw.age,
            education15Plus: raw.education15Plus
          }
        };
      }),
      seed
    };
  }

  return {
    mapId: pack.manifest.id,
    provinces: pack.provinces.map((feature) => {
      const ownerCountryId = feature.properties.adm0A3;
      if (ownerCountryId === undefined || ownerCountryId === "") {
        return { id: feature.id, ownerCountryId: "UNK" };
      }
      const raw = pack.demographics?.[feature.id];
      if (raw === undefined) {
        return { id: feature.id, ownerCountryId };
      }
      return {
        id: feature.id,
        ownerCountryId,
        demographics: {
          pop: raw.pop,
          male: raw.male,
          female: raw.female,
          age: raw.age,
          education15Plus: raw.education15Plus
        }
      };
    })
  };
}
