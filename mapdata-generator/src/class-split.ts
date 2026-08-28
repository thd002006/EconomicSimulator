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

export const CLASS_CSV_HEADERS = ["dimension", "key", "value"] as const;

export interface DimensionItem {
  readonly dimension: string;
  readonly key: string;
  readonly value: number;
}

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

export interface ClassSeedRow {
  readonly socialClassId: string;
  readonly populationPersons: number;
  readonly maleShare: number;
  readonly femaleShare: number;
  readonly ageShares: Record<number, number>;
  readonly education15PlusShares: Record<(typeof EDU_LEVELS)[number], number>;
  readonly cashCents?: number;
}

export function buildDefaultSingleYearAgeShares(): Record<number, number> {
  const shares: Record<number, number> = {};
  for (let a = 0; a <= 14; a += 1) shares[a] = 0.20 / 15;
  for (let a = 15; a <= 24; a += 1) shares[a] = 0.15 / 10;
  for (let a = 25; a <= 44; a += 1) shares[a] = 0.30 / 20;
  for (let a = 45; a <= 64; a += 1) shares[a] = 0.23 / 20;
  for (let a = 65; a <= 100; a += 1) shares[a] = 0.12 / 36;
  const sum = Object.values(shares).reduce((acc, v) => acc + v, 0);
  for (let a = 0; a <= 100; a += 1) shares[a] = (shares[a] ?? 0) / sum;
  return shares;
}

export function splitDemographicsIntoClasses(
  demo: ProvinceDemographicsEntry
): ClassSeedRow[] {
  const classPop = allocateByShares(Math.max(0, Math.round(demo.pop)), DEFAULT_CLASS_POPULATION_SHARES);
  const classIds = Object.keys(DEFAULT_CLASS_POPULATION_SHARES).sort();

  const totalPop = demo.pop > 0 ? demo.pop : 1;
  const maleShare = totalPop > 0 && typeof demo.male === "number" ? demo.male / totalPop : 0.5;
  const femaleShare = 1 - maleShare;

  const eduTotal = EDU_LEVELS.reduce((sum, lvl) => sum + (demo.education15Plus[lvl] ?? 0), 0) || 1;
  const eduShares = Object.fromEntries(
    EDU_LEVELS.map((lvl) => [lvl, (demo.education15Plus[lvl] ?? 0) / eduTotal])
  ) as Record<(typeof EDU_LEVELS)[number], number>;

  const ageShares: Record<number, number> = {};
  const childTotal = (demo.age.child_0_14 ?? 0) / totalPop;
  const youthTotal = (demo.age.youth_15_24 ?? 0) / totalPop;
  const primeTotal = (demo.age.prime_25_44 ?? 0) / totalPop;
  const matureTotal = (demo.age.mature_45_64 ?? 0) / totalPop;
  const seniorTotal = (demo.age.senior_65_plus ?? 0) / totalPop;

  for (let a = 0; a <= 14; a += 1) ageShares[a] = childTotal / 15;
  for (let a = 15; a <= 24; a += 1) ageShares[a] = youthTotal / 10;
  for (let a = 25; a <= 44; a += 1) ageShares[a] = primeTotal / 20;
  for (let a = 45; a <= 64; a += 1) ageShares[a] = matureTotal / 20;
  for (let a = 65; a <= 100; a += 1) ageShares[a] = seniorTotal / 36;

  const ageSum = Object.values(ageShares).reduce((acc, v) => acc + v, 0) || 1;
  for (let a = 0; a <= 100; a += 1) ageShares[a] = (ageShares[a] ?? 0) / ageSum;

  return classIds.map((socialClassId) => {
    const populationPersons = classPop[socialClassId] ?? 0;
    return {
      socialClassId,
      populationPersons,
      maleShare,
      femaleShare,
      ageShares: { ...ageShares },
      education15PlusShares: { ...eduShares }
    };
  });
}

export function parseCsvLine(line: string): string[] {
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

export function serializeClassCsv(row: ClassSeedRow): string {
  const lines: string[] = ["dimension,key,value"];
  lines.push(`meta,population_persons,${row.populationPersons}`);
  if (row.cashCents !== undefined) {
    lines.push(`meta,cash_cents,${row.cashCents}`);
  }
  lines.push(`gender,male,${row.maleShare.toFixed(5)}`);
  lines.push(`gender,female,${row.femaleShare.toFixed(5)}`);
  for (let a = 0; a <= 100; a += 1) {
    const share = row.ageShares[a] ?? 0;
    lines.push(`age,${a},${share.toFixed(5)}`);
  }
  for (const lvl of EDU_LEVELS) {
    const share = row.education15PlusShares[lvl] ?? 0;
    lines.push(`education_15plus,${lvl},${share.toFixed(5)}`);
  }
  return `${lines.join("\n")}\n`;
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
    const content = serializeClassCsv(row);
    await writeFile(
      join(classesDir, `${row.socialClassId}.csv`),
      content,
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

export function parseClassCsvText(socialClassId: string, text: string): ClassSeedRow {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return {
      socialClassId,
      populationPersons: 0,
      maleShare: 0.5,
      femaleShare: 0.5,
      ageShares: buildDefaultSingleYearAgeShares(),
      education15PlusShares: { basic: 0.5, secondary: 0.3, tertiary: 0.15, advanced: 0.05 }
    };
  }
  const headers = parseCsvLine(lines[0]!);
  if (headers.includes("dimension") && headers.includes("key") && headers.includes("value")) {
    const dimIdx = headers.indexOf("dimension");
    const keyIdx = headers.indexOf("key");
    const valIdx = headers.indexOf("value");

    let populationPersons = 0;
    let cashCents: number | undefined;
    let maleShare = 0.5;
    let femaleShare = 0.5;
    const ageShares: Record<number, number> = {};
    const eduShares: Record<string, number> = {};

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i]!.trim();
      if (!line) continue;
      const cells = parseCsvLine(line);
      const dim = cells[dimIdx] ?? "";
      const key = cells[keyIdx] ?? "";
      const val = Number(cells[valIdx] ?? 0);
      if (!Number.isFinite(val)) continue;

      if (dim === "meta") {
        if (key === "population_persons") populationPersons = Math.round(val);
        else if (key === "cash_cents") cashCents = Math.round(val);
      } else if (dim === "gender") {
        if (key === "male") maleShare = val;
        else if (key === "female") femaleShare = val;
      } else if (dim === "age") {
        const ageNum = Number(key);
        if (Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 100) {
          ageShares[ageNum] = val;
        }
      } else if (dim === "education_15plus" || dim === "education") {
        eduShares[key] = val;
      }
    }

    for (let a = 0; a <= 100; a += 1) {
      if (ageShares[a] === undefined) ageShares[a] = 0;
    }
    const ageSum = Object.values(ageShares).reduce((acc, v) => acc + v, 0);
    if (ageSum > 0) {
      for (let a = 0; a <= 100; a += 1) ageShares[a] = (ageShares[a] ?? 0) / ageSum;
    } else {
      Object.assign(ageShares, buildDefaultSingleYearAgeShares());
    }

    const eduSum = EDU_LEVELS.reduce((acc, lvl) => acc + (eduShares[lvl] ?? 0), 0);
    const finalEduShares: Record<(typeof EDU_LEVELS)[number], number> = {
      basic: 0,
      secondary: 0,
      tertiary: 0,
      advanced: 0
    };
    if (eduSum > 0) {
      for (const lvl of EDU_LEVELS) finalEduShares[lvl] = (eduShares[lvl] ?? 0) / eduSum;
    } else {
      finalEduShares.basic = 1.0;
    }

    const genderSum = maleShare + femaleShare;
    if (genderSum > 0) {
      maleShare /= genderSum;
      femaleShare = 1 - maleShare;
    } else {
      maleShare = 0.5;
      femaleShare = 0.5;
    }

    return {
      socialClassId,
      populationPersons,
      maleShare,
      femaleShare,
      ageShares,
      education15PlusShares: finalEduShares,
      ...(cashCents !== undefined ? { cashCents } : {})
    };
  }

  // Fallback for wide row
  const cells = parseCsvLine(lines[1]!);
  const value = (name: string): number => {
    const index = headers.indexOf(name);
    if (index < 0) return 0;
    const parsed = Number(cells[index] ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const pop = value("population_persons");
  const male = value("male");
  const female = value("female");
  const maleShare = pop > 0 ? male / (male + female || 1) : 0.5;
  const femaleShare = 1 - maleShare;

  const ageShares: Record<number, number> = {};
  const c014 = pop > 0 ? value("age_child_0_14") / pop : 0.2;
  const y1524 = pop > 0 ? value("age_youth_15_24") / pop : 0.15;
  const p2544 = pop > 0 ? value("age_prime_25_44") / pop : 0.3;
  const m4564 = pop > 0 ? value("age_mature_45_64") / pop : 0.23;
  const s65p = pop > 0 ? value("age_senior_65_plus") / pop : 0.12;

  for (let a = 0; a <= 14; a += 1) ageShares[a] = c014 / 15;
  for (let a = 15; a <= 24; a += 1) ageShares[a] = y1524 / 10;
  for (let a = 25; a <= 44; a += 1) ageShares[a] = p2544 / 20;
  for (let a = 45; a <= 64; a += 1) ageShares[a] = m4564 / 20;
  for (let a = 65; a <= 100; a += 1) ageShares[a] = s65p / 36;
  const ageSum = Object.values(ageShares).reduce((acc, v) => acc + v, 0) || 1;
  for (let a = 0; a <= 100; a += 1) ageShares[a] = (ageShares[a] ?? 0) / ageSum;

  const eduRaw = {
    basic: value("edu_basic"),
    secondary: value("edu_secondary"),
    tertiary: value("edu_tertiary"),
    advanced: value("edu_advanced")
  };
  const eduTotal = Object.values(eduRaw).reduce((acc, v) => acc + v, 0) || 1;
  const education15PlusShares = Object.fromEntries(
    EDU_LEVELS.map((lvl) => [lvl, eduRaw[lvl] / eduTotal])
  ) as Record<(typeof EDU_LEVELS)[number], number>;

  return {
    socialClassId,
    populationPersons: pop,
    maleShare,
    femaleShare,
    ageShares,
    education15PlusShares
  };
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
    rows.push(parseClassCsvText(socialClassId, text));
  }
  return rows;
}

export function sumClassSeedRows(groups: readonly (readonly ClassSeedRow[])[]): ClassSeedRow[] {
  const byId = new Map<
    string,
    {
      socialClassId: string;
      populationPersons: number;
      maleWeightedSum: number;
      ageWeightedSum: Record<number, number>;
      eduWeightedSum: Record<(typeof EDU_LEVELS)[number], number>;
      cashCentsSum: number;
      hasCash: boolean;
    }
  >();

  for (const rows of groups) {
    for (const row of rows) {
      let existing = byId.get(row.socialClassId);
      if (existing === undefined) {
        existing = {
          socialClassId: row.socialClassId,
          populationPersons: 0,
          maleWeightedSum: 0,
          ageWeightedSum: {},
          eduWeightedSum: { basic: 0, secondary: 0, tertiary: 0, advanced: 0 },
          cashCentsSum: 0,
          hasCash: false
        };
        for (let a = 0; a <= 100; a += 1) existing.ageWeightedSum[a] = 0;
        byId.set(row.socialClassId, existing);
      }
      existing.populationPersons += row.populationPersons;
      existing.maleWeightedSum += row.populationPersons * row.maleShare;
      for (let a = 0; a <= 100; a += 1) {
        existing.ageWeightedSum[a] = (existing.ageWeightedSum[a] ?? 0) + row.populationPersons * (row.ageShares[a] ?? 0);
      }
      for (const lvl of EDU_LEVELS) {
        existing.eduWeightedSum[lvl] += row.populationPersons * (row.education15PlusShares[lvl] ?? 0);
      }
      if (row.cashCents !== undefined) {
        existing.cashCentsSum += row.cashCents;
        existing.hasCash = true;
      }
    }
  }

  const result: ClassSeedRow[] = [];
  for (const entry of byId.values()) {
    const pop = entry.populationPersons;
    const maleShare = pop > 0 ? entry.maleWeightedSum / pop : 0.5;
    const femaleShare = 1 - maleShare;

    const ageShares: Record<number, number> = {};
    for (let a = 0; a <= 100; a += 1) {
      ageShares[a] = pop > 0 ? (entry.ageWeightedSum[a] ?? 0) / pop : 1 / 101;
    }
    const ageSum = Object.values(ageShares).reduce((acc, v) => acc + v, 0) || 1;
    for (let a = 0; a <= 100; a += 1) ageShares[a] = (ageShares[a] ?? 0) / ageSum;

    const education15PlusShares: Record<(typeof EDU_LEVELS)[number], number> = {
      basic: 0,
      secondary: 0,
      tertiary: 0,
      advanced: 0
    };
    for (const lvl of EDU_LEVELS) {
      education15PlusShares[lvl] = pop > 0 ? entry.eduWeightedSum[lvl] / pop : 0.25;
    }
    const eduSum = EDU_LEVELS.reduce((acc, lvl) => acc + education15PlusShares[lvl], 0) || 1;
    for (const lvl of EDU_LEVELS) education15PlusShares[lvl] /= eduSum;

    result.push({
      socialClassId: entry.socialClassId,
      populationPersons: pop,
      maleShare,
      femaleShare,
      ageShares,
      education15PlusShares,
      ...(entry.hasCash ? { cashCents: entry.cashCentsSum } : {})
    });
  }
  return result.sort((a, b) => a.socialClassId.localeCompare(b.socialClassId));
}

export function validateClassSeedRows(rows: readonly ClassSeedRow[]): string[] {
  const errors: string[] = [];
  for (const row of rows) {
    const label = `class ${row.socialClassId}`;
    if (!Number.isInteger(row.populationPersons) || row.populationPersons < 0) {
      errors.push(`${label}: populationPersons must be a non-negative integer.`);
    }
    if (Math.abs(row.maleShare + row.femaleShare - 1.0) > 0.01) {
      errors.push(`${label}: gender shares must sum to 1.0.`);
    }
    const ageSum = Object.values(row.ageShares).reduce((acc, v) => acc + v, 0);
    if (Math.abs(ageSum - 1.0) > 0.01) {
      errors.push(`${label}: age shares must sum to 1.0 (got ${ageSum.toFixed(4)}).`);
    }
    const eduSum = EDU_LEVELS.reduce((acc, lvl) => acc + (row.education15PlusShares[lvl] ?? 0), 0);
    if (Math.abs(eduSum - 1.0) > 0.01) {
      errors.push(`${label}: education shares must sum to 1.0 (got ${eduSum.toFixed(4)}).`);
    }
  }
  return errors;
}
