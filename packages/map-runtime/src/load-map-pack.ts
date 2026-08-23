import {
  MapSchemaError,
  parseBBox,
  parseLineGeometry,
  parsePointGeometry,
  parsePolygonGeometry
} from "./schema.js";
import type {
  MapBoundary,
  MapFeature,
  MapFeatureProperties,
  MapPackManifest,
  MapPackProvenance,
  SpatialIndexData
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function normalizeProperties(raw: Record<string, unknown> | null): MapFeatureProperties {
  if (raw === null) {
    return {};
  }
  const name = asString(raw.name);
  const nameEn = asString(raw.nameEn ?? raw.name_en);
  const adm0A3 = asString(raw.adm0A3 ?? raw.adm0_a3 ?? raw.ADM0_A3);
  const isoA2 = asString(raw.isoA2 ?? raw.iso_a2 ?? raw.ISO_A2);
  const type = asString(raw.type);
  const scalerank = asFiniteNumber(raw.scalerank ?? raw.scaleRank ?? raw.SCALERANK);
  return {
    ...(name === undefined ? {} : { name }),
    ...(nameEn === undefined ? {} : { nameEn }),
    ...(adm0A3 === undefined ? {} : { adm0A3 }),
    ...(isoA2 === undefined ? {} : { isoA2 }),
    ...(type === undefined ? {} : { type }),
    ...(scalerank === undefined ? {} : { scalerank })
  };
}

function parseProvenance(value: unknown): MapPackProvenance {
  if (!isRecord(value)) {
    throw new MapSchemaError("provenance missing.", "manifest");
  }
  if (typeof value.toolVersion !== "string" || typeof value.outputHash !== "string") {
    throw new MapSchemaError("provenance requires toolVersion and outputHash.", "manifest");
  }
  if (typeof value.builtAt !== "string") {
    throw new MapSchemaError("provenance.builtAt missing.", "manifest");
  }
  if (!isRecord(value.sourceHashes) || !isRecord(value.assetHashes)) {
    throw new MapSchemaError("provenance hashes missing.", "manifest");
  }
  const sourceHashes: Record<string, string> = {};
  for (const [key, hash] of Object.entries(value.sourceHashes)) {
    if (typeof hash !== "string") {
      throw new MapSchemaError(`provenance.sourceHashes.${key} invalid.`, "manifest");
    }
    sourceHashes[key] = hash;
  }
  const assetHashes: Record<string, string> = {};
  for (const [key, hash] of Object.entries(value.assetHashes)) {
    if (typeof hash !== "string") {
      throw new MapSchemaError(`provenance.assetHashes.${key} invalid.`, "manifest");
    }
    assetHashes[key] = hash;
  }
  return {
    toolVersion: value.toolVersion,
    naturalEarthCommit:
      value.naturalEarthCommit === null ? null : (asString(value.naturalEarthCommit) ?? null),
    sourceHashes,
    assetHashes,
    outputHash: value.outputHash,
    builtAt: value.builtAt
  };
}

function parseManifest(input: unknown): MapPackManifest {
  if (!isRecord(input)) {
    throw new MapSchemaError("Invalid map pack manifest.", "manifest");
  }
  if (input.schemaVersion !== 2) {
    throw new MapSchemaError(
      `Unsupported schemaVersion ${String(input.schemaVersion)}; expected 2.`,
      "manifest"
    );
  }
  if (
    typeof input.format !== "string" ||
    typeof input.id !== "string" ||
    typeof input.version !== "string"
  ) {
    throw new MapSchemaError("Manifest requires format, id, and version.", "manifest");
  }
  if (!isRecord(input.assets) || typeof input.assets.provinces !== "string") {
    throw new MapSchemaError("Manifest assets.provinces is required.", "manifest");
  }
  if (
    typeof input.assets.boundaries !== "string" ||
    typeof input.assets.spatialIndex !== "string"
  ) {
    throw new MapSchemaError(
      "Manifest assets.boundaries and assets.spatialIndex are required.",
      "manifest"
    );
  }
  const lodTolerances = Array.isArray(input.lodTolerances)
    ? input.lodTolerances.map((value, index) => {
        const number = asFiniteNumber(value);
        if (number === undefined) {
          throw new MapSchemaError(`lodTolerances[${index}] invalid.`, "manifest");
        }
        return number;
      })
    : [];

  const coastlines = asString(input.assets.coastlines);
  const cities = asString(input.assets.cities);

  return {
    schemaVersion: 2,
    format: input.format,
    id: input.id,
    version: input.version,
    nameKey: asString(input.nameKey) ?? input.id,
    coordinateReferenceSystem: asString(input.coordinateReferenceSystem) ?? "EPSG:4326",
    assets: {
      provinces: input.assets.provinces,
      boundaries: input.assets.boundaries,
      ...(coastlines === undefined ? {} : { coastlines }),
      ...(cities === undefined ? {} : { cities }),
      spatialIndex: input.assets.spatialIndex
    },
    lodTolerances,
    provenance: parseProvenance(input.provenance)
  };
}

function parseRuntimeProvinces(input: unknown): MapFeature[] {
  if (!isRecord(input) || input.type !== "ProvinceCollection" || !Array.isArray(input.features)) {
    throw new MapSchemaError("Expected ProvinceCollection.", "provinces");
  }
  const features: MapFeature[] = [];
  for (const [index, feature] of input.features.entries()) {
    if (!isRecord(feature)) {
      throw new MapSchemaError(`Feature ${index} is invalid.`, "provinces");
    }
    const id = asString(feature.id);
    if (id === undefined) {
      throw new MapSchemaError(`Feature ${index} missing id.`, "provinces");
    }
    if (!Array.isArray(feature.lod) || feature.lod.length === 0) {
      throw new MapSchemaError("lod geometries missing.", "provinces", id);
    }
    const lod = feature.lod.map((geometry, lodIndex) =>
      parsePolygonGeometry(geometry, "provinces", `${id}#lod${lodIndex}`)
    );
    const geometry = lod[lod.length - 1]!;
    features.push({
      id,
      properties: isRecord(feature.properties)
        ? normalizeProperties(feature.properties)
        : normalizeProperties(null),
      geometry,
      bbox: parseBBox(feature.bbox, "provinces", id),
      lod
    });
  }
  return features;
}

function parseRuntimeBoundaries(input: unknown): MapBoundary[] {
  if (!isRecord(input) || input.type !== "BoundaryCollection" || !Array.isArray(input.features)) {
    throw new MapSchemaError("Expected BoundaryCollection.", "boundaries");
  }
  const boundaries: MapBoundary[] = [];
  for (const [index, feature] of input.features.entries()) {
    if (!isRecord(feature)) {
      throw new MapSchemaError(`Feature ${index} is invalid.`, "boundaries");
    }
    const id = asString(feature.id) ?? `boundary-${index}`;
    const leftProvinceId = asString(feature.leftProvinceId);
    if (leftProvinceId === undefined) {
      throw new MapSchemaError("leftProvinceId missing.", "boundaries", id);
    }
    const rightProvinceId =
      feature.rightProvinceId === null ? null : (asString(feature.rightProvinceId) ?? null);
    const line = parseLineGeometry(
      { type: "LineString", coordinates: feature.coordinates },
      "boundaries",
      id
    );
    if (line.type !== "LineString") {
      throw new MapSchemaError("Boundary coordinates must form a LineString.", "boundaries", id);
    }
    boundaries.push({
      id,
      leftProvinceId,
      rightProvinceId,
      coordinates: line.coordinates.map((point) => [point[0], point[1]] as const)
    });
  }
  return boundaries;
}

function parseRuntimeCoastlines(input: unknown): MapFeature[] {
  if (!isRecord(input) || input.type !== "CoastlineCollection" || !Array.isArray(input.features)) {
    throw new MapSchemaError("Expected CoastlineCollection.", "coastlines");
  }
  const features: MapFeature[] = [];
  for (const [index, feature] of input.features.entries()) {
    if (!isRecord(feature)) {
      throw new MapSchemaError(`Feature ${index} is invalid.`, "coastlines");
    }
    const id = asString(feature.id) ?? `coastline-${index}`;
    const multi = feature.multi === true;
    const geometry = parseLineGeometry(
      {
        type: multi ? "MultiLineString" : "LineString",
        coordinates: feature.coordinates
      },
      "coastlines",
      id
    );
    features.push({
      id,
      properties: {},
      geometry,
      bbox: [0, 0, 0, 0]
    });
  }
  return features;
}

function parseRuntimeCities(input: unknown): MapFeature[] {
  if (!isRecord(input) || input.type !== "CityCollection" || !Array.isArray(input.features)) {
    throw new MapSchemaError("Expected CityCollection.", "cities");
  }
  const features: MapFeature[] = [];
  for (const [index, feature] of input.features.entries()) {
    if (!isRecord(feature)) {
      throw new MapSchemaError(`Feature ${index} is invalid.`, "cities");
    }
    const id = asString(feature.id) ?? `city-${index}`;
    const geometry = parsePointGeometry(
      { type: "Point", coordinates: feature.coordinates },
      "cities",
      id
    );
    features.push({
      id,
      properties: isRecord(feature.properties)
        ? normalizeProperties(feature.properties)
        : normalizeProperties(null),
      geometry,
      bbox: [
        geometry.coordinates[0],
        geometry.coordinates[1],
        geometry.coordinates[0],
        geometry.coordinates[1]
      ]
    });
  }
  return features;
}

function parseSpatialIndex(input: unknown): SpatialIndexData {
  if (!isRecord(input)) {
    throw new MapSchemaError("Invalid spatial index.", "spatialIndex");
  }
  const cellSizeDegrees = asFiniteNumber(input.cellSizeDegrees);
  if (cellSizeDegrees === undefined || cellSizeDegrees <= 0) {
    throw new MapSchemaError("cellSizeDegrees invalid.", "spatialIndex");
  }
  if (!isRecord(input.cells)) {
    throw new MapSchemaError("cells missing.", "spatialIndex");
  }
  const cells: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input.cells)) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      throw new MapSchemaError(`cells.${key} invalid.`, "spatialIndex");
    }
    cells[key] = value as string[];
  }
  return { cellSizeDegrees, cells };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return (await response.json()) as unknown;
}

export interface LoadedMapPack {
  readonly manifest: MapPackManifest;
  readonly provinces: readonly MapFeature[];
  readonly coastlines: readonly MapFeature[];
  readonly boundaries: readonly MapBoundary[];
  readonly cities: readonly MapFeature[];
  readonly spatialIndex: SpatialIndexData;
}

export interface MapPackBundleInput {
  readonly manifest: unknown;
  readonly provinces: unknown;
  readonly boundaries: unknown;
  readonly spatialIndex: unknown;
  readonly coastlines?: unknown;
  readonly cities?: unknown;
}

function assertLodCount(manifest: MapPackManifest, provinces: readonly MapFeature[]): void {
  const expected = manifest.lodTolerances.length;
  if (expected === 0) {
    return;
  }
  for (const feature of provinces) {
    const lodCount = feature.lod?.length ?? 0;
    if (lodCount !== expected) {
      throw new MapSchemaError(
        `Province ${feature.id} has ${lodCount} LOD levels; expected ${expected}.`,
        "provinces",
        feature.id
      );
    }
  }
}

/** Parse an already-loaded runtime map pack bundle (Node validation or tests). */
export function parseMapPackBundle(raw: MapPackBundleInput): LoadedMapPack {
  const manifest = parseManifest(raw.manifest);
  const provinces = parseRuntimeProvinces(raw.provinces);
  assertLodCount(manifest, provinces);
  return {
    manifest,
    provinces,
    boundaries: parseRuntimeBoundaries(raw.boundaries),
    spatialIndex: parseSpatialIndex(raw.spatialIndex),
    coastlines: raw.coastlines === undefined ? [] : parseRuntimeCoastlines(raw.coastlines),
    cities: raw.cities === undefined ? [] : parseRuntimeCities(raw.cities)
  };
}

/** Load a runtime map pack from a base URL such as `/maps/world-modern`. */
export async function loadMapPack(baseUrl: string): Promise<LoadedMapPack> {
  const root = baseUrl.replace(/\/$/, "");
  const manifest = parseManifest(await fetchJson(`${root}/map.json`));

  const [provincesRaw, boundariesRaw, spatialIndexRaw, coastlinesRaw, citiesRaw] =
    await Promise.all([
      fetchJson(`${root}/${manifest.assets.provinces}`),
      fetchJson(`${root}/${manifest.assets.boundaries}`),
      fetchJson(`${root}/${manifest.assets.spatialIndex}`),
      manifest.assets.coastlines === undefined
        ? Promise.resolve(undefined)
        : fetchJson(`${root}/${manifest.assets.coastlines}`),
      manifest.assets.cities === undefined
        ? Promise.resolve(undefined)
        : fetchJson(`${root}/${manifest.assets.cities}`)
    ]);

  return parseMapPackBundle({
    manifest,
    provinces: provincesRaw,
    boundaries: boundariesRaw,
    spatialIndex: spatialIndexRaw,
    ...(coastlinesRaw === undefined ? {} : { coastlines: coastlinesRaw }),
    ...(citiesRaw === undefined ? {} : { cities: citiesRaw })
  });
}

export { MapSchemaError };
