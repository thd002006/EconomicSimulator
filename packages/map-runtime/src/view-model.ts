import type { LoadedMapPack } from "./load-map-pack.js";
import { ProvinceGridIndex } from "./spatial-index.js";
import type { MapFeature, MapViewModel, MapViewModelHooks, MapViewport } from "./types.js";

export function createDefaultViewport(width: number, height: number): MapViewport {
  return {
    centerLon: 10,
    centerLat: 20,
    zoom: Math.max(width, 1) / 360,
    width,
    height
  };
}

export function createMapViewModel(
  pack: LoadedMapPack,
  viewport: MapViewport,
  hooks: MapViewModelHooks = {}
): MapViewModel & {
  readonly provinceIndex: ProvinceGridIndex;
  hitTest(lon: number, lat: number): MapFeature | undefined;
  findProvince(id: string): MapFeature | undefined;
  getProvinceOwner(provinceId: string): string | undefined;
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
    cities: pack.cities,
    hoveredProvinceId: undefined,
    selectedProvinceId: undefined,
    viewport,
    hooks: mergedHooks,
    provinceIndex,
    getProvinceOwner,
    hitTest(lon: number, lat: number): MapFeature | undefined {
      return provinceIndex.hitTest(lon, lat);
    },
    findProvince(id: string): MapFeature | undefined {
      return byId.get(id);
    }
  };
}
