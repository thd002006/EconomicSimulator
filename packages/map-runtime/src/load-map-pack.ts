import {
  MapSchemaError,
  parseBBox,
  parseLineGeometry,
  parsePolygonGeometry,
  parseProvinceCapital,
  parseProvinceDescription
} from "./schema.js";
import { createGlobeMeshData, parseGlobeMeshMetadata } from "./globe-mesh.js";
import { EDUCATION_LEVEL_IDS } from "./types.js";
import {
  buildAdjacencyPairSet,
  EMPTY_RUNTIME_ROAD_COLLECTION,
  parseRuntimeRoadCollection
} from "./roads.js";
import type {
  CountryNameEntry,
  CountryNameTable,
  GlobeMeshData,
  MapBoundary,
  MapFeature,
  MapFeatureProperties,
  MapPackManifest,
  MapPackProvenance,
  ProvinceDemographicsEntry,
  ProvinceDemographicsTable,
  ProvinceFeature,
  ProvinceFeatureProperties,
  RuntimeRoadCollection,
  SpatialIndexData
} from "./types.js";
import type { LonLat } from "./types.js";

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

function normalizeProvinceProperties(
  raw: Record<string, unknown> | null,
  id: string
): ProvinceFeatureProperties {
  const description = parseProvinceDescription(raw?.description, "provinces", id);
  const coreProvinceId = asString(raw?.coreProvinceId ?? raw?.core_province_id);
  return {
    ...normalizeProperties(raw),
    capital: parseProvinceCapital(raw?.capital, "provinces", id),
    ...(coreProvinceId === undefined ? {} : { coreProvinceId }),
    ...(description === undefined ? {} : { description })
  };
}

function parseProvenance(value: unknown): MapPackProvenance {
  if (!isRecord(value)) {
    throw new MapSchemaError("provenance missing.", "manifest");
  }
  if (typeof value.toolVersion !== "string" || typeof value.outputHash !== "string") {
    throw new MapSchemaError("provenance requires toolVersion and outputHash.", "manifest");
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
    outputHash: value.outputHash
  };
}

function parseManifest(input: unknown): MapPackManifest {
  if (!isRecord(input)) {
    throw new MapSchemaError("Invalid map pack manifest.", "manifest");
  }
  if (input.schemaVersion !== 4) {
    throw new MapSchemaError(
      `Unsupported schemaVersion ${String(input.schemaVersion)}; expected 4.`,
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
    typeof input.assets.spatialIndex !== "string" ||
    typeof input.assets.globeMesh !== "string"
  ) {
    throw new MapSchemaError(
      "Manifest assets.boundaries, assets.spatialIndex, and assets.globeMesh are required.",
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
  const roads = asString((input.assets as Record<string, unknown>).roads);
  const countries = asString(input.assets.countries);
  const demographics = asString((input.assets as Record<string, unknown>).demographics);
  const provinceDefinitions = asString(
    (input.assets as Record<string, unknown>).provinceDefinitions
  );
  const scenarioSeed = asString((input.assets as Record<string, unknown>).scenarioSeed);
  return {
    schemaVersion: 4,
    format: input.format,
    id: input.id,
    version: input.version,
    nameKey: asString(input.nameKey) ?? input.id,
    coordinateReferenceSystem: asString(input.coordinateReferenceSystem) ?? "EPSG:4326",
    assets: {
      provinces: input.assets.provinces,
      boundaries: input.assets.boundaries,
      ...(coastlines === undefined ? {} : { coastlines }),
      ...(roads === undefined ? {} : { roads }),
      ...(countries === undefined ? {} : { countries }),
      ...(demographics === undefined ? {} : { demographics }),
      ...(provinceDefinitions === undefined ? {} : { provinceDefinitions }),
      ...(scenarioSeed === undefined ? {} : { scenarioSeed }),
      spatialIndex: input.assets.spatialIndex,
      globeMesh: input.assets.globeMesh
    },
    lodTolerances,
    provenance: parseProvenance(input.provenance)
  };
}

function parseRuntimeProvinces(input: unknown): ProvinceFeature[] {
  if (!isRecord(input) || input.type !== "ProvinceCollection" || !Array.isArray(input.features)) {
    throw new MapSchemaError("Expected ProvinceCollection.", "provinces");
  }
  const features: ProvinceFeature[] = [];
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
      properties: normalizeProvinceProperties(
        isRecord(feature.properties) ? feature.properties : null,
        id
      ),
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

function parseCountryNames(input: unknown): CountryNameTable {
  if (input === undefined) return {};
  if (!isRecord(input)) {
    throw new MapSchemaError("Expected country name table object.", "countries");
  }
  const result: Record<string, CountryNameEntry> = {};
  for (const [countryId, entry] of Object.entries(input)) {
    if (!isRecord(entry)) {
      throw new MapSchemaError(`Country ${countryId} entry invalid.`, "countries", countryId);
    }
    const nameEn = asString(entry.nameEn ?? entry.name_en);
    if (nameEn === undefined) {
      throw new MapSchemaError(`Country ${countryId} missing nameEn.`, "countries", countryId);
    }
    const name = asString(entry.name);
    result[countryId] = {
      nameEn,
      ...(name === undefined ? {} : { name })
    };
  }
  return result;
}

const ALLOWED_EDUCATION_LEVELS = new Set<string>(EDUCATION_LEVEL_IDS as readonly string[]);

function parseProvinceDemographics(input: unknown): ProvinceDemographicsTable {
  if (input === undefined) return {};
  if (!isRecord(input)) {
    throw new MapSchemaError("Expected demographics table object.", "demographics");
  }
  const result: Record<string, ProvinceDemographicsEntry> = {};
  for (const [provinceId, entry] of Object.entries(input)) {
    if (!isRecord(entry)) {
      throw new MapSchemaError(
        `Demographics ${provinceId} entry invalid.`,
        "demographics",
        provinceId
      );
    }
    const pop = asFiniteNumber(entry.pop);
    const male = asFiniteNumber(entry.male);
    const female = asFiniteNumber(entry.female);
    const gdpPpp = asFiniteNumber(entry.gdpPpp);
    if (pop === undefined || male === undefined || female === undefined || gdpPpp === undefined) {
      throw new MapSchemaError(
        `Demographics ${provinceId} requires numeric pop/male/female/gdpPpp.`,
        "demographics",
        provinceId
      );
    }
    if (!isRecord(entry.age) || !isRecord(entry.education15Plus)) {
      throw new MapSchemaError(
        `Demographics ${provinceId} requires age and education15Plus objects.`,
        "demographics",
        provinceId
      );
    }
    const ageKeys = Object.keys(entry.age);
    if (ageKeys.length === 0) {
      throw new MapSchemaError(
        `Demographics ${provinceId} age must not be empty.`,
        "demographics",
        provinceId
      );
    }
    for (const [key, value] of Object.entries(entry.age)) {
      const age = Number(key);
      if (!Number.isInteger(age) || age < 0 || age > 100) {
        throw new MapSchemaError(
          `Demographics ${provinceId}.age.${key} is not a single-year age from 0 to 100.`,
          "demographics",
          provinceId
        );
      }
      if (asFiniteNumber(value) === undefined) {
        throw new MapSchemaError(
          `Demographics ${provinceId}.age.${key} must be finite.`,
          "demographics",
          provinceId
        );
      }
    }
    const eduKeys = Object.keys(entry.education15Plus);
    if (eduKeys.length === 0) {
      throw new MapSchemaError(
        `Demographics ${provinceId} education15Plus must not be empty.`,
        "demographics",
        provinceId
      );
    }
    for (const [key, value] of Object.entries(entry.education15Plus)) {
      if (!ALLOWED_EDUCATION_LEVELS.has(key)) {
        throw new MapSchemaError(
          `Demographics ${provinceId}.education15Plus.${key} is not a known education level.`,
          "demographics",
          provinceId
        );
      }
      if (asFiniteNumber(value) === undefined) {
        throw new MapSchemaError(
          `Demographics ${provinceId}.education15Plus.${key} must be finite.`,
          "demographics",
          provinceId
        );
      }
    }
    result[provinceId] = {
      pop,
      male,
      female,
      age: entry.age as ProvinceDemographicsEntry["age"],
      education15Plus: entry.education15Plus as ProvinceDemographicsEntry["education15Plus"],
      gdpPpp
    };
  }
  return result;
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

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

export interface LoadedMapPack {
  readonly manifest: MapPackManifest;
  readonly provinces: readonly ProvinceFeature[];
  readonly coastlines: readonly MapFeature[];
  readonly boundaries: readonly MapBoundary[];
  readonly roads: RuntimeRoadCollection;
  readonly countries: CountryNameTable;
  readonly demographics?: ProvinceDemographicsTable;
  readonly scenarioSeed?: ScenarioSeedData;
  readonly spatialIndex: SpatialIndexData;
  readonly globeMesh: GlobeMeshData;
}

export interface ScenarioSeedData {
  readonly mapId: string;
  readonly provinces: readonly { id: string; ownerCountryId: string }[];
  readonly classSeeds: readonly {
    provinceId: string;
    socialClassId: string;
    populationPersons: number;
    male: number;
    female: number;
    age: Readonly<Record<string, number>>;
    education15Plus: Readonly<Record<string, number>>;
    cashCents?: number;
  }[];
}

export interface MapPackBundleInput {
  readonly manifest: unknown;
  readonly provinces: unknown;
  readonly boundaries: unknown;
  readonly spatialIndex: unknown;
  readonly globeMeshMetadata: unknown;
  readonly globeMeshBuffers: readonly ArrayBuffer[];
  /** Metadata indices corresponding to globeMeshBuffers; omitted when every LOD is present. */
  readonly globeMeshLodIndices?: readonly number[];
  readonly coastlines?: unknown;
  readonly roads?: unknown;
  readonly countries?: unknown;
  readonly demographics?: unknown;
  readonly scenarioSeed?: unknown;
}

function assertLodCount(manifest: MapPackManifest, provinces: readonly ProvinceFeature[]): void {
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

function parseFiniteRecord(value: unknown, label: string): Record<string, number> {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new MapSchemaError(`${label} must be a non-empty object.`, "scenarioSeed");
  }
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const number = asFiniteNumber(entry);
    if (number === undefined) {
      throw new MapSchemaError(`${label}.${key} must be finite.`, "scenarioSeed");
    }
    result[key] = number;
  }
  return result;
}

function parseScenarioSeed(input: unknown): ScenarioSeedData | undefined {
  if (input === undefined) return undefined;
  if (!isRecord(input)) {
    throw new MapSchemaError("Expected scenario-seed object.", "scenarioSeed");
  }
  const mapId = asString(input.mapId);
  if (mapId === undefined || !Array.isArray(input.provinces) || !Array.isArray(input.classSeeds)) {
    throw new MapSchemaError(
      "scenario-seed requires mapId, provinces, and classSeeds.",
      "scenarioSeed"
    );
  }
  const provinces: Array<{ id: string; ownerCountryId: string }> = [];
  for (const [index, raw] of input.provinces.entries()) {
    if (!isRecord(raw)) {
      throw new MapSchemaError(`scenario-seed.provinces[${index}] invalid.`, "scenarioSeed");
    }
    const id = asString(raw.id);
    const ownerCountryId = asString(raw.ownerCountryId);
    if (id === undefined || ownerCountryId === undefined) {
      throw new MapSchemaError(
        `scenario-seed.provinces[${index}] requires id and ownerCountryId.`,
        "scenarioSeed"
      );
    }
    provinces.push({ id, ownerCountryId });
  }
  const classSeeds: Array<ScenarioSeedData["classSeeds"][number]> = [];
  for (const [index, raw] of input.classSeeds.entries()) {
    if (!isRecord(raw)) {
      throw new MapSchemaError(`scenario-seed.classSeeds[${index}] invalid.`, "scenarioSeed");
    }
    const provinceId = asString(raw.provinceId);
    const socialClassId = asString(raw.socialClassId);
    const populationPersons = asFiniteNumber(raw.populationPersons);
    const male = asFiniteNumber(raw.male);
    const female = asFiniteNumber(raw.female);
    if (
      provinceId === undefined ||
      socialClassId === undefined ||
      populationPersons === undefined ||
      male === undefined ||
      female === undefined
    ) {
      throw new MapSchemaError(
        `scenario-seed.classSeeds[${index}] missing required numeric/string fields.`,
        "scenarioSeed"
      );
    }
    const cashCents = raw.cashCents === undefined ? undefined : asFiniteNumber(raw.cashCents);
    if (raw.cashCents !== undefined && cashCents === undefined) {
      throw new MapSchemaError(
        `scenario-seed.classSeeds[${index}].cashCents must be finite.`,
        "scenarioSeed"
      );
    }
    classSeeds.push({
      provinceId,
      socialClassId,
      populationPersons,
      male,
      female,
      age: parseFiniteRecord(raw.age, `scenario-seed.classSeeds[${index}].age`),
      education15Plus: parseFiniteRecord(
        raw.education15Plus,
        `scenario-seed.classSeeds[${index}].education15Plus`
      ),
      ...(cashCents === undefined ? {} : { cashCents })
    });
  }
  return { mapId, provinces, classSeeds };
}

/** Parse an already-loaded runtime map pack bundle (Node validation or tests). */
export function parseMapPackBundle(raw: MapPackBundleInput): LoadedMapPack {
  const manifest = parseManifest(raw.manifest);
  const provinces = parseRuntimeProvinces(raw.provinces);
  assertLodCount(manifest, provinces);
  const globeMeshMetadata = parseGlobeMeshMetadata(raw.globeMeshMetadata);
  if (
    globeMeshMetadata.lods.length !== manifest.lodTolerances.length ||
    globeMeshMetadata.lods.some((lod, index) => lod.tolerance !== manifest.lodTolerances[index])
  ) {
    throw new MapSchemaError("Globe mesh LODs do not match the map manifest.", "globeMesh");
  }
  const provinceIds = new Set(provinces.map((province) => province.id));
  if (
    globeMeshMetadata.provinceIds.length !== provinces.length ||
    globeMeshMetadata.provinceIds.some((id) => !provinceIds.has(id))
  ) {
    throw new MapSchemaError("Globe mesh province IDs do not match provinces.", "globeMesh");
  }
  const scenarioSeed = parseScenarioSeed(raw.scenarioSeed);
  const boundaries = parseRuntimeBoundaries(raw.boundaries);
  const capitals = new Map<string, LonLat>();
  for (const province of provinces) {
    capitals.set(province.id, province.properties.capital.coordinates);
  }
  const roads =
    raw.roads === undefined
      ? EMPTY_RUNTIME_ROAD_COLLECTION
      : parseRuntimeRoadCollection(raw.roads, {
          provinceIds,
          adjacencyPairs: buildAdjacencyPairSet(boundaries),
          capitals
        });
  return {
    manifest,
    provinces,
    boundaries,
    roads,
    spatialIndex: parseSpatialIndex(raw.spatialIndex),
    globeMesh: createGlobeMeshData(
      globeMeshMetadata,
      raw.globeMeshBuffers,
      raw.globeMeshLodIndices
    ),
    coastlines: raw.coastlines === undefined ? [] : parseRuntimeCoastlines(raw.coastlines),
    countries: parseCountryNames(raw.countries),
    demographics: parseProvinceDemographics(raw.demographics),
    ...(scenarioSeed === undefined ? {} : { scenarioSeed })
  };
}

/** Load a runtime map pack from a base URL such as `/maps/world-modern`. */
export async function loadMapPack(baseUrl: string): Promise<LoadedMapPack> {
  const root = baseUrl.replace(/\/$/, "");
  const manifest = parseManifest(await fetchJson(`${root}/map.json`));

  const [
    provincesRaw,
    boundariesRaw,
    spatialIndexRaw,
    coastlinesRaw,
    roadsRaw,
    countriesRaw,
    demographicsRaw,
    scenarioSeedRaw,
    globeMeshMetadataRaw
  ] = await Promise.all([
    fetchJson(`${root}/${manifest.assets.provinces}`),
    fetchJson(`${root}/${manifest.assets.boundaries}`),
    fetchJson(`${root}/${manifest.assets.spatialIndex}`),
    manifest.assets.coastlines === undefined
      ? Promise.resolve(undefined)
      : fetchJson(`${root}/${manifest.assets.coastlines}`),
    manifest.assets.roads === undefined
      ? Promise.resolve(undefined)
      : fetchJson(`${root}/${manifest.assets.roads}`),
    manifest.assets.countries === undefined
      ? Promise.resolve(undefined)
      : fetchJson(`${root}/${manifest.assets.countries}`),
    manifest.assets.demographics === undefined
      ? Promise.resolve(undefined)
      : fetchJson(`${root}/${manifest.assets.demographics}`),
    manifest.assets.scenarioSeed === undefined
      ? Promise.resolve(undefined)
      : fetchJson(`${root}/${manifest.assets.scenarioSeed}`),
    fetchJson(`${root}/${manifest.assets.globeMesh}`)
  ]);
  const globeMeshMetadata = parseGlobeMeshMetadata(globeMeshMetadataRaw);
  // The renderer currently uses authored geometry exclusively. Do not download
  // the coarse meshes until distance-based switching is enabled again.
  const globeMeshLodIndices = [globeMeshMetadata.lods.length - 1];
  const globeMeshBuffers = await Promise.all(
    globeMeshLodIndices.map((index) =>
      fetchArrayBuffer(`${root}/${globeMeshMetadata.lods[index]!.file}`)
    )
  );

  return parseMapPackBundle({
    manifest,
    provinces: provincesRaw,
    boundaries: boundariesRaw,
    spatialIndex: spatialIndexRaw,
    globeMeshMetadata,
    globeMeshBuffers,
    globeMeshLodIndices,
    ...(coastlinesRaw === undefined ? {} : { coastlines: coastlinesRaw }),
    ...(roadsRaw === undefined ? {} : { roads: roadsRaw }),
    ...(countriesRaw === undefined ? {} : { countries: countriesRaw }),
    ...(demographicsRaw === undefined ? {} : { demographics: demographicsRaw }),
    ...(scenarioSeedRaw === undefined ? {} : { scenarioSeed: scenarioSeedRaw })
  });
}

export { MapSchemaError };
