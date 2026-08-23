import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectFeatureCollection } from "@economic-simulator/map-runtime";

const CITY_MAX_SCALERANK = 6;

const SOURCES = {
  provinces: {
    fileName: "ne_10m_admin_1_states_provinces_lakes.geojson",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lakes.geojson",
    fallbackUrl:
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
    fallbackFileName: "ne_10m_admin_1_states_provinces.geojson"
  },
  coastlines: {
    fileName: "ne_10m_coastline.geojson",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson"
  },
  cities: {
    fileName: "ne_10m_populated_places.geojson",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson"
  }
} as const;

type GeoJsonFeature = {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown } | null;
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prop(properties: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (properties === null) {
    return undefined;
  }
  for (const key of keys) {
    if (properties[key] !== undefined && properties[key] !== null && properties[key] !== "") {
      return properties[key];
    }
    const upper = key.toUpperCase();
    if (properties[upper] !== undefined && properties[upper] !== null && properties[upper] !== "") {
      return properties[upper];
    }
    const lower = key.toLowerCase();
    if (properties[lower] !== undefined && properties[lower] !== null && properties[lower] !== "") {
      return properties[lower];
    }
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function isValidCode(value: string | undefined): value is string {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }
  if (normalized === "-99" || normalized === "-1" || normalized.toLowerCase() === "null") {
    return false;
  }
  return true;
}

function uniqueId(preferred: string, used: Set<string>, fallback: string): string {
  let candidate = preferred;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  candidate = fallback;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let suffix = 2;
  while (used.has(`${fallback}-${suffix}`)) {
    suffix += 1;
  }
  candidate = `${fallback}-${suffix}`;
  used.add(candidate);
  return candidate;
}

async function downloadTo(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, buffer);
}

async function ensureSource(
  vendorDir: string,
  fileName: string,
  url: string,
  fallback?: { fileName: string; url: string }
): Promise<string> {
  const primaryPath = join(vendorDir, fileName);
  try {
    await readFile(primaryPath);
    return primaryPath;
  } catch {
    // continue to download
  }

  try {
    console.log(`Downloading ${fileName}...`);
    await downloadTo(url, primaryPath);
    return primaryPath;
  } catch (error) {
    if (fallback === undefined) {
      throw error;
    }
    console.warn(`Primary source failed (${String(error)}); trying fallback ${fallback.fileName}`);
    const fallbackPath = join(vendorDir, fallback.fileName);
    await downloadTo(fallback.url, fallbackPath);
    return fallbackPath;
  }
}

async function readFeatureCollection(path: string): Promise<GeoJsonFeatureCollection> {
  const content = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(content) || content.type !== "FeatureCollection" || !Array.isArray(content.features)) {
    throw new Error(`Expected FeatureCollection at ${path}`);
  }
  return content as GeoJsonFeatureCollection;
}

function transformProvinces(source: GeoJsonFeatureCollection): GeoJsonFeatureCollection {
  const used = new Set<string>();
  const features: GeoJsonFeature[] = [];

  for (const [index, feature] of source.features.entries()) {
    if (feature.geometry === null) {
      continue;
    }
    const properties = feature.properties;
    const iso31662 = asString(prop(properties, "iso_3166_2", "ISO_3166_2"));
    const adm1Code = asString(prop(properties, "adm1_code", "ADM1_CODE"));
    const neId = asString(prop(properties, "ne_id", "NE_ID"));
    const preferred = isValidCode(iso31662)
      ? iso31662
      : isValidCode(adm1Code)
        ? adm1Code
        : isValidCode(neId)
          ? `ne-${neId}`
          : `province-${index}`;
    const fallback = isValidCode(neId) ? `ne-${neId}` : `province-${index}`;
    const id = uniqueId(preferred, used, fallback);

    features.push({
      type: "Feature",
      id,
      properties: {
        name: asString(prop(properties, "name", "NAME")) ?? id,
        nameEn: asString(prop(properties, "name_en", "NAME_EN", "name")),
        adm0A3: asString(prop(properties, "adm0_a3", "ADM0_A3")),
        isoA2: asString(prop(properties, "iso_a2", "ISO_A2")),
        type: asString(prop(properties, "type_en", "TYPE_EN", "type", "TYPE", "engtype", "ENGTYPE"))
      },
      geometry: feature.geometry
    });
  }

  return { type: "FeatureCollection", features };
}

function transformCoastlines(source: GeoJsonFeatureCollection): GeoJsonFeatureCollection {
  const used = new Set<string>();
  const features: GeoJsonFeature[] = [];

  for (const [index, feature] of source.features.entries()) {
    if (feature.geometry === null) {
      continue;
    }
    const properties = feature.properties;
    const neId = asString(prop(properties, "ne_id", "NE_ID"));
    const preferred = isValidCode(neId) ? `coastline-${neId}` : `coastline-${index}`;
    const id = uniqueId(preferred, used, `coastline-${index}`);
    const scalerank = prop(properties, "scalerank", "SCALERANK", "scale_rank", "SCALE_RANK");

    features.push({
      type: "Feature",
      id,
      properties: {
        scalerank: typeof scalerank === "number" ? scalerank : Number(scalerank)
      },
      geometry: feature.geometry
    });
  }

  return { type: "FeatureCollection", features };
}

function transformCities(source: GeoJsonFeatureCollection): GeoJsonFeatureCollection {
  const used = new Set<string>();
  const features: GeoJsonFeature[] = [];

  for (const [index, feature] of source.features.entries()) {
    if (feature.geometry === null) {
      continue;
    }
    const properties = feature.properties;
    const scalerankRaw = prop(properties, "scalerank", "SCALERANK", "scale_rank", "SCALE_RANK");
    const scalerank = typeof scalerankRaw === "number" ? scalerankRaw : Number(scalerankRaw);
    if (!Number.isFinite(scalerank) || scalerank > CITY_MAX_SCALERANK) {
      continue;
    }

    const geonameId = asString(prop(properties, "geonameid", "GEONAMEID", "GEONAME_ID"));
    const neId = asString(prop(properties, "ne_id", "NE_ID"));
    const preferred = isValidCode(geonameId)
      ? `city-${geonameId}`
      : isValidCode(neId)
        ? `city-ne-${neId}`
        : `city-${index}`;
    const id = uniqueId(preferred, used, `city-${index}`);

    features.push({
      type: "Feature",
      id,
      properties: {
        name: asString(prop(properties, "name", "NAME", "NAMEASCII", "nameascii")) ?? id,
        adm0A3: asString(prop(properties, "adm0_a3", "ADM0_A3", "SOV_A3", "sov_a3")),
        scalerank
      },
      geometry: feature.geometry
    });
  }

  return { type: "FeatureCollection", features };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function main(): Promise<void> {
  const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = resolve(toolRoot, "../..");
  const vendorDir = join(repoRoot, "data-src/maps/_vendor/natural-earth");
  const outDir = join(repoRoot, "data-src/maps/world-modern");

  const provincesPath = await ensureSource(
    vendorDir,
    SOURCES.provinces.fileName,
    SOURCES.provinces.url,
    { fileName: SOURCES.provinces.fallbackFileName, url: SOURCES.provinces.fallbackUrl }
  );
  const coastlinesPath = await ensureSource(vendorDir, SOURCES.coastlines.fileName, SOURCES.coastlines.url);
  const citiesPath = await ensureSource(vendorDir, SOURCES.cities.fileName, SOURCES.cities.url);

  console.log("Transforming provinces...");
  const provinces = transformProvinces(await readFeatureCollection(provincesPath));
  console.log("Transforming coastlines...");
  const coastlines = transformCoastlines(await readFeatureCollection(coastlinesPath));
  console.log("Transforming cities...");
  const cities = transformCities(await readFeatureCollection(citiesPath));

  const reports = {
    provinces: inspectFeatureCollection(provinces),
    coastlines: inspectFeatureCollection(coastlines),
    cities: inspectFeatureCollection(cities)
  };

  await writeJson(join(outDir, "provinces.geojson"), provinces);
  await writeJson(join(outDir, "coastlines.geojson"), coastlines);
  await writeJson(join(outDir, "cities.geojson"), cities);
  await writeJson(join(outDir, "map.json"), {
    schemaVersion: 1,
    id: "world-modern",
    version: "0.1.0",
    nameKey: "map.worldModern.name",
    coordinateReferenceSystem: "EPSG:4326",
    layers: {
      provinces: "provinces.geojson",
      coastlines: "coastlines.geojson",
      cities: "cities.geojson"
    },
    source: {
      provider: "Natural Earth",
      license: "public domain",
      scale: "1:10m",
      themes: {
        provinces: "ne_10m_admin_1_states_provinces_lakes",
        coastlines: "ne_10m_coastline",
        cities: "ne_10m_populated_places"
      },
      cityMaxScalerank: CITY_MAX_SCALERANK
    }
  });

  console.log(JSON.stringify({ outDir, reports }, null, 2));
}

await main();
