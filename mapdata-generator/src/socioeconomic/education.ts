import { readFile } from "node:fs/promises";
import type { EducationLevelId } from "./wpp.js";

const BL_COLUMNS = ["lu", "lp", "lpc", "ls", "lsc", "lh", "lhc"] as const;

/** Maps the seven Barro-Lee categories onto the four simulation tiers. */
const CATEGORY_TO_TIER: Record<EducationLevelId, readonly number[]> = {
  basic: [0, 1, 2],
  secondary: [3, 4],
  tertiary: [5],
  advanced: [6]
};

export interface RegionFallback {
  readonly byRegion: Map<string, CountryEducation>;
  readonly world: CountryEducation;
}

export interface CountryEducation {
  /** Attainment shares for each Barro-Lee age band at the base year. */
  readonly byAgeBand: Map<string, Record<EducationLevelId, number>>;
}

export interface EducationTables {
  readonly byCountry: Map<string, CountryEducation>;
  readonly regionByCountry: Map<string, string>;
  readonly fallback: RegionFallback;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else if (character === "\r") {
      // Handle lone \r (old Mac) as newline when not followed by \n.
      if (text[index + 1] !== "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
    } else {
      field += character;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

function tierShares(shares: readonly number[]): Record<EducationLevelId, number> {
  const result = {} as Record<EducationLevelId, number>;
  let total = 0;
  for (const [tier, categoryIndices] of Object.entries(CATEGORY_TO_TIER)) {
    const value = categoryIndices.reduce((sum, index) => sum + shares[index]!, 0);
    result[tier as EducationLevelId] = value;
    total += value;
  }
  if (total <= 0) return { basic: 1, secondary: 0, tertiary: 0, advanced: 0 };
  for (const tier of Object.keys(result)) {
    result[tier as EducationLevelId] /= total;
  }
  return result;
}

function interpolate(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixShares(
  left: Record<EducationLevelId, number>,
  right: Record<EducationLevelId, number>,
  t: number
): Record<EducationLevelId, number> {
  const result = {} as Record<EducationLevelId, number>;
  let total = 0;
  for (const tier of Object.keys(left) as EducationLevelId[]) {
    result[tier] = interpolate(left[tier]!, right[tier]!, t);
    total += result[tier]!;
  }
  if (total > 0) {
    for (const tier of Object.keys(result) as EducationLevelId[]) result[tier]! /= total;
  }
  return result;
}

/**
 * Loads Barro-Lee attainment shares by age band, interpolating between the two
 * surrounding quinquennial waves and building region/world fallbacks weighted
 * by the reported population.
 */
export async function loadEducationTables(
  csvPath: string,
  baseYear: number,
  interpolationYears: readonly [number, number]
): Promise<EducationTables> {
  const rows = parseCsv(await readFile(csvPath, "utf8"));
  const header = rows[0]!.map((value) => value.trim());
  const columnIndex = new Map(header.map((name, index) => [name, index]));
  const required = [
    "country",
    "year",
    "agefrom",
    "ageto",
    ...BL_COLUMNS,
    "pop",
    "WBcode",
    "region_code"
  ];
  for (const name of required) {
    if (!columnIndex.has(name)) throw new Error(`Barro-Lee CSV lacks column ${name}.`);
  }

  interface Accumulator {
    left?: { shares: Record<EducationLevelId, number>; pop: number };
    right?: { shares: Record<EducationLevelId, number>; pop: number };
  }
  const countries = new Map<string, Map<string, Accumulator>>();
  const regions = new Map<string, Map<string, Accumulator>>();
  const world = new Map<string, Map<string, Accumulator>>();
  const regionByCountry = new Map<string, string>();

  const addRow = (
    table: Map<string, Map<string, Accumulator>>,
    key: string,
    bandKey: string,
    shares: Record<EducationLevelId, number>,
    pop: number,
    wave: "left" | "right"
  ): void => {
    const bands = table.get(key) ?? new Map<string, Accumulator>();
    const accumulator = bands.get(bandKey) ?? {};
    const existing = accumulator[wave];
    if (existing === undefined) {
      accumulator[wave] = { shares: { ...shares }, pop };
    } else {
      const totalPop = existing.pop + pop;
      const blended = {} as Record<EducationLevelId, number>;
      for (const tier of Object.keys(shares) as EducationLevelId[]) {
        blended[tier] = (existing.shares[tier]! * existing.pop + shares[tier]! * pop) / totalPop;
      }
      let total = 0;
      for (const value of Object.values(blended)) total += value;
      if (total > 0) {
        for (const tier of Object.keys(blended) as EducationLevelId[]) blended[tier]! /= total;
      }
      accumulator[wave] = { shares: blended, pop: totalPop };
    }
    bands.set(bandKey, accumulator);
    table.set(key, bands);
  };

  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index]!;
    const year = Number(cells[columnIndex.get("year")!]);
    if (year !== interpolationYears[0] && year !== interpolationYears[1]) continue;
    const wbCode = cells[columnIndex.get("WBcode")!]!.trim();
    const region = cells[columnIndex.get("region_code")!]!.trim();
    const ageFrom = Number(cells[columnIndex.get("agefrom")!]);
    const ageTo = Number(cells[columnIndex.get("ageto")!]);
    const pop = Number(cells[columnIndex.get("pop")!]);
    if (!Number.isFinite(year) || !Number.isFinite(ageFrom) || !Number.isFinite(pop)) continue;
    const raw = BL_COLUMNS.map((column) => Number(cells[columnIndex.get(column)!]));
    if (raw.some((value) => !Number.isFinite(value))) continue;
    const shares = tierShares(raw);
    const bandKey = `${ageFrom}-${ageTo}`;
    const wave = year === interpolationYears[0] ? "left" : "right";
    regionByCountry.set(wbCode, region);
    addRow(countries, wbCode, bandKey, shares, pop, wave);
    addRow(regions, region, bandKey, shares, pop, wave);
    addRow(world, "*", bandKey, shares, pop, wave);
  }

  const span = interpolationYears[1] - interpolationYears[0];
  const rawT = span === 0 ? 0 : (baseYear - interpolationYears[0]) / span;
  const t = Math.max(0, Math.min(1, rawT));

  const resolveTable = (
    table: Map<string, Map<string, Accumulator>>
  ): Map<string, CountryEducation> => {
    const resolved = new Map<string, CountryEducation>();
    for (const [key, bands] of table) {
      const byAgeBand = new Map<string, Record<EducationLevelId, number>>();
      for (const [bandKey, accumulator] of bands) {
        if (accumulator.left === undefined || accumulator.right === undefined) continue;
        byAgeBand.set(bandKey, mixShares(accumulator.left.shares, accumulator.right.shares, t));
      }
      if (byAgeBand.size > 0) resolved.set(key, { byAgeBand });
    }
    return resolved;
  };

  const byCountry = resolveTable(countries);
  const fallbackRegions = resolveTable(regions);
  const fallbackWorld = resolveTable(world).get("*");
  return {
    byCountry,
    regionByCountry,
    fallback: {
      byRegion: new Map([...fallbackRegions].map(([key, value]) => [key, value])),
      world: fallbackWorld ?? ({ byAgeBand: new Map() } satisfies CountryEducation)
    }
  };
}

export function educationForBand(
  education: CountryEducation | undefined,
  fallback: RegionFallback,
  region: string | undefined,
  ageFrom: number,
  ageTo: number
): Record<EducationLevelId, number> {
  const candidates = [`${ageFrom}-${ageTo}`, ...(ageFrom >= 65 ? [`60-64`] : [])];
  const source = education?.byAgeBand ?? undefined;
  for (const key of candidates) {
    const direct = source?.get(key);
    if (direct !== undefined) return direct;
  }
  const regionBands = region === undefined ? undefined : fallback.byRegion.get(region);
  for (const key of candidates) {
    const regional = regionBands?.byAgeBand.get(key);
    if (regional !== undefined) return regional;
  }
  for (const key of candidates) {
    const global = fallback.world.byAgeBand.get(key);
    if (global !== undefined) return global;
  }
  return { basic: 1, secondary: 0, tertiary: 0, advanced: 0 };
}
