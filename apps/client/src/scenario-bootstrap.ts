import type { LoadedMapPack } from "@economic-simulator/map-runtime";
import type { ScenarioBootstrap } from "@economic-simulator/simulation-core";

export function buildScenarioBootstrap(pack: LoadedMapPack): ScenarioBootstrap {
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
