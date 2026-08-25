import type { LoadedMapPack } from "./load-map-pack.js";
import { ProvinceGridIndex } from "./spatial-index.js";
import type { MapViewModel, MapViewModelHooks, ProvinceFeature } from "./types.js";

export function createMapViewModel(
  pack: LoadedMapPack,
  hooks: MapViewModelHooks = {}
): MapViewModel & {
  readonly provinceIndex: ProvinceGridIndex;
  hitTest(lon: number, lat: number): ProvinceFeature | undefined;
  findProvince(id: string): ProvinceFeature | undefined;
  getProvinceOwner(provinceId: string): string | undefined;
  getCountryName(ownerId: string): string | undefined;
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
    hoveredProvinceId: undefined,
    selectedProvinceId: undefined,
    globeMesh: pack.globeMesh,
    hooks: mergedHooks,
    provinceIndex,
    getProvinceOwner,
    getCountryName(ownerId: string): string | undefined {
      const entry = pack.countries[ownerId];
      if (entry === undefined) return undefined;
      return entry.nameEn ?? entry.name;
    },
    hitTest(lon: number, lat: number): ProvinceFeature | undefined {
      return provinceIndex.hitTest(lon, lat);
    },
    findProvince(id: string): ProvinceFeature | undefined {
      return byId.get(id);
    }
  };
}
