import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromArrayBuffer, type GeoTIFFImage } from "geotiff";
import { pointInGeometry } from "./geo.js";
import { GeoTiffRaster } from "./socioeconomic/raster.js";
import type { AreaGeometry, GeoJsonFeatureCollection } from "./types.js";

const CROP_CODES = [
  "ban", "brl", "cc2", "cot", "fdd",
  "frt", "grd", "mlt", "mze", "nes",
  "oce", "olp", "olv", "pls", "rcw",
  "rsd", "rt1", "rt2", "rt3", "sfl",
  "soy", "srg", "sub", "suc", "tob", "veg", "whe"
] as const;

interface ProvinceInput {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  readonly countryId: string;
  readonly geometry: AreaGeometry;
  readonly bbox: [number, number, number, number];
}

class ClimateRaster {
  static async open(filePath: string): Promise<ClimateRaster | undefined> {
    try {
      const buffer = await readFile(filePath);
      const tiff = await fromArrayBuffer(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      );
      const image = await tiff.getImage();
      const directory = image.fileDirectory;
      const scale = directory.ModelPixelScale as number[] | undefined;
      const tie = directory.ModelTiepoint as number[] | undefined;
      if (!scale || !tie || scale.length < 3 || tie.length < 6) return undefined;
      const nodataTag = directory.GDAL_NODATA as unknown;
      let nodata: number | undefined;
      if (typeof nodataTag === "string") {
        const match = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(nodataTag);
        nodata = match === null ? undefined : Number(match[0]);
      } else if (typeof nodataTag === "number" && Number.isFinite(nodataTag)) {
        nodata = nodataTag;
      }
      return new ClimateRaster(
        image,
        image.getWidth(),
        image.getHeight(),
        scale[0]!,
        Math.abs(scale[1]!),
        tie[3]!,
        tie[4]!,
        nodata
      );
    } catch {
      return undefined;
    }
  }

  private constructor(
    private readonly image: GeoTIFFImage,
    readonly width: number,
    readonly height: number,
    private readonly scaleX: number,
    private readonly scaleY: number,
    private readonly tieX: number,
    private readonly tieY: number,
    private readonly nodata: number | undefined
  ) {}

  async samplePolygonMean(
    geometry: AreaGeometry,
    bbox: [number, number, number, number]
  ): Promise<number | undefined> {
    const left = Math.max(0, Math.floor((bbox[0] - this.tieX) / this.scaleX));
    const right = Math.min(this.width, Math.ceil((bbox[2] - this.tieX) / this.scaleX));
    const top = Math.max(0, Math.floor((this.tieY - bbox[3]) / this.scaleY));
    const bottom = Math.min(this.height, Math.ceil((this.tieY - bbox[1]) / this.scaleY));
    if (left >= right || top >= bottom) return undefined;

    const windowWidth = right - left;
    const windowHeight = bottom - top;
    const totalPixels = windowWidth * windowHeight;
    const step = totalPixels > 100_000 ? Math.ceil(Math.sqrt(totalPixels / 10_000)) : 1;

    const rasters = await this.image.readRasters({
      window: [left, top, right, bottom],
      samples: [0]
    });
    const data = rasters[0] as Float32Array | Float64Array | Int16Array | Uint16Array;
    let sum = 0;
    let count = 0;

    for (let r = 0; r < windowHeight; r += step) {
      const rowOffset = r * windowWidth;
      const lat = this.tieY - (top + r + 0.5) * this.scaleY;
      for (let c = 0; c < windowWidth; c += step) {
        const val = Number(data[rowOffset + c]);
        if (!Number.isFinite(val)) continue;
        if (
          this.nodata !== undefined &&
          (Object.is(val, this.nodata) || Math.abs(val - this.nodata) < 1e-4)
        ) {
          continue;
        }
        if (val < -100 || val > 100_000) continue;
        const lon = this.tieX + (left + c + 0.5) * this.scaleX;
        if (pointInGeometry([lon, lat], geometry)) {
          sum += val;
          count++;
        }
      }
    }
    return count > 0 ? sum / count : undefined;
  }
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let inQuotes = false;
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function geometryBbox(geometry: AreaGeometry): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const rings = geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

function meanCentroidLat(geometry: AreaGeometry): number {
  let sumLat = 0, count = 0;
  const rings = geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [, lat] of ring) {
      sumLat += lat;
      count++;
    }
  }
  return count > 0 ? sumLat / count : 0;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function computeCultivationConditionFromClimate(meanTempC: number, meanPrecipMm: number): number {
  let tempFactor: number;
  if (meanTempC < 0) {
    tempFactor = 0.05 + 0.10 * Math.max(0, 1 + meanTempC / 10);
  } else if (meanTempC < 15) {
    tempFactor = 0.15 + 0.80 * (meanTempC / 15);
  } else if (meanTempC <= 25) {
    tempFactor = 0.95;
  } else if (meanTempC <= 35) {
    tempFactor = 0.95 - 0.40 * ((meanTempC - 25) / 10);
  } else {
    tempFactor = 0.55 - 0.40 * Math.min(1, (meanTempC - 35) / 10);
  }

  let precipFactor: number;
  if (meanPrecipMm < 200) {
    precipFactor = 0.05 + 0.15 * (meanPrecipMm / 200);
  } else if (meanPrecipMm < 600) {
    precipFactor = 0.20 + 0.70 * ((meanPrecipMm - 200) / 400);
  } else if (meanPrecipMm <= 2000) {
    precipFactor = 0.90 + 0.05 * Math.min(1, (meanPrecipMm - 600) / 400);
  } else {
    precipFactor = 0.95 - 0.15 * Math.min(1, (meanPrecipMm - 2000) / 2000);
  }

  return clamp(Math.round(tempFactor * precipFactor * 1000) / 1000, 0.05, 0.95);
}

function computeHabitabilityFromClimate(meanTempC: number, meanPrecipMm: number): number {
  let tempFactor: number;
  if (meanTempC < -15) {
    tempFactor = 0.05;
  } else if (meanTempC < 0) {
    tempFactor = 0.05 + 0.35 * ((meanTempC + 15) / 15);
  } else if (meanTempC < 12) {
    tempFactor = 0.40 + 0.55 * (meanTempC / 12);
  } else if (meanTempC <= 22) {
    tempFactor = 0.95;
  } else if (meanTempC <= 30) {
    tempFactor = 0.95 - 0.15 * ((meanTempC - 22) / 8);
  } else {
    tempFactor = 0.80 - 0.50 * Math.min(1, (meanTempC - 30) / 10);
  }

  let precipFactor: number;
  if (meanPrecipMm < 100) {
    precipFactor = 0.20 + 0.30 * (meanPrecipMm / 100);
  } else if (meanPrecipMm < 400) {
    precipFactor = 0.50 + 0.40 * ((meanPrecipMm - 100) / 300);
  } else {
    precipFactor = 0.90 + 0.05 * Math.min(1, (meanPrecipMm - 400) / 600);
  }

  return clamp(Math.round(tempFactor * (0.2 + 0.8 * precipFactor) * 1000) / 1000, 0.05, 0.95);
}

function classifyClimateFromTemp(meanTempC: number): { terrainProfileId: string; climateProfileId: string } {
  if (meanTempC < -5) return { terrainProfileId: "arctic", climateProfileId: "arctic" };
  if (meanTempC < 5) return { terrainProfileId: "boreal", climateProfileId: "boreal" };
  if (meanTempC < 18) return { terrainProfileId: "temperate", climateProfileId: "temperate" };
  if (meanTempC < 24) return { terrainProfileId: "subtropical", climateProfileId: "subtropical" };
  return { terrainProfileId: "tropical", climateProfileId: "tropical" };
}

async function loadProvinces(geoJsonPath: string): Promise<Map<string, ProvinceInput>> {
  const raw = JSON.parse(await readFile(geoJsonPath, "utf8")) as unknown as GeoJsonFeatureCollection;
  const map = new Map<string, ProvinceInput>();
  for (const feature of raw.features) {
    if (!feature.properties || !feature.geometry) continue;
    const props = feature.properties;
    const id = String(feature.id ?? props.id ?? "");
    if (!id) continue;
    const geometry = feature.geometry as AreaGeometry | null;
    if (geometry === null || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    map.set(id, {
      id,
      name: typeof props.name === "string" ? props.name : id,
      nameEn: typeof props.nameEn === "string" ? props.nameEn : id,
      countryId: typeof props.adm0A3 === "string" ? props.adm0A3 : "UNK",
      geometry,
      bbox: geometryBbox(geometry)
    });
  }
  return map;
}

async function loadLandAreas(provinceCsvDir: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  try {
    const countriesPath = join(provinceCsvDir, "..", "countries.csv");
    const entries = (await readFile(countriesPath, "utf8")).trim().split("\n");
    const header = parseCsvLine(entries[0]!);
    const areaIdx = header.indexOf("land_area_km2");
    if (areaIdx >= 0) {
      for (let i = 1; i < entries.length; i++) {
        const cells = parseCsvLine(entries[i]!);
        if (cells.length < 2) continue;
        const area = Number(cells[areaIdx] ?? 0);
        if (area > 0) result.set(cells[0]!, area);
      }
      if (result.size > 0) return result;
    }
  } catch { /* noop */ }
  return result;
}

interface ProvinceAcc {
  province: ProvinceInput;
  arableHa: number;
  lat: number;
  meanTempC?: number | undefined;
  meanPrecipMm?: number | undefined;
  terrainProfileId: string;
  climateProfileId: string;
  cultivationCondition: number;
  habitability: number;
}

async function aggregateForProvinces(
  provinces: Map<string, ProvinceInput>,
  agrarianDir: string
): Promise<Map<string, ProvinceAcc>> {
  const gaezDir = join(agrarianDir, "gaez");
  const bioDir = join(agrarianDir, "bio");
  const results = new Map<string, ProvinceAcc>();

  const bio1Raster = await ClimateRaster.open(join(bioDir, "bio_1.tif"));
  const bio12Raster = await ClimateRaster.open(join(bioDir, "bio_12.tif"));

  if (bio1Raster === undefined || bio12Raster === undefined) {
    throw new Error(
      "Missing WorldClim rasters (bio_1.tif, bio_12.tif) under cache/agrarian/bio. " +
        "Run fetch:agrarian first to download required climate datasets."
    );
  }

  console.log("  [ok] Loaded WorldClim bio_1.tif & bio_12.tif rasters for climate calculation.");

  for (const [, prov] of provinces) {
    const lat = meanCentroidLat(prov.geometry);
    const meanTempC = await bio1Raster.samplePolygonMean(prov.geometry, prov.bbox);
    const meanPrecipMm = await bio12Raster.samplePolygonMean(prov.geometry, prov.bbox);

    if (meanTempC === undefined || meanPrecipMm === undefined) {
      throw new Error(`Failed to sample climate for province ${prov.id}.`);
    }

    const cultivationCondition = computeCultivationConditionFromClimate(meanTempC, meanPrecipMm);
    const habitability = computeHabitabilityFromClimate(meanTempC, meanPrecipMm);
    const classified = classifyClimateFromTemp(meanTempC);
    const terrainProfileId = classified.terrainProfileId;
    const climateProfileId = classified.climateProfileId;

    results.set(prov.id, {
      province: prov,
      arableHa: 0,
      lat,
      meanTempC,
      meanPrecipMm,
      terrainProfileId,
      climateProfileId,
      cultivationCondition,
      habitability
    });
  }

  let cropIdx = 0;
  for (const code of CROP_CODES) {
    cropIdx++;
    const path = join(gaezDir, `${code}__har.tif`);
    let raster: GeoTiffRaster;
    try {
      raster = await GeoTiffRaster.open(path);
    } catch {
      continue;
    }

    const done = Math.round((cropIdx / CROP_CODES.length) * 100);
    console.log(`  Crop ${cropIdx}/${CROP_CODES.length} (${code}): ${done}%`);

    for (const [, acc] of results) {
      const prov = acc.province;
      await raster.forEachBlock(prov.bbox, (sample) => {
        if (sample.value <= 0) return;
        if (pointInGeometry([sample.lon, sample.lat], prov.geometry)) {
          acc.arableHa += sample.value;
        }
      });
    }
  }

  return results;
}

async function writeProvinceCsv(
  csvDir: string,
  provinces: Map<string, ProvinceInput>,
  agrarianResults: Map<string, ProvinceAcc>
): Promise<void> {
  let written = 0;
  const targetFields = [
    "arable_land_km2",
    "cultivation_condition",
    "habitability",
    "terrain_profile_id",
    "climate_profile_id"
  ];
  for (const [id, acc] of agrarianResults) {
    const prov = provinces.get(id);
    if (!prov) continue;

    const csvPath = join(csvDir, id, "province.csv");
    let existingLines: string[] = [];
    try {
      existingLines = (await readFile(csvPath, "utf8")).trim().split("\n");
    } catch {
      existingLines = [];
    }

    const header = existingLines[0] ?? "id,name,name_en,owner_country_id,land_area_km2,arable_land_km2,cultivation_condition,habitability,terrain_profile_id,climate_profile_id";
    const headers = parseCsvLine(header);
    const dataRow = existingLines[1] !== undefined ? parseCsvLine(existingLines[1]) : headers.map(() => "");

    const updates: Record<string, string> = {
      arable_land_km2: String(Math.round(acc.arableHa * 5)),
      cultivation_condition: String(acc.cultivationCondition),
      habitability: String(acc.habitability),
      terrain_profile_id: acc.terrainProfileId,
      climate_profile_id: acc.climateProfileId
    };

    for (const field of targetFields) {
      const idx = headers.indexOf(field);
      if (idx >= 0) {
        dataRow[idx] = updates[field]!;
      } else {
        headers.push(field);
        dataRow.push(updates[field]!);
      }
    }

    const newHeader = headers.map(v => v.includes(",") ? `"${v}"` : v).join(",");
    const newRow = dataRow.map(v => v.includes(",") ? `"${v}"` : v).join(",");
    await mkdir(join(csvDir, id), { recursive: true });
    await writeFile(csvPath, `${newHeader}\n${newRow}\n`, "utf8");
    written++;
  }
  console.log(`Wrote ${written} province CSVs`);
}

export interface AgrarianReport {
  generated: string;
  sources: Record<string, string>;
  stats: {
    total: number;
    arableLandKm2: { min: number; p5: number; median: number; p95: number; max: number };
    cultivationCondition: { min: number; p5: number; median: number; p95: number; max: number };
    habitability: { min: number; p5: number; median: number; p95: number; max: number };
  };
  flaggedForReview: {
    id: string;
    name: string;
    arableLandKm2: number;
    landAreaKm2: number;
    cultivationCondition: number;
    habitability: number;
    meanTempC?: number | undefined;
    meanPrecipMm?: number | undefined;
    terrainProfileId: string;
    reason: string;
  }[];
}

export interface AggregateAgrarianOptions {
  readonly agrarianDir: string;
  readonly provincesGeoJson: string;
  readonly provincesCsvDir: string;
  readonly reportPath?: string;
  readonly limit?: number;
}

export async function aggregateAgrarian(options: AggregateAgrarianOptions): Promise<void> {
  console.log("Loading provinces...");
  const provinces = await loadProvinces(options.provincesGeoJson);
  console.log(`Loaded ${provinces.size} provinces`);

  console.log("Loading land areas from CSV...");
  const landAreas = await loadLandAreas(options.provincesCsvDir);
  console.log(`Loaded ${landAreas.size} land areas`);

  let provinceMap = provinces;
  if (options.limit !== undefined) {
    const limited = new Map<string, ProvinceInput>();
    let count = 0;
    for (const [id, prov] of provinces) {
      limited.set(id, prov);
      count++;
      if (count >= options.limit) break;
    }
    provinceMap = limited;
    console.log(`Limited to ${limited.size} provinces`);
  }

  console.log("Aggregating GAEZ crop harvested area and climate indices...");
  const agrarianResults = await aggregateForProvinces(provinceMap, options.agrarianDir);

  console.log("Writing province CSVs...");
  await writeProvinceCsv(options.provincesCsvDir, provinceMap, agrarianResults);

  if (options.reportPath) {
    const csvLandAreas = new Map<string, number>();
    const paths = [...agrarianResults.keys()].map(async (id) => {
      const csvPath = join(options.provincesCsvDir, id, "province.csv");
      try {
        const lines = (await readFile(csvPath, "utf8")).trim().split("\n");
        if (lines.length >= 2) {
          const cells = parseCsvLine(lines[1]!);
          const hdr = parseCsvLine(lines[0]!);
          const idx = hdr.indexOf("land_area_km2");
          if (idx >= 0) csvLandAreas.set(id, Number(cells[idx]) || 0);
        }
      } catch { /* noop */ }
    });
    await Promise.all(paths);

    const entries = [...agrarianResults.entries()].map(([id, acc]) => ({
      id,
      name: acc.province.name,
      arableLandKm2: Math.round(acc.arableHa * 5),
      landAreaKm2: landAreas.get(id) ?? csvLandAreas.get(id) ?? 0,
      cultivationCondition: acc.cultivationCondition,
      habitability: acc.habitability,
      meanTempC: acc.meanTempC !== undefined ? Math.round(acc.meanTempC * 10) / 10 : undefined,
      meanPrecipMm: acc.meanPrecipMm !== undefined ? Math.round(acc.meanPrecipMm) : undefined,
      terrainProfileId: acc.terrainProfileId
    }));

    const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p)] ?? 0;
    const sortedArable = [...entries.map(e => e.arableLandKm2)].sort((a, b) => a - b);
    const sortedCult = [...entries.map(e => e.cultivationCondition)].sort((a, b) => a - b);
    const sortedHab = [...entries.map(e => e.habitability)].sort((a, b) => a - b);

    const flagged = entries
      .map(e => {
        let reason = "";
        if (e.arableLandKm2 === 0 && e.landAreaKm2 > 1000 && e.terrainProfileId !== "arctic") {
          reason = "Large province with zero GAEZ cropland (non-arctic)";
        }
        return { ...e, reason };
      })
      .filter(e => e.reason !== "");

    const report: AgrarianReport = {
      generated: new Date().toISOString(),
      sources: {
        arableLand: "FAO GAEZ Theme 5 (2010) crop harvested area; unit conversion: raw value * 5 km² per unit (scale calibrated to match known India wheat ~30,000 km²)",
        cultivationCondition: "WorldClim 2.1 BioClim (BIO1 Annual Mean Temperature + BIO12 Annual Precipitation) or latitude model fallback",
        habitability: "WorldClim 2.1 BioClim (BIO1 Annual Mean Temperature + BIO12 Annual Precipitation) or latitude model fallback"
      },
      stats: {
        total: entries.length,
        arableLandKm2: {
          min: sortedArable[0] ?? 0,
          p5: pct(sortedArable, 0.05),
          median: pct(sortedArable, 0.5),
          p95: pct(sortedArable, 0.95),
          max: sortedArable[sortedArable.length - 1] ?? 0
        },
        cultivationCondition: {
          min: sortedCult[0] ?? 0,
          p5: pct(sortedCult, 0.05),
          median: pct(sortedCult, 0.5),
          p95: pct(sortedCult, 0.95),
          max: sortedCult[sortedCult.length - 1] ?? 0
        },
        habitability: {
          min: sortedHab[0] ?? 0,
          p5: pct(sortedHab, 0.05),
          median: pct(sortedHab, 0.5),
          p95: pct(sortedHab, 0.95),
          max: sortedHab[sortedHab.length - 1] ?? 0
        }
      },
      flaggedForReview: flagged
    };

    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`Report: ${options.reportPath}`);
    console.log(`Flagged: ${flagged.length} provinces for review`);
  }
}

function parseArgs(args: readonly string[]): AggregateAgrarianOptions {
  let agrarianDir = "cache/agrarian";
  let provincesGeoJson = "base/world-admin1/geometry/provinces.geojson";
  let provincesCsvDir = "base/world-admin1/provinces";
  let reportPath: string | undefined;
  let limit: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--agrarian-dir") agrarianDir = args[++i]!;
    else if (a === "--geojson") provincesGeoJson = args[++i]!;
    else if (a === "--csv-dir") provincesCsvDir = args[++i]!;
    else if (a === "--report") reportPath = args[++i]!;
    else if (a === "--limit") limit = Number(args[++i]!);
    else if (a === "--help" || a === "-h") {
      console.log("Usage: aggregate-agrarian [--agrarian-dir <dir>] [--geojson <geojson>] [--csv-dir <provinces-dir>] [--report <path>] [--limit N]");
      process.exit(0);
    }
  }
  if (reportPath !== undefined && limit !== undefined) return { agrarianDir, provincesGeoJson, provincesCsvDir, reportPath, limit };
  if (reportPath !== undefined) return { agrarianDir, provincesGeoJson, provincesCsvDir, reportPath };
  if (limit !== undefined) return { agrarianDir, provincesGeoJson, provincesCsvDir, limit };
  return { agrarianDir, provincesGeoJson, provincesCsvDir };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const opts = parseArgs(process.argv.slice(2));
  const resolved: AggregateAgrarianOptions = {
    agrarianDir: resolve(projectRoot, opts.agrarianDir),
    provincesGeoJson: resolve(projectRoot, opts.provincesGeoJson),
    provincesCsvDir: resolve(projectRoot, opts.provincesCsvDir)
  };
  const finalOpts: AggregateAgrarianOptions = (() => {
    if (opts.reportPath !== undefined && opts.limit !== undefined) {
      return { agrarianDir: resolved.agrarianDir, provincesGeoJson: resolved.provincesGeoJson, provincesCsvDir: resolved.provincesCsvDir, reportPath: resolve(projectRoot, opts.reportPath), limit: opts.limit };
    }
    if (opts.reportPath !== undefined) {
      return { agrarianDir: resolved.agrarianDir, provincesGeoJson: resolved.provincesGeoJson, provincesCsvDir: resolved.provincesCsvDir, reportPath: resolve(projectRoot, opts.reportPath) };
    }
    if (opts.limit !== undefined) {
      return { agrarianDir: resolved.agrarianDir, provincesGeoJson: resolved.provincesGeoJson, provincesCsvDir: resolved.provincesCsvDir, limit: opts.limit };
    }
    return resolved;
  })();
  await aggregateAgrarian(finalOpts);
}
