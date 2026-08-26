import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseLineGeometry,
  parsePolygonGeometry,
  parseProvinceCapital,
  pointInGeometry
} from "@economic-simulator/map-runtime";
import { assertUniqueFeatureIds } from "./feature-ids.js";
import { resolveContainedFile } from "./path-safety.js";
import { parseSourceMapManifest } from "./source-manifest.js";

type RecordValue = Record<string, unknown>;
type Feature = { id?: string | number; properties?: RecordValue | null; geometry?: unknown };
type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
function parseCollection(value: unknown, layer: string): FeatureCollection {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error(`${layer} must be a GeoJSON FeatureCollection.`);
  }
  return value as FeatureCollection;
}
function assertSafeSegment(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) throw new Error(`${label} is unsafe: ${value}`);
}

export async function validatePack(
  root: string,
  entry: { id: string; path: string }
): Promise<Record<string, number>> {
  assertSafeSegment(entry.id, "map id");
  assertSafeSegment(entry.path, "map path");
  const packDir = join(root, entry.path);
  const manifest = parseSourceMapManifest(await readJson(join(packDir, "map.json")), entry.id);
  const provincePath = await resolveContainedFile(
    packDir,
    manifest.layers.provinces,
    "layers.provinces"
  );
  const provinces = parseCollection(await readJson(provincePath), "provinces");
  const provinceIds = new Set(assertUniqueFeatureIds(provinces.features, "provinces"));
  for (const feature of provinces.features) {
    const id = String(feature.id);
    const geometry = parsePolygonGeometry(feature.geometry, "provinces", id);
    const capital = parseProvinceCapital(feature.properties?.capital, "provinces", id);
    if (!pointInGeometry(capital.coordinates[0], capital.coordinates[1], geometry)) {
      throw new Error(`Province ${id} capital lies outside its geometry.`);
    }
  }

  const boundaryPath = await resolveContainedFile(
    packDir,
    manifest.layers.boundaries,
    "layers.boundaries"
  );
  const boundaryValue = await readJson(boundaryPath);
  if (
    !isRecord(boundaryValue) ||
    boundaryValue.type !== "BoundaryCollection" ||
    !Array.isArray(boundaryValue.features)
  ) {
    throw new Error(`Map ${entry.id} boundaries must be a BoundaryCollection.`);
  }
  assertUniqueFeatureIds(boundaryValue.features, "boundaries");
  for (const [index, raw] of boundaryValue.features.entries()) {
    if (!isRecord(raw)) throw new Error(`Boundary ${index} is invalid.`);
    const id = typeof raw.id === "string" ? raw.id : `boundary-${index}`;
    const left = typeof raw.leftProvinceId === "string" ? raw.leftProvinceId : undefined;
    const right =
      raw.rightProvinceId === null || typeof raw.rightProvinceId === "string"
        ? raw.rightProvinceId
        : undefined;
    if (
      left === undefined ||
      right === undefined ||
      !provinceIds.has(left) ||
      (right !== null && !provinceIds.has(right))
    ) {
      throw new Error(`Boundary ${id} references an unknown province.`);
    }
    parseLineGeometry({ type: "LineString", coordinates: raw.coordinates }, "boundaries", id);
  }

  let coastlines = 0;
  if (manifest.layers.coastlines !== undefined) {
    const coastlinePath = await resolveContainedFile(
      packDir,
      manifest.layers.coastlines,
      "layers.coastlines"
    );
    const collection = parseCollection(await readJson(coastlinePath), "coastlines");
    coastlines = collection.features.length;
    const coastlineIds = assertUniqueFeatureIds(collection.features, "coastlines");
    for (const [index, feature] of collection.features.entries()) {
      parseLineGeometry(feature.geometry, "coastlines", coastlineIds[index]!);
    }
  }

  let countries = 0;
  if (manifest.layers.countries !== undefined) {
    const countriesPath = await resolveContainedFile(
      packDir,
      manifest.layers.countries,
      "layers.countries"
    );
    const raw = await readJson(countriesPath);
    if (!isRecord(raw)) throw new Error(`Map ${entry.id} countries must be an object.`);
    for (const [countryId, entryValue] of Object.entries(raw)) {
      if (
        !isRecord(entryValue) ||
        typeof entryValue.nameEn !== "string" ||
        entryValue.nameEn.trim() === ""
      ) {
        throw new Error(`Map ${entry.id} countries.${countryId} requires nameEn.`);
      }
      countries += 1;
    }
  }

  let demographics = 0;
  const demographicsLayer = manifest.layers.demographics;
  if (demographicsLayer !== undefined) {
    const demographicsPath = await resolveContainedFile(packDir, demographicsLayer, "layers.demographics");
    const raw = await readJson(demographicsPath);
    if (!isRecord(raw)) throw new Error(`Map ${entry.id} demographics must be an object keyed by province id.`);
    const allowedAgeBands = new Set(["child_0_14", "youth_15_24", "prime_25_44", "mature_45_64", "senior_65_plus"]);
    const allowedEducationLevels = new Set(["basic", "secondary", "tertiary", "advanced"]);
    for (const [provinceId, entryValue] of Object.entries(raw)) {
      if (!provinceIds.has(provinceId)) {
        throw new Error(`Map ${entry.id} demographics.${provinceId} references unknown province.`);
      }
      if (!isRecord(entryValue)) {
        throw new Error(`Map ${entry.id} demographics.${provinceId} must be an object.`);
      }
      for (const field of ["pop", "male", "female", "gdpPpp"] as const) {
        if (typeof entryValue[field] !== "number" || !Number.isFinite(entryValue[field] as number)) {
          throw new Error(`Map ${entry.id} demographics.${provinceId} requires finite ${field}.`);
        }
      }
      for (const field of ["age", "education15Plus"] as const) {
        const bucket = entryValue[field];
        if (!isRecord(bucket)) {
          throw new Error(`Map ${entry.id} demographics.${provinceId} requires ${field} object.`);
        }
        if (Object.keys(bucket).length === 0) {
          throw new Error(`Map ${entry.id} demographics.${provinceId} requires non-empty ${field} object.`);
        }
        const allowed = field === "age" ? allowedAgeBands : allowedEducationLevels;
        for (const [key, value] of Object.entries(bucket)) {
          if (!allowed.has(key)) {
            throw new Error(`Map ${entry.id} demographics.${provinceId}.${field}.${key} is not a known ${field} key.`);
          }
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(`Map ${entry.id} demographics.${provinceId}.${field}.${key} must be finite.`);
          }
        }
      }
    }
    demographics = Object.keys(raw).length;
  }

  return {
    provinces: provinces.features.length,
    boundaries: boundaryValue.features.length,
    coastlines,
    countries,
    demographics
  };
}

export async function validateAllMaps(mapsRoot: string): Promise<void> {
  const reports: Record<string, Record<string, number>> = {};
  const mapDirectories = (await readdir(mapsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const directory of mapDirectories) {
    const entry = { id: directory, path: directory };
    reports[entry.id] = await validatePack(mapsRoot, entry);
    console.log(`Validated authored map: ${entry.id}`);
  }
  console.log(JSON.stringify({ validated: reports }, null, 2));
}

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateAllMaps(resolve(toolRoot, "../../assets/maps"));
}
