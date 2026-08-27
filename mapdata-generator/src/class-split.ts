import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProvinceDemographicsEntry } from "./socioeconomic/aggregate.js";

/** Mirrors packages/simulation-core DEFAULT_CLASS_POPULATION_SHARES. */
export const DEFAULT_CLASS_POPULATION_SHARES: Readonly<Record<string, number>> = {
  farmer: 0.35,
  worker: 0.2,
  service_worker: 0.13,
  office_worker: 0.08,
  skilled_worker: 0.05,
  professional: 0.05,
  civil_servant: 0.05,
  small_business_owner: 0.05,
  managerial: 0.02,
  capitalist: 0.01,
  rentier: 0.01
};

export const AGE_BANDS = [
  "child_0_14",
  "youth_15_24",
  "prime_25_44",
  "mature_45_64",
  "senior_65_plus"
] as const;

export const EDU_LEVELS = ["basic", "secondary", "tertiary", "advanced"] as const;

const CLASS_CSV_HEADERS = [
  "social_class_id",
  "population_persons",
  "male",
  "female",
  "age_child_0_14",
  "age_youth_15_24",
  "age_prime_25_44",
  "age_mature_45_64",
  "age_senior_65_plus",
  "edu_basic",
  "edu_secondary",
  "edu_tertiary",
  "edu_advanced"
] as const;

/** Largest-remainder allocation so parts sum exactly to total. */
export function allocateByShares(
  total: number,
  shares: Readonly<Record<string, number>>
): Record<string, number> {
  const ids = Object.keys(shares).sort();
  if (ids.length === 0 || total <= 0) {
    return Object.fromEntries(ids.map((id) => [id, 0]));
  }
  const weightSum = ids.reduce((sum, id) => sum + (shares[id] ?? 0), 0);
  if (weightSum <= 0) {
    return Object.fromEntries(ids.map((id) => [id, 0]));
  }
  const exact = ids.map((id) => {
    const value = (total * (shares[id] ?? 0)) / weightSum;
    const floor = Math.floor(value);
    return { id, floor, frac: value - floor };
  });
  const assigned = exact.reduce((sum, entry) => sum + entry.floor, 0);
  let remain = total - assigned;
  exact.sort((a, b) => b.frac - a.frac || a.id.localeCompare(b.id));
  const result: Record<string, number> = Object.fromEntries(
    exact.map((entry) => [entry.id, entry.floor])
  );
  for (let index = 0; index < exact.length && remain > 0; index += 1) {
    const id = exact[index]!.id;
    result[id] = (result[id] ?? 0) + 1;
    remain -= 1;
  }
  return result;
}

function fixComponentSum(
  parts: Record<string, number>,
  target: number
): Record<string, number> {
  const ids = Object.keys(parts);
  const sum = ids.reduce((total, id) => total + (parts[id] ?? 0), 0);
  if (sum === target || ids.length === 0) return parts;
  const result = { ...parts };
  const ordered = [...ids].sort(
    (a, b) => (result[b] ?? 0) - (result[a] ?? 0) || a.localeCompare(b)
  );
  const pivot = ordered[0]!;
  result[pivot] = Math.max(0, (result[pivot] ?? 0) + (target - sum));
  return result;
}

export interface ClassSeedRow {
  readonly socialClassId: string;
  readonly populationPersons: number;
  readonly male: number;
  readonly female: number;
  readonly age: Record<(typeof AGE_BANDS)[number], number>;
  readonly education15Plus: Record<(typeof EDU_LEVELS)[number], number>;
}

export function splitDemographicsIntoClasses(
  demo: ProvinceDemographicsEntry
): ClassSeedRow[] {
  const classPop = allocateByShares(Math.max(0, Math.round(demo.pop)), DEFAULT_CLASS_POPULATION_SHARES);
  const classIds = Object.keys(DEFAULT_CLASS_POPULATION_SHARES).sort();
  const maleByClass = allocateByShares(Math.max(0, Math.round(demo.male)), DEFAULT_CLASS_POPULATION_SHARES);
  const ageByBand = Object.fromEntries(
    AGE_BANDS.map((band) => [
      band,
      allocateByShares(Math.max(0, Math.round(demo.age[band] ?? 0)), DEFAULT_CLASS_POPULATION_SHARES)
    ])
  ) as Record<(typeof AGE_BANDS)[number], Record<string, number>>;
  const eduByLevel = Object.fromEntries(
    EDU_LEVELS.map((level) => [
      level,
      allocateByShares(
        Math.max(0, Math.round(demo.education15Plus[level] ?? 0)),
        DEFAULT_CLASS_POPULATION_SHARES
      )
    ])
  ) as Record<(typeof EDU_LEVELS)[number], Record<string, number>>;

  return classIds.map((socialClassId) => {
    const populationPersons = classPop[socialClassId] ?? 0;
    const male = Math.min(populationPersons, maleByClass[socialClassId] ?? 0);
    const female = populationPersons - male;
    let age = Object.fromEntries(
      AGE_BANDS.map((band) => [band, ageByBand[band]?.[socialClassId] ?? 0])
    ) as Record<(typeof AGE_BANDS)[number], number>;
    age = fixComponentSum(age, populationPersons) as typeof age;
    const education15Plus = Object.fromEntries(
      EDU_LEVELS.map((level) => [level, eduByLevel[level]?.[socialClassId] ?? 0])
    ) as Record<(typeof EDU_LEVELS)[number], number>;
    return {
      socialClassId,
      populationPersons,
      male,
      female,
      age,
      education15Plus
    };
  });
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (inQuotes) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export async function writeClassSeedRows(
  provinceDir: string,
  rows: readonly ClassSeedRow[]
): Promise<number> {
  const classesDir = join(provinceDir, "classes");
  await mkdir(classesDir, { recursive: true });
  let written = 0;
  for (const row of rows) {
    if (row.populationPersons <= 0) continue;
    const line = [
      row.socialClassId,
      String(row.populationPersons),
      String(row.male),
      String(row.female),
      ...AGE_BANDS.map((band) => String(row.age[band])),
      ...EDU_LEVELS.map((level) => String(row.education15Plus[level]))
    ]
      .map(csvEscape)
      .join(",");
    await writeFile(
      join(classesDir, `${row.socialClassId}.csv`),
      `${CLASS_CSV_HEADERS.join(",")}\n${line}\n`,
      "utf8"
    );
    written += 1;
  }
  return written;
}

export async function writeProvinceClassCsvs(
  provinceDir: string,
  demo: ProvinceDemographicsEntry
): Promise<number> {
  if (Math.round(demo.pop) <= 0) return 0;
  return writeClassSeedRows(provinceDir, splitDemographicsIntoClasses(demo));
}

export async function readProvinceClassCsvs(provinceDir: string): Promise<ClassSeedRow[]> {
  const classesDir = join(provinceDir, "classes");
  let files: string[] = [];
  try {
    files = (await readdir(classesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".csv"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  const rows: ClassSeedRow[] = [];
  for (const fileName of files) {
    const socialClassId = fileName.slice(0, -".csv".length);
    const text = await readFile(join(classesDir, fileName), "utf8");
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) continue;
    const headers = parseCsvLine(lines[0]!);
    const cells = parseCsvLine(lines[1]!);
    const value = (name: string): number => {
      const index = headers.indexOf(name);
      if (index < 0) return 0;
      const parsed = Number(cells[index] ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    rows.push({
      socialClassId,
      populationPersons: value("population_persons"),
      male: value("male"),
      female: value("female"),
      age: Object.fromEntries(AGE_BANDS.map((band) => [band, value(`age_${band}`)])) as ClassSeedRow["age"],
      education15Plus: Object.fromEntries(
        EDU_LEVELS.map((level) => [level, value(`edu_${level}`)])
      ) as ClassSeedRow["education15Plus"]
    });
  }
  return rows;
}

export function sumClassSeedRows(groups: readonly (readonly ClassSeedRow[])[]): ClassSeedRow[] {
  const byId = new Map<string, ClassSeedRow>();
  for (const rows of groups) {
    for (const row of rows) {
      const existing = byId.get(row.socialClassId);
      if (existing === undefined) {
        byId.set(row.socialClassId, {
          socialClassId: row.socialClassId,
          populationPersons: row.populationPersons,
          male: row.male,
          female: row.female,
          age: { ...row.age },
          education15Plus: { ...row.education15Plus }
        });
        continue;
      }
      const age = { ...existing.age };
      for (const band of AGE_BANDS) age[band] += row.age[band];
      const education15Plus = { ...existing.education15Plus };
      for (const level of EDU_LEVELS) education15Plus[level] += row.education15Plus[level];
      byId.set(row.socialClassId, {
        socialClassId: row.socialClassId,
        populationPersons: existing.populationPersons + row.populationPersons,
        male: existing.male + row.male,
        female: existing.female + row.female,
        age,
        education15Plus
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.socialClassId.localeCompare(b.socialClassId));
}

/** Seed L2 `provinces/<sourceId>/classes/*.csv` from L1 demographics.json. */
export async function seedProjectClassesFromBase(
  projectDir: string,
  baseRoot: string
): Promise<number> {
  const demographicsPath = join(baseRoot, "demographics.json");
  const demographics = JSON.parse(await readFile(demographicsPath, "utf8")) as Record<
    string,
    ProvinceDemographicsEntry
  >;
  let files = 0;
  for (const [provinceId, demo] of Object.entries(demographics)) {
    files += await writeProvinceClassCsvs(join(projectDir, "provinces", provinceId), demo);
  }
  return files;
}
