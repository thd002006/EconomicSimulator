import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeBBox,
  parseLineGeometry,
  parsePolygonGeometry,
  parseProvinceCapital,
  type GeoJsonGeometry,
  type LonLat
} from "@economic-simulator/map-runtime";
import { assertUniqueFeatureIds } from "./feature-ids.js";
import { resolveContainedFile } from "./path-safety.js";
import { signedRingArea, simplifyRingSafely } from "./simplify.js";
import { parseSourceMapManifest } from "./source-manifest.js";

export const LOD_TOLERANCES = [0.25, 0.08, 0] as const;
const GRID_CELL_SIZE = 5;
const TOOL_VERSION = "0.4.0";

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

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<{ text: string; hash: string }> {
  const text = `${JSON.stringify(value)}\n`;
  await mkdir(dirname(path), { recursive: true });
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
    "scalerank"
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
  const provinces = provinceCollection.features.map((feature, index) => {
    const id = provinceIds[index]!;
    const geometry = parsePolygonGeometry(feature.geometry, "provinces", id);
    return {
      id,
      properties: {
        ...pickProperties(feature.properties),
        capital: parseProvinceCapital(feature.properties?.capital, "provinces", id)
      },
      bbox: computeBBox(geometry),
      lod: LOD_TOLERANCES.map((tolerance) => simplifyGeometry(geometry, tolerance))
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
  assetHashes.spatialIndex = (
    await writeJson(join(outDir, "spatial-index.json"), buildSpatialIndex(provinces))
  ).hash;
  const manifestCore = {
    schemaVersion: 3,
    format: "economic-simulator.map-runtime/v2",
    id: manifest.id,
    version: manifest.version,
    nameKey: manifest.nameKey,
    coordinateReferenceSystem: manifest.coordinateReferenceSystem,
    assets: {
      provinces: "provinces.json",
      boundaries: "boundaries.json",
      coastlines: "coastlines.json",
      spatialIndex: "spatial-index.json"
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

export async function compileAllMaps(sourceRoot: string): Promise<void> {
  const mapDirectories = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const directory of mapDirectories) {
    await compilePack(sourceRoot, sourceRoot, { id: directory, path: directory });
  }
}

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(toolRoot, "../..");
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await compileAllMaps(join(repoRoot, "assets/maps"));
}
