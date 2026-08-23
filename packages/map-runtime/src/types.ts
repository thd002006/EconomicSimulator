export interface GeoJsonInspection {
  readonly featureCount: number;
  readonly geometryCounts: Readonly<Record<string, number>>;
  readonly featureIds: readonly string[];
}

export type LonLat = readonly [number, number];

export interface MapPackProvenance {
  readonly toolVersion: string;
  readonly naturalEarthCommit: string | null;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly assetHashes: Readonly<Record<string, string>>;
  readonly outputHash: string;
  readonly builtAt: string;
}

export interface MapPackManifest {
  readonly schemaVersion: number;
  readonly format: string;
  readonly id: string;
  readonly version: string;
  readonly nameKey: string;
  readonly coordinateReferenceSystem: string;
  readonly assets: Readonly<{
    provinces: string;
    boundaries: string;
    coastlines?: string;
    cities?: string;
    spatialIndex: string;
  }>;
  readonly lodTolerances: readonly number[];
  readonly provenance: MapPackProvenance;
}

export interface MapFeatureProperties {
  readonly name?: string;
  readonly nameEn?: string;
  readonly adm0A3?: string;
  readonly isoA2?: string;
  readonly type?: string;
  readonly scalerank?: number;
  readonly [key: string]: unknown;
}

export type GeoJsonGeometry =
  | { readonly type: "Point"; readonly coordinates: LonLat }
  | { readonly type: "MultiPoint"; readonly coordinates: readonly LonLat[] }
  | { readonly type: "LineString"; readonly coordinates: readonly LonLat[] }
  | { readonly type: "MultiLineString"; readonly coordinates: readonly LonLat[][] }
  | { readonly type: "Polygon"; readonly coordinates: readonly LonLat[][] }
  | { readonly type: "MultiPolygon"; readonly coordinates: readonly LonLat[][][] };

export interface MapFeature {
  readonly id: string;
  readonly properties: MapFeatureProperties;
  readonly geometry: GeoJsonGeometry;
  readonly bbox: readonly [number, number, number, number];
  readonly lod?: readonly GeoJsonGeometry[];
}

export interface MapBoundary {
  readonly id: string;
  readonly leftProvinceId: string;
  readonly rightProvinceId: string | null;
  readonly coordinates: LonLat[];
}

export interface SpatialIndexData {
  readonly cellSizeDegrees: number;
  readonly cells: Readonly<Record<string, readonly string[]>>;
}

export interface MapViewport {
  centerLon: number;
  centerLat: number;
  /** Screen pixels per degree of longitude. */
  zoom: number;
  width: number;
  height: number;
}

export interface MapViewModelHooks {
  getProvinceFill?(provinceId: string): string | undefined;
  /** Stable owner id used to style shared boundaries as province vs country borders. */
  getProvinceOwner?(provinceId: string): string | undefined;
}

export interface MapViewModel {
  readonly mapId: string;
  readonly provinces: readonly MapFeature[];
  readonly coastlines: readonly MapFeature[];
  readonly boundaries: readonly MapBoundary[];
  readonly cities: readonly MapFeature[];
  hoveredProvinceId: string | undefined;
  selectedProvinceId: string | undefined;
  readonly viewport: MapViewport;
  readonly hooks: MapViewModelHooks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inspectFeatureCollection(input: unknown): GeoJsonInspection {
  if (!isRecord(input) || input.type !== "FeatureCollection" || !Array.isArray(input.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection.");
  }

  const ids = new Set<string>();
  const geometryCounts: Record<string, number> = {};

  for (const [index, feature] of input.features.entries()) {
    if (!isRecord(feature) || feature.type !== "Feature") {
      throw new Error(`Feature ${index} is invalid.`);
    }
    if (typeof feature.id !== "string" && typeof feature.id !== "number") {
      throw new Error(`Feature ${index} must have a stable string or number ID.`);
    }
    const id = String(feature.id);
    if (ids.has(id)) {
      throw new Error(`Duplicate GeoJSON feature ID: ${id}.`);
    }
    ids.add(id);

    if (!isRecord(feature.geometry) || typeof feature.geometry.type !== "string") {
      throw new Error(`Feature ${id} has invalid geometry.`);
    }
    geometryCounts[feature.geometry.type] = (geometryCounts[feature.geometry.type] ?? 0) + 1;
  }

  return {
    featureCount: input.features.length,
    geometryCounts,
    featureIds: [...ids].sort()
  };
}
