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
}

export interface CountryNameEntry {
  readonly nameEn: string;
  readonly name?: string;
}

export type CountryNameTable = Readonly<Record<string, CountryNameEntry>>;

export const EDUCATION_LEVEL_IDS = ["basic", "secondary", "tertiary", "advanced"] as const;
export type EducationLevelId = (typeof EDUCATION_LEVEL_IDS)[number];

export interface ProvinceDemographicsEntry {
  readonly pop: number;
  readonly male: number;
  readonly female: number;
  readonly age: Readonly<Record<string, number>>;
  readonly education15Plus: Readonly<Record<EducationLevelId, number>>;
  readonly gdpPpp: number;
}

export type ProvinceDemographicsTable = Readonly<Record<string, ProvinceDemographicsEntry>>;

export interface CountryAggregate {
  readonly provinceCount: number;
  readonly pop: number;
  readonly gdpPpp: number;
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
    roads?: string;
    countries?: string;
    demographics?: string;
    provinceDefinitions?: string;
    scenarioSeed?: string;
    spatialIndex: string;
    globeMesh: string;
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

export interface ProvinceCapital {
  readonly coordinates: LonLat;
  readonly name?: string;
  readonly nameEn?: string;
}

export interface ProvinceFeatureProperties extends MapFeatureProperties {
  readonly capital: ProvinceCapital;
  readonly coreProvinceId?: string;
  /** Short English intro, ≤100 chars (excluding merger prefix). */
  readonly description?: string;
}

export type GeoJsonGeometry =
  | { readonly type: "Point"; readonly coordinates: LonLat }
  | { readonly type: "MultiPoint"; readonly coordinates: readonly LonLat[] }
  | { readonly type: "LineString"; readonly coordinates: readonly LonLat[] }
  | { readonly type: "MultiLineString"; readonly coordinates: readonly LonLat[][] }
  | { readonly type: "Polygon"; readonly coordinates: readonly LonLat[][] }
  | { readonly type: "MultiPolygon"; readonly coordinates: readonly LonLat[][][] };

export interface MapFeature<P extends MapFeatureProperties = MapFeatureProperties> {
  readonly id: string;
  readonly properties: P;
  readonly geometry: GeoJsonGeometry;
  readonly bbox: readonly [number, number, number, number];
  readonly lod?: readonly GeoJsonGeometry[];
}

export type ProvinceFeature = MapFeature<ProvinceFeatureProperties>;

export interface MapBoundary {
  readonly id: string;
  readonly leftProvinceId: string;
  readonly rightProvinceId: string | null;
  readonly coordinates: LonLat[];
}

export type RoadTypeId = string;
export type RoadSegmentId = string;

export interface RoadBendOverride {
  readonly controlPoints: readonly LonLat[];
}

export interface RoadSegment {
  readonly id: RoadSegmentId;
  readonly typeId: RoadTypeId;
  /** Normalized so provinceIdA < provinceIdB (lexicographic). */
  readonly provinceIdA: string;
  readonly provinceIdB: string;
  readonly name?: string;
  readonly nameEn?: string;
  readonly bend?: RoadBendOverride;
}

export interface RoadCollection {
  readonly schemaVersion: 1;
  readonly segments: readonly RoadSegment[];
}

export interface RoadTypeDefinition {
  readonly id: RoadTypeId;
  readonly nameKey: string;
  readonly drawOrder: number;
  readonly laneIndex: number;
  readonly laneSpacingScale: number;
  readonly strokeColor: number;
  readonly strokeOpacity: number;
  readonly lineWidth: number;
  readonly casingColor?: number;
  readonly casingWidth?: number;
  readonly dashSize?: number;
  readonly gapSize?: number;
  readonly maxVisibleHalfHeight: number;
}

export interface SpatialIndexData {
  readonly cellSizeDegrees: number;
  readonly cells: Readonly<Record<string, readonly string[]>>;
}

export type Vec3 = readonly [number, number, number];

export interface GlobeMeshLod {
  readonly tolerance: number;
  readonly positions: Float32Array;
  readonly provinceSlots: Uint16Array;
  readonly indices: Uint32Array;
}

export interface GlobeMeshData {
  readonly provinceIds: readonly string[];
  readonly lods: readonly GlobeMeshLod[];
}

export interface MapViewModelHooks {
  getProvinceFill?(provinceId: string): string | undefined;
  /** Stable owner id used to style shared boundaries as province vs country borders. */
  getProvinceOwner?(provinceId: string): string | undefined;
}

export interface MapViewModel {
  readonly mapId: string;
  readonly provinces: readonly ProvinceFeature[];
  readonly coastlines: readonly MapFeature[];
  readonly boundaries: readonly MapBoundary[];
  readonly roads: RoadCollection;
  readonly countries: CountryNameTable;
  readonly globeMesh: GlobeMeshData;
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
