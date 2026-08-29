import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, pointInGeometry, validCode } from "../geo.js";
import type { AreaGeometry, GeoJsonFeatureCollection } from "../types.js";
import { writeProvinceCsvSkeleton } from "../build-world-modern.js";
import {
  loadSocioeconomicConfig,
  ensureSocioeconomicSources,
  type SocioeconomicConfig
} from "../fetch-socioeconomic.js";
import { EDUCATION_LEVEL_IDS, loadWppDemographics, wppKeyFor, type CountryAgeSex } from "./wpp.js";
import { educationForBand, loadEducationTables, type EducationTables } from "./education.js";
import { GeoTiffRaster } from "./raster.js";

export const MISSING_WPP_POP_FALLBACK = 10_000;

export interface ProvinceDemographicsEntry {
  readonly pop: number;
  readonly male: number;
  readonly female: number;
  readonly age: Record<number, number>;
  readonly education15Plus: Record<string, number>;
  readonly gdpPpp: number;
}

interface ProvinceInput {
  readonly id: string;
  readonly nameEn: string;
  readonly adm0A3: string;
  readonly geometry: AreaGeometry;
  readonly bbox: [number, number, number, number];
}

function computeBBox(geometry: AreaGeometry): [number, number, number, number] {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

async function loadProvinces(path: string): Promise<ProvinceInput[]> {
  const collection = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(collection) || !Array.isArray(collection.features)) {
    throw new Error(`Expected FeatureCollection at ${path}.`);
  }
  const result: ProvinceInput[] = [];
  for (const feature of collection.features) {
    if (!isRecord(feature) || !isRecord(feature.properties)) continue;
    const id = typeof feature.id === "string" ? feature.id : String(feature.id ?? "");
    const adm0A3Raw = feature.properties.adm0A3 ?? feature.properties.adm0_a3;
    const adm0A3Candidate = typeof adm0A3Raw === "string" ? adm0A3Raw : undefined;
    const adm0A3 = validCode(adm0A3Candidate) ? adm0A3Candidate : undefined;
    const nameEn =
      typeof feature.properties.nameEn === "string"
        ? feature.properties.nameEn
        : typeof feature.properties.name === "string"
          ? feature.properties.name
          : id;
    if (!validCode(id) || adm0A3 === undefined) continue;
    const geometry = feature.geometry as AreaGeometry | null;
    if (geometry === null || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
      continue;
    }
    result.push({ id, nameEn, adm0A3, geometry, bbox: computeBBox(geometry) });
  }
  return result;
}

const GRID_CELL_DEGREES = 4;

class ProvinceIndex {
  private readonly cells = new Map<string, ProvinceInput[]>();

  constructor(provinces: readonly ProvinceInput[]) {
    for (const province of provinces) {
      this.register(province);
    }
  }

  private register(province: ProvinceInput): void {
    const [minLon, minLat, maxLon, maxLat] = province.bbox;
    const spansAntimeridian = maxLon - minLon > 180 || minLon < -180 || maxLon > 180;
    const intervals: Array<[number, number]> = spansAntimeridian
      ? [
          [minLon, 180],
          [-180, maxLon > 180 ? maxLon - 360 : maxLon]
        ]
      : [[minLon, maxLon]];
    for (const [intervalMinLon, intervalMaxLon] of intervals) {
      for (
        let lonCell = Math.floor(intervalMinLon / GRID_CELL_DEGREES);
        lonCell <= Math.floor(intervalMaxLon / GRID_CELL_DEGREES);
        lonCell += 1
      ) {
        for (
          let latCell = Math.floor(minLat / GRID_CELL_DEGREES);
          latCell <= Math.floor(maxLat / GRID_CELL_DEGREES);
          latCell += 1
        ) {
          const key = `${lonCell}:${latCell}`;
          const bucket = this.cells.get(key);
          if (bucket === undefined) this.cells.set(key, [province]);
          else if (!bucket.includes(province)) bucket.push(province);
        }
      }
    }
  }

  private hitTestWithLon(lon: number, lat: number): ProvinceInput | undefined {
    const key = `${Math.floor(lon / GRID_CELL_DEGREES)}:${Math.floor(lat / GRID_CELL_DEGREES)}`;
    const bucket = this.cells.get(key);
    if (bucket === undefined) return undefined;
    for (const province of bucket) {
      const spansAntimeridian = province.bbox[2] - province.bbox[0] > 180;
      const insideLon = spansAntimeridian
        ? lon >= province.bbox[0] - 1e-9 || lon <= province.bbox[2] + 1e-9
        : lon >= province.bbox[0] - 1e-9 && lon <= province.bbox[2] + 1e-9;
      if (!insideLon || lat < province.bbox[1] - 1e-9 || lat > province.bbox[3] + 1e-9) {
        continue;
      }
      if (pointInGeometry([lon, lat], province.geometry)) return province;
    }
    return undefined;
  }

  /** Handles antimeridian wrapping by testing normalized and shifted longitudes. */
  hitTest(lon: number, lat: number): ProvinceInput | undefined {
    const normalizedLon = ((((lon + 180) % 360) + 360) % 360) - 180;
    return (
      this.hitTestWithLon(normalizedLon, lat) ??
      (lon !== normalizedLon ? this.hitTestWithLon(lon, lat) : undefined)
    );
  }
}

/** Monotone education shift driven by relative province GDP per capita. */
export function adjustEducationShares(
  shares: Record<string, number>,
  relativeGdpPerCapita: number,
  maxShiftSharePoints: number
): Record<string, number> {
  const tiers = ["basic", "secondary", "tertiary", "advanced"] as const;
  const total = tiers.reduce((sum, tier) => sum + (shares[tier] ?? 0), 0);
  if (total <= 0 || !Number.isFinite(relativeGdpPerCapita) || relativeGdpPerCapita <= 0) {
    return { ...shares };
  }
  const normalized = Object.fromEntries(
    tiers.map((tier) => [tier, (shares[tier] ?? 0) / total])
  ) as Record<(typeof tiers)[number], number>;
  const shift = (maxShiftSharePoints / 100) * Math.tanh(Math.log(relativeGdpPerCapita));
  if (shift === 0) return normalized;
  if (shift > 0) {
    // Move share points upward: drain basic first, then secondary.
    let remaining = shift;
    for (const sourceTier of ["basic", "secondary"] as const) {
      const drained = Math.min(normalized[sourceTier], remaining);
      normalized[sourceTier] -= drained;
      remaining -= drained;
      if (remaining <= 0) break;
    }
    const gainTotal = shift - remaining;
    const upperWeight =
      normalized.tertiary + normalized.advanced > 0
        ? [normalized.tertiary, normalized.advanced]
        : [1, 0];
    normalized.tertiary += (gainTotal * upperWeight[0]!) / (upperWeight[0]! + upperWeight[1]!);
    normalized.advanced += (gainTotal * upperWeight[1]!) / (upperWeight[0]! + upperWeight[1]!);
  } else {
    let remaining = -shift;
    for (const sourceTier of ["advanced", "tertiary"] as const) {
      const drained = Math.min(normalized[sourceTier], remaining);
      normalized[sourceTier] -= drained;
      remaining -= drained;
      if (remaining <= 0) break;
    }
    const gainTotal = -shift - remaining;
    normalized.secondary += gainTotal;
  }
  const newTotal = tiers.reduce((sum, tier) => sum + normalized[tier], 0);
  for (const tier of tiers) normalized[tier] /= newTotal;
  return normalized;
}

export interface AggregateOptions {
  readonly provincesPath: string;
  readonly outputPath: string;
  readonly populationBlockSizePx?: number;
}

export async function aggregateSocioeconomic(
  projectRoot: string,
  config: SocioeconomicConfig,
  options: AggregateOptions
): Promise<Record<string, ProvinceDemographicsEntry>> {
  const sources = await ensureSocioeconomicSources(projectRoot, config);
  const baseYearText = String(config.baseYear);
  const [wpp, education, provinces] = await Promise.all([
    loadWppDemographics(
      sources.wppMalePath,
      sources.wppFemalePath,
      sources.countryTablePath,
      baseYearText
    ),
    loadEducationTables(
      sources.educationCsvPath,
      config.baseYear,
      config.education.interpolationYears
    ),
    loadProvinces(options.provincesPath)
  ]);

  console.log(`Aggregating ${provinces.length} provinces against rasters...`);
  const populationRaster = await GeoTiffRaster.open(sources.ghsPopTifPath, {
    blockSizePx: options.populationBlockSizePx ?? 10
  });
  const index = new ProvinceIndex(provinces);

  const ghsSums = new Map<string, number>();
  const gdpSums = new Map<string, number>();
  const warnings: string[] = [];

  // A single global pass over the raster. Scanning per province would read
  // overlapping windows and double-count blocks shared between neighbours.
  const accumulate = async (raster: GeoTiffRaster, sums: Map<string, number>): Promise<void> => {
    let samples = 0;
    const t0 = Date.now();
    await raster.forEachBlock([-180, -90, 180, 90], (sample) => {
      const owner = index.hitTest(sample.lon, sample.lat);
      if (owner === undefined) return;
      samples += 1;
      sums.set(owner.id, (sums.get(owner.id) ?? 0) + sample.value);
    });
    console.log(
      `  ${raster.crs}: ${samples.toLocaleString()} samples in ${((Date.now() - t0) / 1000).toFixed(
        0
      )}s`
    );
  };

  await accumulate(populationRaster, ghsSums);

  const ghsByCountry = new Map<string, number>();
  for (const province of provinces) {
    const wppKey = wppKeyFor(province.adm0A3);
    ghsByCountry.set(wppKey, (ghsByCountry.get(wppKey) ?? 0) + (ghsSums.get(province.id) ?? 0));
  }

  const scaleByCountry = new Map<string, { scale: number; pyramid: CountryAgeSex }>();
  for (const province of provinces) {
    const wppKey = wppKeyFor(province.adm0A3);
    if (scaleByCountry.has(wppKey)) continue;
    const national = wpp.byCountry.get(wppKey);
    const rasterPopulation = ghsByCountry.get(wppKey) ?? 0;
    if (national === undefined) {
      warnings.push(
        `${province.adm0A3}: missing in WPP ${config.baseYear}; fixed to ${MISSING_WPP_POP_FALLBACK}.`
      );
      scaleByCountry.set(wppKey, {
        scale: 1,
        pyramid: wpp.world.ageSex
      });
    } else if (rasterPopulation > 0) {
      scaleByCountry.set(wppKey, {
        scale: national.populationBaseYearPersons / rasterPopulation,
        pyramid: national.ageSex
      });
    } else {
      warnings.push(`${province.adm0A3}: no raster population; WPP totals cannot be distributed.`);
      scaleByCountry.set(wppKey, {
        scale: 1,
        pyramid: national.ageSex
      });
    }
  }

  const gdpTifPath = join(
    dirname(sources.kummuNcPath),
    config.gdpPpp.convertedFileName ?? "kummu_gdp_ppp_2001.tif"
  );
  try {
    const gdpRaster = await GeoTiffRaster.open(gdpTifPath, { blockSizePx: 1 });
    await accumulate(gdpRaster, gdpSums);
  } catch (error) {
    warnings.push(
      `GDP raster skipped (${error instanceof Error ? error.message : String(error)}); convert ${config.gdpPpp.fileName} with the nc->tif step.`
    );
  }

  const result: Record<string, ProvinceDemographicsEntry> = {};
  const countryTotals = new Map<string, { gdp: number; pop: number }>();
  for (const province of provinces) {
    const wppKey = wppKeyFor(province.adm0A3);
    const entry = countryTotals.get(wppKey) ?? { gdp: 0, pop: 0 };
    entry.gdp += gdpSums.get(province.id) ?? 0;
    entry.pop += ghsSums.get(province.id) ?? 0;
    countryTotals.set(wppKey, entry);
  }

  for (const province of provinces) {
    const wppKey = wppKeyFor(province.adm0A3);
    const rawPop = ghsSums.get(province.id) ?? 0;
    const scaled = scaleByCountry.get(wppKey)!;
    const isMissing = wpp.byCountry.get(wppKey) === undefined;
    const pop = isMissing ? MISSING_WPP_POP_FALLBACK : Math.round(rawPop * scaled.scale);
    const pyramid = scaled.pyramid;
    const countryPyramidTotal =
      Array.from({ length: 101 }, (_, age) => age).reduce(
        (sum, age) => sum + (pyramid.male[age] ?? 0) + (pyramid.female[age] ?? 0),
        0
      ) || 1;
    const age: Record<number, number> = {};
    let male = 0;
    let female = 0;
    for (let year = 0; year <= 100; year += 1) {
      const sourceMale = pyramid.male[year] ?? 0;
      const sourceFemale = pyramid.female[year] ?? 0;
      const yearTotal = ((sourceMale + sourceFemale) / countryPyramidTotal) * pop;
      age[year] = yearTotal;
      const sexRatio =
        sourceMale + sourceFemale > 0 ? sourceMale / (sourceMale + sourceFemale) : 0.5;
      male += yearTotal * sexRatio;
      female += yearTotal * (1 - sexRatio);
    }
    const totals = countryTotals.get(wppKey)!;
    const gdp = gdpSums.get(province.id) ?? 0;
    const countryMeanGdpPerCapita = totals.pop > 0 ? totals.gdp / (totals.pop * scaled.scale) : 0;
    const provinceGdpPerCapita = pop > 0 ? gdp / pop : 0;

    const education15Plus: Record<string, number> = {
      basic: 0,
      secondary: 0,
      tertiary: 0,
      advanced: 0
    };
    const workingBands: Array<[number, number]> = [
      [15, 19],
      [20, 24],
      [25, 29],
      [30, 34],
      [35, 39],
      [40, 44],
      [45, 49],
      [50, 54],
      [55, 59],
      [60, 64],
      [65, 69]
    ];
    const countryEducation = education.byCountry.get(wppKey);
    const region = education.regionByCountry.get(wppKey);
    for (const [ageFrom, ageTo] of workingBands) {
      const baseShares = educationForBand(
        countryEducation,
        education.fallback,
        region,
        ageFrom,
        ageTo
      );
      const adjusted =
        countryMeanGdpPerCapita > 0
          ? adjustEducationShares(
              baseShares,
              provinceGdpPerCapita / countryMeanGdpPerCapita,
              config.educationAdjustment.maxShiftSharePoints
            )
          : baseShares;
      let bandPopulation = 0;
      for (let year = ageFrom; year <= ageTo; year += 1) bandPopulation += age[year] ?? 0;
      for (const tier of EDUCATION_LEVEL_IDS) {
        education15Plus[tier] = (education15Plus[tier] ?? 0) + bandPopulation * adjusted[tier];
      }
    }

    result[province.id] = {
      pop,
      male: Math.round(male),
      female: Math.round(female),
      age: Object.fromEntries(
        Array.from({ length: 101 }, (_, year) => [year, Math.round(age[year] ?? 0)])
      ),
      education15Plus: Object.fromEntries(
        Object.entries(education15Plus).map(([tier, value]) => [tier, Math.round(value)])
      ),
      gdpPpp: Math.round(gdp)
    };
  }

  await writeFile(
    join(dirname(options.outputPath), "socioeconomic-review.json"),
    `${JSON.stringify({ warnings, generatedFor: config.baseYear }, null, 2)}\n`
  );
  return result;
}

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parseAggregateArgs(args: readonly string[]): {
  provincesPath: string;
  outputPath: string;
  applyGdp: boolean;
} {
  let provincesPath = join(toolRoot, "output/world-modern/geometry/provinces.geojson");
  let outputPath = join(toolRoot, "output/world-modern/province-demographics.json");
  let applyGdp = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
    if (argument === "--apply-gdp") {
      applyGdp = true;
      continue;
    }
    if (argument === "--provinces") {
      const value = args[index + 1];
      if (value === undefined) throw new Error("--provinces requires a path.");
      provincesPath = resolve(toolRoot, value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--provinces=")) {
      provincesPath = resolve(toolRoot, argument.slice("--provinces=".length));
      continue;
    }
    if (argument === "--out") {
      const value = args[index + 1];
      if (value === undefined) throw new Error("--out requires a path.");
      outputPath = resolve(toolRoot, value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--out=")) {
      outputPath = resolve(toolRoot, argument.slice("--out=".length));
      continue;
    }
    throw new Error(`Unknown socioeconomic argument: ${argument}`);
  }
  return { provincesPath, outputPath, applyGdp };
}

/** Patch gdp_ppp on each provinces/<id>/province.csv from demographics. */
export async function applyGdpToProvinceCsv(
  mapRoot: string,
  entries: Readonly<Record<string, ProvinceDemographicsEntry>>
): Promise<number> {
  const provincesPath = join(mapRoot, "geometry/provinces.geojson");
  const collection = JSON.parse(await readFile(provincesPath, "utf8")) as GeoJsonFeatureCollection;
  const gdpById = new Map(
    Object.entries(entries).map(([id, entry]) => [id, entry.gdpPpp] as const)
  );
  await writeProvinceCsvSkeleton(mapRoot, collection, {
    unsetGameplayFields: true,
    gdpById
  });
  return gdpById.size;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { provincesPath, outputPath, applyGdp } = parseAggregateArgs(process.argv.slice(2));
  const config = await loadSocioeconomicConfig(
    join(toolRoot, "config/world-modern-socioeconomic.json")
  );
  const entries = await aggregateSocioeconomic(toolRoot, config, {
    provincesPath,
    outputPath
  });
  await writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`);
  let gdpPatched = 0;
  if (applyGdp) {
    gdpPatched = await applyGdpToProvinceCsv(dirname(outputPath), entries);
  }
  const totalPop = Object.values(entries).reduce((sum, entry) => sum + entry.pop, 0);
  const totalGdp = Object.values(entries).reduce((sum, entry) => sum + entry.gdpPpp, 0);
  console.log(
    JSON.stringify(
      { provinces: Object.keys(entries).length, totalPop, totalGdp, outputPath, gdpPatched },
      null,
      2
    )
  );
}
