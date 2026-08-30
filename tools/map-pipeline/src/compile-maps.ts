import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeBBox,
  parseLineGeometry,
  parsePolygonGeometry,
  parseProvinceCapital,
  parseProvinceDescription,
  type GeoJsonGeometry,
  type LonLat
} from "@economic-simulator/map-runtime";
import {
  aggregateDemographicsFromClasses,
  assertAuthoredCrossRefs,
  buildProvinceDefinitions,
  buildScenarioSeed,
  loadAuthoredMapContent
} from "./authored-pack.js";
import { assertUniqueFeatureIds } from "./feature-ids.js";
import { resolveContainedFile } from "./path-safety.js";
import { signedRingArea, simplifyRingSafely } from "./simplify.js";
import { parseSourceMapManifest } from "./source-manifest.js";
import { compileGlobeMesh, serializeGlobeMesh } from "./globe-mesh.js";

export const LOD_TOLERANCES = [0.25, 0.08, 0] as const;
const GRID_CELL_SIZE = 5;
const TOOL_VERSION = "0.6.1";

type RecordValue = Record<string, unknown>;
type Feature = {
  type: "Feature";
  id?: string | number;
  properties?: RecordValue | null;
  geometry?: unknown;
};
type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(content: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function writeBinary(path: string, value: Uint8Array): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
  return sha256(value);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<{ text: string; hash: string }> {
  const text = `${JSON.stringify(value)}\n`;
  await mkdir(dirname(path), { recursive: true });
  await rm(path, { force: true }).catch(() => {});
  await writeFile(path, text, "utf8");
  return { text, hash: sha256(text) };
}

function parseCollection(value: unknown, layer: string): FeatureCollection {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error(`${layer} must be a GeoJSON FeatureCollection.`);
  }
  return value as FeatureCollection;
}

type PolygonGeometry = Extract<GeoJsonGeometry, { type: "Polygon" | "MultiPolygon" }>;

function cloneGeometry(geometry: PolygonGeometry): PolygonGeometry {
  return structuredClone(geometry);
}

export function polygonGeometryArea(geometry: PolygonGeometry): number {
  const polygonArea = (rings: readonly (readonly LonLat[])[]): number => {
    const [outer, ...holes] = rings;
    if (outer === undefined) return 0;
    return Math.max(
      0,
      Math.abs(signedRingArea(outer)) -
        holes.reduce((sum, ring) => sum + Math.abs(signedRingArea(ring)), 0)
    );
  };
  return geometry.type === "Polygon"
    ? polygonArea(geometry.coordinates)
    : geometry.coordinates.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
}

export function simplifyGeometry(geometry: PolygonGeometry, tolerance: number): PolygonGeometry {
  if (tolerance <= 0) return cloneGeometry(geometry);
  const originalArea = polygonGeometryArea(geometry);
  const adaptiveTolerance = Math.min(tolerance, Math.sqrt(originalArea) * 0.05);
  const candidate: PolygonGeometry =
    geometry.type === "Polygon"
      ? {
          type: "Polygon",
          coordinates: geometry.coordinates.map((ring) =>
            simplifyRingSafely(ring, adaptiveTolerance)
          )
        }
      : {
          type: "MultiPolygon",
          coordinates: geometry.coordinates.map((polygon) =>
            polygon.map((ring) => simplifyRingSafely(ring, adaptiveTolerance))
          )
        };
  const candidateArea = polygonGeometryArea(candidate);
  const relativeAreaError =
    originalArea === 0 ? 0 : Math.abs(candidateArea - originalArea) / originalArea;
  return relativeAreaError <= 0.1 ? candidate : cloneGeometry(geometry);
}

export function resolveTriangulatableLods(
  id: string,
  candidates: readonly PolygonGeometry[]
): PolygonGeometry[] {
  if (candidates.length === 0) {
    throw new Error(`No triangulatable geometry LOD for ${id}.`);
  }
  return candidates.map((_, lodIndex) => {
    for (let fallbackIndex = lodIndex; fallbackIndex < candidates.length; fallbackIndex += 1) {
      const fallback = candidates[fallbackIndex]!;
      try {
        compileGlobeMesh([{ id, provinceSlot: 0, geometry: fallback }]);
        return fallback;
      } catch (error) {
        if (fallbackIndex === candidates.length - 1) throw error;
      }
    }
    throw new Error(`No triangulatable geometry LOD for ${id}.`);
  });
}

function buildTriangulatableLods(id: string, geometry: PolygonGeometry): PolygonGeometry[] {
  return resolveTriangulatableLods(
    id,
    LOD_TOLERANCES.map((tolerance) => simplifyGeometry(geometry, tolerance))
  );
}

function pickProperties(properties: RecordValue | null | undefined): RecordValue {
  if (properties === null || properties === undefined) return {};
  const allowed = [
    "name",
    "nameEn",
    "name_en",
    "adm0A3",
    "adm0_a3",
    "isoA2",
    "iso_a2",
    "type",
    "scalerank",
    "description",
    "coreProvinceId",
    "core_province_id"
  ];
  return Object.fromEntries(
    allowed.filter((key) => properties[key] !== undefined).map((key) => [key, properties[key]])
  );
}

function buildSpatialIndex(
  provinces: readonly { id: string; bbox: readonly [number, number, number, number] }[]
): {
  cellSizeDegrees: number;
  cells: Record<string, string[]>;
} {
  const cells: Record<string, string[]> = {};
  for (const province of provinces) {
    const [minLon, minLat, maxLon, maxLat] = province.bbox;
    for (
      let x = Math.floor(minLon / GRID_CELL_SIZE);
      x <= Math.floor(maxLon / GRID_CELL_SIZE);
      x += 1
    ) {
      for (
        let y = Math.floor(minLat / GRID_CELL_SIZE);
        y <= Math.floor(maxLat / GRID_CELL_SIZE);
        y += 1
      ) {
        (cells[`${x}:${y}`] ??= []).push(province.id);
      }
    }
  }
  return { cellSizeDegrees: GRID_CELL_SIZE, cells };
}

export async function compilePack(
  sourceRoot: string,
  outputRoot: string,
  entry: { id: string; path: string }
): Promise<void> {
  const sourceDir = join(sourceRoot, entry.path);
  const manifest = parseSourceMapManifest(await readJson(join(sourceDir, "map.json")), entry.id);

  const sourceHashes: Record<string, string> = {};
  const provincePath = await resolveContainedFile(
    sourceDir,
    manifest.layers.provinces,
    "layers.provinces"
  );
  const provinceText = await readFile(provincePath, "utf8");
  sourceHashes.provinces = sha256(provinceText);
  const provinceCollection = parseCollection(JSON.parse(provinceText) as unknown, "provinces");
  const provinceIds = assertUniqueFeatureIds(provinceCollection.features, "provinces");

  const authored = await loadAuthoredMapContent(sourceDir, {
    countriesPath: manifest.layers.countries,
    provincesDir: manifest.layers.provincesDir,
    companiesDir: manifest.layers.companiesDir
  });
  assertAuthoredCrossRefs(authored, new Set(provinceIds));
  sourceHashes.countries = sha256(await readFile(join(sourceDir, manifest.layers.countries), "utf8"));
  sourceHashes.provincesDir = sha256(
    JSON.stringify(
      [...authored.provinces.entries()].map(([id, pack]) => [
        id,
        pack.overview,
        pack.classes,
        pack.operatingUnits
      ])
    )
  );
  sourceHashes.companiesDir = sha256(JSON.stringify(authored.companies));

  const provinces = provinceCollection.features.map((feature, index) => {
    const id = provinceIds[index]!;
    const geometry = parsePolygonGeometry(feature.geometry, "provinces", id);
    const overview = authored.provinces.get(id)?.overview;
    const capital = parseProvinceCapital(feature.properties?.capital, "provinces", id);
    const description =
      overview?.description ??
      parseProvinceDescription(feature.properties?.description, "provinces", id);
    const coreProvinceId =
      overview?.coreProvinceId ??
      (typeof feature.properties?.coreProvinceId === "string"
        ? feature.properties.coreProvinceId
        : typeof feature.properties?.core_province_id === "string"
          ? feature.properties.core_province_id
          : id);
    const properties = {
      ...pickProperties(feature.properties),
      coreProvinceId,
      ...(overview?.name !== undefined ? { name: overview.name } : {}),
      ...(overview?.nameEn !== undefined ? { nameEn: overview.nameEn } : {}),
      ...(overview?.ownerCountryId !== undefined ? { adm0A3: overview.ownerCountryId } : {}),
      capital: {
        ...capital,
        ...(overview?.capitalName !== undefined ? { name: overview.capitalName } : {}),
        ...(overview?.capitalNameEn !== undefined ? { nameEn: overview.capitalNameEn } : {})
      },
      ...(description === undefined ? {} : { description })
    };
    return {
      id,
      properties,
      bbox: computeBBox(geometry),
      lod: buildTriangulatableLods(id, geometry)
    };
  });

  const boundaryPath = await resolveContainedFile(
    sourceDir,
    manifest.layers.boundaries,
    "layers.boundaries"
  );
  const boundaryText = await readFile(boundaryPath, "utf8");
  sourceHashes.boundaries = sha256(boundaryText);
  const boundaries = JSON.parse(boundaryText) as unknown;
  if (
    !isRecord(boundaries) ||
    boundaries.type !== "BoundaryCollection" ||
    !Array.isArray(boundaries.features)
  ) {
    throw new Error("boundaries must be a BoundaryCollection.");
  }
  assertUniqueFeatureIds(boundaries.features, "boundaries");

  const coastlines: Array<{ id: string; multi: boolean; coordinates: unknown }> = [];
  if (manifest.layers.coastlines !== undefined) {
    const coastlinePath = await resolveContainedFile(
      sourceDir,
      manifest.layers.coastlines,
      "layers.coastlines"
    );
    const text = await readFile(coastlinePath, "utf8");
    sourceHashes.coastlines = sha256(text);
    const collection = parseCollection(JSON.parse(text) as unknown, "coastlines");
    const coastlineIds = assertUniqueFeatureIds(collection.features, "coastlines");
    for (const [index, feature] of collection.features.entries()) {
      const id = coastlineIds[index]!;
      const geometry = parseLineGeometry(feature.geometry, "coastlines", id);
      coastlines.push({
        id,
        multi: geometry.type === "MultiLineString",
        coordinates: structuredClone(geometry.coordinates)
      });
    }
  }

  const countries: Record<string, { nameEn: string; name?: string }> = {};
  for (const country of authored.countries) {
    countries[country.id] = {
      nameEn: country.nameEn,
      ...(country.name === undefined ? {} : { name: country.name })
    };
  }

  const demographics: Record<string, unknown> = aggregateDemographicsFromClasses(authored.provinces);

  const outDir = join(outputRoot, entry.path, "compiled");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const assetHashes: Record<string, string> = {};
  assetHashes.provinces = (
    await writeJson(join(outDir, "provinces.json"), {
      type: "ProvinceCollection",
      features: provinces
    })
  ).hash;
  assetHashes.boundaries = (await writeJson(join(outDir, "boundaries.json"), boundaries)).hash;
  assetHashes.coastlines = (
    await writeJson(join(outDir, "coastlines.json"), {
      type: "CoastlineCollection",
      features: coastlines
    })
  ).hash;
  assetHashes.countries = (await writeJson(join(outDir, "countries.json"), countries)).hash;
  assetHashes.demographics = (await writeJson(join(outDir, "demographics.json"), demographics)).hash;
  const provinceDefinitions = buildProvinceDefinitions(manifest.id, authored);
  assetHashes.provinceDefinitions = (
    await writeJson(join(outDir, "province-definitions.json"), provinceDefinitions)
  ).hash;
  const scenarioSeed = buildScenarioSeed(manifest.id, authored);
  assetHashes.scenarioSeed = (await writeJson(join(outDir, "scenario-seed.json"), scenarioSeed)).hash;
  if (manifest.id === "world-modern") {
    const gameDataProvincesPath = resolve(repoRootFromCompile(), "packages/game-data/data/provinces.json");
    await writeJson(gameDataProvincesPath, provinceDefinitions);
  }
  assetHashes.spatialIndex = (
    await writeJson(join(outDir, "spatial-index.json"), buildSpatialIndex(provinces))
  ).hash;
  const globeProvinceIds = provinces.map((province) => province.id).sort();
  const provinceSlot = new Map(globeProvinceIds.map((id, index) => [id, index]));
  const globeLods: Array<{
    tolerance: number;
    file: string;
    vertexCount: number;
    indexCount: number;
  }> = [];
  for (const [lodIndex, tolerance] of LOD_TOLERANCES.entries()) {
    const mesh = compileGlobeMesh(
      provinces
        .map((province) => ({
          id: province.id,
          provinceSlot: provinceSlot.get(province.id)!,
          geometry: province.lod[lodIndex]!
        }))
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    );
    const file = `globe-lod-${lodIndex}.bin`;
    assetHashes[`globeLod${lodIndex}`] = await writeBinary(
      join(outDir, file),
      serializeGlobeMesh(mesh)
    );
    globeLods.push({
      tolerance,
      file,
      vertexCount: mesh.provinceSlots.length,
      indexCount: mesh.indices.length
    });
  }
  assetHashes.globeMesh = (
    await writeJson(join(outDir, "globe-mesh.json"), {
      format: "economic-simulator.globe-mesh/v1",
      provinceIds: globeProvinceIds,
      lods: globeLods
    })
  ).hash;
  const manifestCore = {
    schemaVersion: 4,
    format: "economic-simulator.map-runtime/v3",
    id: manifest.id,
    version: manifest.version,
    nameKey: manifest.nameKey,
    coordinateReferenceSystem: manifest.coordinateReferenceSystem,
    assets: {
      provinces: "provinces.json",
      boundaries: "boundaries.json",
      coastlines: "coastlines.json",
      countries: "countries.json",
      demographics: "demographics.json",
      provinceDefinitions: "province-definitions.json",
      scenarioSeed: "scenario-seed.json",
      spatialIndex: "spatial-index.json",
      globeMesh: "globe-mesh.json"
    },
    lodTolerances: [...LOD_TOLERANCES],
    provenance: {
      toolVersion: TOOL_VERSION,
      naturalEarthCommit: manifest.attribution?.naturalEarthCommit ?? null,
      sourceHashes,
      assetHashes
    }
  };
  const outputHash = sha256(JSON.stringify(manifestCore));
  await writeJson(join(outDir, "map.json"), {
    ...manifestCore,
    provenance: { ...manifestCore.provenance, outputHash }
  });
  console.log(`Compiled authored map: ${entry.id} (${provinces.length} provinces)`);
}

export async function compileSingleMap(
  sourceRoot: string,
  mapId: string
): Promise<void> {
  if (!mapId || mapId.trim() === "") {
    throw new Error("compileSingleMap requires a valid non-empty mapId.");
  }
  await compilePack(sourceRoot, sourceRoot, { id: mapId, path: mapId });
}

function repoRootFromCompile(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function parseCompileArgs(args: readonly string[]): { mapId: string } {
  let mapId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") {
      continue;
    }
    if (argument === "--map") {
      mapId = args[index + 1];
      if (mapId === undefined || mapId.startsWith("-")) {
        throw new Error("--map requires a non-empty map id.");
      }
      index += 1;
      continue;
    }
    if (argument.startsWith("--map=")) {
      mapId = argument.slice("--map=".length);
      if (!mapId) throw new Error("--map= requires a non-empty map id.");
      continue;
    }
    throw new Error(`Unknown compile argument: ${argument}`);
  }
  if (mapId === undefined || mapId.trim() === "") {
    throw new Error("Missing required argument: --map <mapId>");
  }
  return { mapId };
}

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(toolRoot, "../..");
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { mapId } = parseCompileArgs(process.argv.slice(2));
  await compileSingleMap(join(repoRoot, "assets/maps"), mapId);
}
