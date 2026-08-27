import type { LoadedMapPack } from "./load-map-pack.js";
import { ProvinceGridIndex } from "./spatial-index.js";
import type {
  CountryAggregate,
  MapViewModel,
  MapViewModelHooks,
  ProvinceDemographicsEntry,
  ProvinceFeature
} from "./types.js";

function buildCountryAggregates(
  pack: LoadedMapPack,
  getProvinceOwner: (provinceId: string) => string | undefined
): ReadonlyMap<string, CountryAggregate> {
  const totals = new Map<string, { provinceCount: number; pop: number; gdpPpp: number }>();
  for (const feature of pack.provinces) {
    const ownerId = getProvinceOwner(feature.id);
    if (ownerId === undefined) continue;
    const demo = pack.demographics?.[feature.id];
    const current = totals.get(ownerId) ?? { provinceCount: 0, pop: 0, gdpPpp: 0 };
    current.provinceCount += 1;
    current.pop += demo?.pop ?? 0;
    current.gdpPpp += demo?.gdpPpp ?? 0;
    totals.set(ownerId, current);
  }
  return totals;
}

export function createMapViewModel(
  pack: LoadedMapPack,
  hooks: MapViewModelHooks = {}
): MapViewModel & {
  readonly provinceIndex: ProvinceGridIndex;
  hitTest(lon: number, lat: number): ProvinceFeature | undefined;
  findProvince(id: string): ProvinceFeature | undefined;
  getProvinceOwner(provinceId: string): string | undefined;
  getCountryName(ownerId: string): string | undefined;
  getProvinceDemographics(provinceId: string): ProvinceDemographicsEntry | undefined;
  getCountryAggregate(ownerId: string): CountryAggregate | undefined;
} {
  const byId = new Map(pack.provinces.map((feature) => [feature.id, feature]));
  const provinceIndex = ProvinceGridIndex.fromPrecomputed(pack.provinces, pack.spatialIndex);

  const getProvinceOwner = (provinceId: string): string | undefined => {
    const hooked = hooks.getProvinceOwner?.(provinceId);
    if (hooked !== undefined) {
      return hooked;
    }
    return byId.get(provinceId)?.properties.adm0A3;
  };

  const countryAggregates = buildCountryAggregates(pack, getProvinceOwner);

  const mergedHooks: MapViewModelHooks = {
    ...hooks,
    getProvinceOwner
  };

  return {
    mapId: pack.manifest.id,
    provinces: pack.provinces,
    coastlines: pack.coastlines,
    boundaries: pack.boundaries,
    countries: pack.countries,
    globeMesh: pack.globeMesh,
    hooks: mergedHooks,
    provinceIndex,
    getProvinceOwner,
    getCountryName(ownerId: string): string | undefined {
      const entry = pack.countries[ownerId];
      if (entry === undefined) return undefined;
      return entry.nameEn ?? entry.name;
    },
    getProvinceDemographics(provinceId: string): ProvinceDemographicsEntry | undefined {
      return pack.demographics?.[provinceId];
    },
    getCountryAggregate(ownerId: string): CountryAggregate | undefined {
      return countryAggregates.get(ownerId);
    },
    hitTest(lon: number, lat: number): ProvinceFeature | undefined {
      return provinceIndex.hitTest(lon, lat);
    },
    findProvince(id: string): ProvinceFeature | undefined {
      return byId.get(id);
    }
  };
}
