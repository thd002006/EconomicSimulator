import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MapSchemaError, parseMapPackBundle } from "@economic-simulator/map-runtime";

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mapsRoot = join(toolRoot, "../../data-src/maps");

type MapIndex = {
  maps: Array<{ id: string }>;
};

type RuntimeManifest = {
  assets: Record<string, string>;
};

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function validatePack(packId: string): Promise<Record<string, number>> {
  const packDir = join(mapsRoot, packId);
  const manifest = (await readJson(join(packDir, "map.json"))) as RuntimeManifest;
  const assets = manifest.assets;
  if (
    typeof assets.provinces !== "string" ||
    typeof assets.boundaries !== "string" ||
    typeof assets.spatialIndex !== "string"
  ) {
    throw new Error(`Map pack ${packId} manifest is missing required assets.`);
  }

  const bundle = parseMapPackBundle({
    manifest,
    provinces: await readJson(join(packDir, assets.provinces)),
    boundaries: await readJson(join(packDir, assets.boundaries)),
    spatialIndex: await readJson(join(packDir, assets.spatialIndex)),
    ...(typeof assets.coastlines === "string"
      ? { coastlines: await readJson(join(packDir, assets.coastlines)) }
      : {}),
    ...(typeof assets.cities === "string"
      ? { cities: await readJson(join(packDir, assets.cities)) }
      : {})
  });

  return {
    provinces: bundle.provinces.length,
    boundaries: bundle.boundaries.length,
    coastlines: bundle.coastlines.length,
    cities: bundle.cities.length
  };
}

const index = (await readJson(join(mapsRoot, "index.json"))) as MapIndex;
const reports: Record<string, Record<string, number>> = {};

for (const entry of index.maps) {
  try {
    reports[entry.id] = await validatePack(entry.id);
    console.log(`Validated map pack: ${entry.id}`);
  } catch (error) {
    if (error instanceof MapSchemaError) {
      const message =
        `Map pack ${entry.id} failed schema validation at ${error.layer}` +
        (error.featureId === undefined ? "" : ` (${error.featureId})`) +
        `: ${error.message}`;
      throw new Error(message, { cause: error });
    }
    throw error;
  }
}

console.log(JSON.stringify({ validated: reports }, null, 2));
