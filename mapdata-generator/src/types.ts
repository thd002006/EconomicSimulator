export type LonLat = readonly [number, number];

export type PolygonGeometry = {
  type: "Polygon";
  coordinates: LonLat[][];
};

export type MultiPolygonGeometry = {
  type: "MultiPolygon";
  coordinates: LonLat[][][];
};

export type AreaGeometry = PolygonGeometry | MultiPolygonGeometry;

export type PointGeometry = {
  type: "Point";
  coordinates: LonLat;
};

export type LineGeometry = {
  type: "LineString";
  coordinates: LonLat[];
};

export type GeoJsonGeometry = AreaGeometry | PointGeometry | LineGeometry;

export interface GeoJsonFeature<G extends GeoJsonGeometry = GeoJsonGeometry> {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown> | null;
  geometry: G | null;
}

export interface GeoJsonFeatureCollection<G extends GeoJsonGeometry = GeoJsonGeometry> {
  type: "FeatureCollection";
  features: GeoJsonFeature<G>[];
}

export interface SourceProvince {
  readonly index: number;
  readonly id: string;
  readonly countryId: string;
  readonly name: string;
  readonly nameEn: string;
  readonly type?: string;
  readonly region?: string;
  readonly regionCode?: string;
  readonly geometry: AreaGeometry;
  readonly areaKm2: number;
  readonly center: LonLat;
}

export interface CapitalCandidate {
  readonly name: string;
  readonly nameEn?: string;
  readonly countryId: string;
  readonly coordinates: LonLat;
  readonly population: number;
  readonly national: boolean;
}

export interface ProvinceCapital {
  readonly coordinates: LonLat;
  readonly name?: string;
  readonly nameEn?: string;
}

export interface MergeGroup {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  readonly countryId: string;
  readonly memberIndices: readonly number[];
  readonly method:
    "retained" | "official-region" | "area-merge" | "enclosure-merge" | "archipelago-merge";
}

export interface AuthoredProvinceProperties extends Record<string, unknown> {
  readonly name: string;
  readonly nameEn: string;
  readonly adm0A3: string;
  readonly type: string;
  readonly capital: ProvinceCapital;
}

export interface ReviewProvince {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  readonly countryId: string;
  readonly method: MergeGroup["method"];
  readonly members: readonly string[];
  readonly areaKm2: number;
  readonly compactness: number;
  readonly fragmentCount: number;
  readonly vertexCount: number;
  readonly capital: ProvinceCapital;
  readonly capitalSource: "national" | "regional" | "generated";
  readonly minimumAreaKm2: number;
  readonly belowMinimumReason?: "no-legal-neighbor";
}
