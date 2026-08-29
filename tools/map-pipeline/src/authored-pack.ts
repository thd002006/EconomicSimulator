import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { POPULATION_DATA_PACK } from "@economic-simulator/game-data";
import { OPERATING_UNIT_KINDS } from "@economic-simulator/simulation-core";
import {
  optionalCsvField,
  optionalCsvNumber,
  parseCsv,
  parseCsvNumber,
  requireCsvField
} from "./csv.js";

const SOCIAL_CLASS_IDS = new Set(POPULATION_DATA_PACK.socialClasses.map((entry) => entry.id));
const OPERATING_UNIT_KIND_IDS = new Set<string>(OPERATING_UNIT_KINDS);

const EDU_CSV_FIELDS = ["edu_basic", "edu_secondary", "edu_tertiary", "edu_advanced"] as const;

export interface AuthoredCountry {
  readonly id: string;
  readonly nameEn: string;
  readonly name?: string;
}

export interface AuthoredProvinceOverview {
  readonly id: string;
  readonly name?: string;
  readonly nameEn?: string;
  readonly ownerCountryId: string;
  readonly landAreaKm2: number;
  readonly arableLandKm2: number;
  readonly cultivationCondition: number;
  readonly habitability: number;
  readonly terrainProfileId: string;
  readonly climateProfileId: string;
  readonly resourcePotentialByResourceId: Readonly<Record<string, number>>;
  readonly gdpPpp?: number;
  readonly description?: string;
  readonly capitalName?: string;
  readonly capitalNameEn?: string;
}

export interface AuthoredClassSeed {
  readonly socialClassId: string;
  readonly populationPersons: number;
  readonly male: number;
  readonly female: number;
  readonly age: Readonly<Record<string, number>>;
  readonly education15Plus: Readonly<Record<string, number>>;
  readonly cashCents?: number;
}

export interface AuthoredOperatingUnit {
  readonly id: string;
  readonly kind: string;
  readonly industryId: string;
  readonly defaultMarketId?: string;
  readonly ownerCompanyId: string;
  readonly ownerShares?: number;
  readonly operatingStatus: string;
  readonly initialCashCents?: number;
}

export interface AuthoredShareholder {
  readonly shareholderKind: "population_class" | "government" | "company";
  readonly provinceId?: string;
  readonly socialClassId?: string;
  readonly countryId?: string;
  readonly companyId?: string;
  readonly shares: number;
}

export interface AuthoredCompany {
  readonly id: string;
  readonly legalName: string;
  readonly registrationCountryId: string;
  readonly headquartersUnitId: string;
  readonly status: string;
  readonly initialCashCents?: number;
  readonly dividendPayoutRate?: number;
  readonly minCashReserveCents?: number;
  readonly shareholders: readonly AuthoredShareholder[];
}

export interface AuthoredProvincePack {
  readonly overview: AuthoredProvinceOverview;
  readonly classes: readonly AuthoredClassSeed[];
  readonly operatingUnits: readonly AuthoredOperatingUnit[];
}

export interface AuthoredMapContent {
  readonly countries: readonly AuthoredCountry[];
  readonly provinces: ReadonlyMap<string, AuthoredProvincePack>;
  readonly companies: readonly AuthoredCompany[];
}

function unitInterval(value: number, label: string): number {
  if (value < 0 || value > 1) {
    throw new Error(`${label} must be in [0, 1] (got ${value}).`);
  }
  return value;
}

function parseResourceColumns(row: Record<string, string>, label: string): Record<string, number> {
  const resources: Record<string, number> = {};
  for (const [key, raw] of Object.entries(row)) {
    if (!key.startsWith("resource_")) continue;
    const resourceId = key.slice("resource_".length);
    if (resourceId === "" || raw.trim() === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${label}.${key} must be a finite number in [0, 1].`);
    }
    resources[resourceId] = value;
  }
  return resources;
}

export function parseCountriesCsv(text: string): AuthoredCountry[] {
  const { rows } = parseCsv(text);
  const countries: AuthoredCountry[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const label = `countries.csv row ${index + 2}`;
    const id = requireCsvField(row, "id", label);
    if (seen.has(id)) throw new Error(`${label}: duplicate country id ${id}.`);
    seen.add(id);
    const nameEn = requireCsvField(row, "name_en", label);
    const name = optionalCsvField(row, "name");
    countries.push({
      id,
      nameEn,
      ...(name === undefined ? {} : { name })
    });
  }
  return countries;
}

export function parseProvinceOverviewCsv(
  text: string,
  expectedId: string
): AuthoredProvinceOverview {
  const { rows } = parseCsv(text);
  if (rows.length !== 1) {
    throw new Error(`provinces/${expectedId}/province.csv must contain exactly one data row.`);
  }
  const row = rows[0]!;
  const label = `provinces/${expectedId}/province.csv`;
  const id = requireCsvField(row, "id", label);
  if (id !== expectedId) {
    throw new Error(`${label}: id ${id} does not match directory ${expectedId}.`);
  }
  const landAreaKm2 = parseCsvNumber(row, "land_area_km2", label);
  const arableLandKm2 = parseCsvNumber(row, "arable_land_km2", label);
  if (landAreaKm2 <= 0) throw new Error(`${label}.land_area_km2 must be positive.`);
  if (arableLandKm2 < 0 || arableLandKm2 - landAreaKm2 > 1e-6) {
    throw new Error(`${label}.arable_land_km2 must be in [0, land_area_km2].`);
  }
  const name = optionalCsvField(row, "name");
  const nameEn = optionalCsvField(row, "name_en");
  const description = optionalCsvField(row, "description");
  if (description !== undefined && description.length > 500) {
    throw new Error(`${label}.description exceeds 500 characters.`);
  }
  const gdpPpp = optionalCsvNumber(row, "gdp_ppp", label);
  const capitalName = optionalCsvField(row, "capital_name");
  const capitalNameEn = optionalCsvField(row, "capital_name_en");
  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(nameEn === undefined ? {} : { nameEn }),
    ownerCountryId: requireCsvField(row, "owner_country_id", label),
    landAreaKm2,
    arableLandKm2,
    cultivationCondition: unitInterval(
      parseCsvNumber(row, "cultivation_condition", label),
      `${label}.cultivation_condition`
    ),
    habitability: unitInterval(parseCsvNumber(row, "habitability", label), `${label}.habitability`),
    terrainProfileId: requireCsvField(row, "terrain_profile_id", label),
    climateProfileId: requireCsvField(row, "climate_profile_id", label),
    resourcePotentialByResourceId: parseResourceColumns(row, label),
    ...(gdpPpp === undefined ? {} : { gdpPpp }),
    ...(description === undefined ? {} : { description }),
    ...(capitalName === undefined ? {} : { capitalName }),
    ...(capitalNameEn === undefined ? {} : { capitalNameEn })
  };
}

export function parseClassCsv(
  text: string,
  expectedClassId: string,
  label: string
): AuthoredClassSeed {
  const { headers, rows } = parseCsv(text);
  if (!SOCIAL_CLASS_IDS.has(expectedClassId)) {
    throw new Error(`${label}: unknown social_class_id ${expectedClassId}.`);
  }

  if (headers.includes("dimension") && headers.includes("key") && headers.includes("value")) {
    let populationPersons = 0;
    let cashCents: number | undefined;
    let maleShare = 0.5;
    let femaleShare = 0.5;
    const ageShares: Record<number, number> = {};
    const eduShares: Record<string, number> = {};

    for (const [index, row] of rows.entries()) {
      const rowLabel = `${label} row ${index + 2}`;
      const dim = requireCsvField(row, "dimension", rowLabel);
      const key = requireCsvField(row, "key", rowLabel);
      const val = parseCsvNumber(row, "value", rowLabel);

      if (dim === "meta") {
        if (key === "population_persons") {
          if (!Number.isInteger(val) || val < 0) {
            throw new Error(`${rowLabel}: population_persons must be a non-negative integer.`);
          }
          populationPersons = val;
        } else if (key === "cash_cents") {
          cashCents = val;
        }
      } else if (dim === "gender") {
        if (key === "male") maleShare = val;
        else if (key === "female") femaleShare = val;
      } else if (dim === "age") {
        const ageNum = Number(key);
        if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 100) {
          throw new Error(`${rowLabel}: invalid age key "${key}" (expected 0..100).`);
        }
        ageShares[ageNum] = val;
      } else if (dim === "education_15plus" || dim === "education") {
        eduShares[key] = val;
      }
    }

    // Normalize gender
    const genderSum = maleShare + femaleShare;
    if (genderSum > 0) {
      maleShare /= genderSum;
      femaleShare = 1 - maleShare;
    }

    // Single year 0..100 age counts
    const age: Record<string, number> = {};
    const ageSharesSum = Object.values(ageShares).reduce((acc, v) => acc + v, 0);
    let nonChild = 0;
    for (let a = 0; a <= 100; a += 1) {
      const share = ageSharesSum > 0 ? (ageShares[a] ?? 0) / ageSharesSum : 1 / 101;
      const count = populationPersons * share;
      age[String(a)] = count;
      if (a >= 15) {
        nonChild += count;
      }
    }

    // Education shares -> calculate headcounts
    const eduSum = EDU_CSV_FIELDS.reduce(
      (acc, f) => acc + (eduShares[f.slice("edu_".length)] ?? eduShares[f] ?? 0),
      0
    );
    const education15Plus: Record<string, number> = {};
    for (const field of EDU_CSV_FIELDS) {
      const lvl = field.slice("edu_".length);
      const share =
        eduSum > 0 ? (eduShares[lvl] ?? eduShares[field] ?? 0) / eduSum : lvl === "basic" ? 1 : 0;
      education15Plus[lvl] = nonChild * share;
    }

    return {
      socialClassId: expectedClassId,
      populationPersons,
      male: populationPersons * maleShare,
      female: populationPersons * femaleShare,
      age,
      education15Plus,
      ...(cashCents === undefined ? {} : { cashCents })
    };
  }

  throw new Error(`${label} must use dimension,key,value rows with single-year ages 0..100.`);
}

export function parseOperatingUnitsCsv(text: string, provinceId: string): AuthoredOperatingUnit[] {
  const { rows } = parseCsv(text);
  const units: AuthoredOperatingUnit[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const label = `provinces/${provinceId}/operating-units.csv row ${index + 2}`;
    const id = requireCsvField(row, "id", label);
    if (seen.has(id)) throw new Error(`${label}: duplicate operating unit id ${id}.`);
    seen.add(id);
    const kind = requireCsvField(row, "kind", label);
    if (!OPERATING_UNIT_KIND_IDS.has(kind)) {
      throw new Error(`${label}: unknown kind ${kind}.`);
    }
    const defaultMarketId = optionalCsvField(row, "default_market_id");
    const ownerShares = optionalCsvNumber(row, "owner_shares", label);
    const initialCashCents = optionalCsvNumber(row, "initial_cash_cents", label);
    units.push({
      id,
      kind,
      industryId: requireCsvField(row, "industry_id", label),
      ...(defaultMarketId === undefined ? {} : { defaultMarketId }),
      ownerCompanyId: requireCsvField(row, "owner_company_id", label),
      ...(ownerShares === undefined ? {} : { ownerShares }),
      operatingStatus: optionalCsvField(row, "operating_status") ?? "active",
      ...(initialCashCents === undefined ? {} : { initialCashCents })
    });
  }
  return units;
}

export function parseCompanyCsv(
  text: string,
  expectedId: string
): Omit<AuthoredCompany, "shareholders"> {
  const { rows } = parseCsv(text);
  if (rows.length !== 1) {
    throw new Error(`companies/${expectedId}/company.csv must contain exactly one data row.`);
  }
  const row = rows[0]!;
  const label = `companies/${expectedId}/company.csv`;
  const id = requireCsvField(row, "id", label);
  if (id !== expectedId) {
    throw new Error(`${label}: id ${id} does not match directory ${expectedId}.`);
  }
  const initialCashCents = optionalCsvNumber(row, "initial_cash_cents", label);
  const dividendPayoutRate = optionalCsvNumber(row, "dividend_payout_rate", label);
  const minCashReserveCents = optionalCsvNumber(row, "min_cash_reserve_cents", label);
  return {
    id,
    legalName: requireCsvField(row, "legal_name", label),
    registrationCountryId: requireCsvField(row, "registration_country_id", label),
    headquartersUnitId: requireCsvField(row, "headquarters_unit_id", label),
    status: optionalCsvField(row, "status") ?? "active",
    ...(initialCashCents === undefined ? {} : { initialCashCents }),
    ...(dividendPayoutRate === undefined ? {} : { dividendPayoutRate }),
    ...(minCashReserveCents === undefined ? {} : { minCashReserveCents })
  };
}

export function parseShareholdersCsv(text: string, companyId: string): AuthoredShareholder[] {
  const { rows } = parseCsv(text);
  const shareholders: AuthoredShareholder[] = [];
  for (const [index, row] of rows.entries()) {
    const label = `companies/${companyId}/shareholders.csv row ${index + 2}`;
    const shareholderKind = requireCsvField(row, "shareholder_kind", label);
    if (
      shareholderKind !== "population_class" &&
      shareholderKind !== "government" &&
      shareholderKind !== "company"
    ) {
      throw new Error(`${label}: invalid shareholder_kind ${shareholderKind}.`);
    }
    const shares = parseCsvNumber(row, "shares", label);
    if (!Number.isInteger(shares) || shares <= 0) {
      throw new Error(`${label}.shares must be a positive integer.`);
    }
    if (shareholderKind === "population_class") {
      shareholders.push({
        shareholderKind,
        provinceId: requireCsvField(row, "province_id", label),
        socialClassId: requireCsvField(row, "social_class_id", label),
        shares
      });
      continue;
    }
    if (shareholderKind === "government") {
      shareholders.push({
        shareholderKind,
        countryId: requireCsvField(row, "country_id", label),
        shares
      });
      continue;
    }
    shareholders.push({
      shareholderKind,
      companyId: requireCsvField(row, "company_id", label),
      shares
    });
  }
  return shareholders;
}

async function loadProvincePack(
  provincesDir: string,
  provinceId: string
): Promise<AuthoredProvincePack> {
  const dir = join(provincesDir, provinceId);
  const overview = parseProvinceOverviewCsv(
    await readFile(join(dir, "province.csv"), "utf8"),
    provinceId
  );
  const classesDir = join(dir, "classes");
  const classes: AuthoredClassSeed[] = [];
  let classEntries: string[] = [];
  try {
    classEntries = (await readdir(classesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".csv"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    classEntries = [];
  }
  for (const fileName of classEntries) {
    const socialClassId = fileName.slice(0, -".csv".length);
    classes.push(
      parseClassCsv(
        await readFile(join(classesDir, fileName), "utf8"),
        socialClassId,
        `provinces/${provinceId}/classes/${fileName}`
      )
    );
  }
  let operatingUnits: AuthoredOperatingUnit[] = [];
  try {
    operatingUnits = parseOperatingUnitsCsv(
      await readFile(join(dir, "operating-units.csv"), "utf8"),
      provinceId
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  return { overview, classes, operatingUnits };
}

async function loadCompanies(companiesDir: string): Promise<AuthoredCompany[]> {
  let companyIds: string[] = [];
  try {
    companyIds = (await readdir(companiesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  const companies: AuthoredCompany[] = [];
  for (const companyId of companyIds) {
    const base = parseCompanyCsv(
      await readFile(join(companiesDir, companyId, "company.csv"), "utf8"),
      companyId
    );
    let shareholders: AuthoredShareholder[] = [];
    try {
      shareholders = parseShareholdersCsv(
        await readFile(join(companiesDir, companyId, "shareholders.csv"), "utf8"),
        companyId
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
    companies.push({ ...base, shareholders });
  }
  return companies;
}

export async function loadAuthoredMapContent(
  packDir: string,
  options: {
    readonly countriesPath: string;
    readonly provincesDir: string;
    readonly companiesDir: string;
  }
): Promise<AuthoredMapContent> {
  const countries = parseCountriesCsv(await readFile(join(packDir, options.countriesPath), "utf8"));
  const provincesRoot = join(packDir, options.provincesDir);
  const provinceIds = (await readdir(provincesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const provinces = new Map<string, AuthoredProvincePack>();
  for (const provinceId of provinceIds) {
    provinces.set(provinceId, await loadProvincePack(provincesRoot, provinceId));
  }
  const companies = await loadCompanies(join(packDir, options.companiesDir));
  return { countries, provinces, companies };
}

export function aggregateDemographicsFromClasses(
  provinces: ReadonlyMap<string, AuthoredProvincePack>
): Record<
  string,
  {
    pop: number;
    male: number;
    female: number;
    age: Record<string, number>;
    education15Plus: Record<string, number>;
    gdpPpp: number;
  }
> {
  const demographics: Record<
    string,
    {
      pop: number;
      male: number;
      female: number;
      age: Record<string, number>;
      education15Plus: Record<string, number>;
      gdpPpp: number;
    }
  > = {};
  for (const [provinceId, pack] of provinces) {
    if (pack.classes.length === 0) continue;
    const age: Record<string, number> = {};
    const education15Plus: Record<string, number> = {};
    let pop = 0;
    let male = 0;
    let female = 0;
    for (const classSeed of pack.classes) {
      pop += classSeed.populationPersons;
      male += classSeed.male;
      female += classSeed.female;
      for (const [band, value] of Object.entries(classSeed.age)) {
        age[band] = (age[band] ?? 0) + value;
      }
      for (const [level, value] of Object.entries(classSeed.education15Plus)) {
        education15Plus[level] = (education15Plus[level] ?? 0) + value;
      }
    }
    demographics[provinceId] = {
      pop,
      male,
      female,
      age,
      education15Plus,
      gdpPpp: pack.overview.gdpPpp ?? 0
    };
  }
  return demographics;
}

export interface ScenarioSeed {
  readonly mapId: string;
  readonly provinces: readonly { id: string; ownerCountryId: string }[];
  readonly classSeeds: readonly {
    provinceId: string;
    socialClassId: string;
    populationPersons: number;
    male: number;
    female: number;
    age: Readonly<Record<string, number>>;
    education15Plus: Readonly<Record<string, number>>;
    cashCents?: number;
  }[];
}

/** Population/ownership seed only. Company/OU/equity stay in L1 until bootstrap applies them. */
export function buildScenarioSeed(mapId: string, content: AuthoredMapContent): ScenarioSeed {
  const provinces = [...content.provinces.values()]
    .map((pack) => ({
      id: pack.overview.id,
      ownerCountryId: pack.overview.ownerCountryId
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const classSeeds = [...content.provinces.values()]
    .flatMap((pack) =>
      pack.classes.map((classSeed) => ({
        provinceId: pack.overview.id,
        socialClassId: classSeed.socialClassId,
        populationPersons: classSeed.populationPersons,
        male: classSeed.male,
        female: classSeed.female,
        age: classSeed.age,
        education15Plus: classSeed.education15Plus,
        ...(classSeed.cashCents === undefined ? {} : { cashCents: classSeed.cashCents })
      }))
    )
    .sort((left, right) => {
      const byProvince = left.provinceId.localeCompare(right.provinceId);
      return byProvince !== 0 ? byProvince : left.socialClassId.localeCompare(right.socialClassId);
    });

  return { mapId, provinces, classSeeds };
}

export function buildProvinceDefinitions(
  mapId: string,
  content: AuthoredMapContent
): Array<{
  id: string;
  map: { mapId: string; featureId: string };
  landAreaKm2: number;
  arableLandKm2: number;
  cultivationCondition: number;
  habitability: number;
  terrainProfileId: string;
  climateProfileId: string;
  resourcePotentialByResourceId: Record<string, number>;
}> {
  return [...content.provinces.values()]
    .map((pack) => ({
      id: pack.overview.id,
      map: { mapId, featureId: pack.overview.id },
      landAreaKm2: pack.overview.landAreaKm2,
      arableLandKm2: pack.overview.arableLandKm2,
      cultivationCondition: pack.overview.cultivationCondition,
      habitability: pack.overview.habitability,
      terrainProfileId: pack.overview.terrainProfileId,
      climateProfileId: pack.overview.climateProfileId,
      resourcePotentialByResourceId: { ...pack.overview.resourcePotentialByResourceId }
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function assertAuthoredCrossRefs(
  content: AuthoredMapContent,
  geometryProvinceIds: ReadonlySet<string>
): void {
  const countryIds = new Set(content.countries.map((country) => country.id));
  if (content.provinces.size !== geometryProvinceIds.size) {
    throw new Error(
      `Province directory count (${content.provinces.size}) does not match geometry feature count (${geometryProvinceIds.size}).`
    );
  }
  for (const provinceId of geometryProvinceIds) {
    if (!content.provinces.has(provinceId)) {
      throw new Error(`Geometry province ${provinceId} has no provinces/${provinceId}/ directory.`);
    }
  }
  for (const provinceId of content.provinces.keys()) {
    if (!geometryProvinceIds.has(provinceId)) {
      throw new Error(`provinces/${provinceId}/ has no matching geometry feature.`);
    }
  }

  const companyIds = new Set(content.companies.map((company) => company.id));
  const unitById = new Map<string, { provinceId: string; unit: AuthoredOperatingUnit }>();
  for (const [provinceId, pack] of content.provinces) {
    if (!countryIds.has(pack.overview.ownerCountryId)) {
      throw new Error(
        `Province ${provinceId} owner_country_id ${pack.overview.ownerCountryId} is unknown.`
      );
    }
    for (const unit of pack.operatingUnits) {
      if (unitById.has(unit.id)) {
        throw new Error(`Duplicate operating unit id ${unit.id}.`);
      }
      unitById.set(unit.id, { provinceId, unit });
      if (!companyIds.has(unit.ownerCompanyId)) {
        throw new Error(
          `Operating unit ${unit.id} owner_company_id ${unit.ownerCompanyId} is unknown.`
        );
      }
    }
  }

  for (const company of content.companies) {
    if (!countryIds.has(company.registrationCountryId)) {
      throw new Error(
        `Company ${company.id} registration_country_id ${company.registrationCountryId} is unknown.`
      );
    }
    const hq = unitById.get(company.headquartersUnitId);
    if (hq === undefined) {
      throw new Error(
        `Company ${company.id} headquarters_unit_id ${company.headquartersUnitId} is unknown.`
      );
    }
    if (hq.unit.kind !== "headquarters") {
      throw new Error(`Company ${company.id} headquarters unit must have kind=headquarters.`);
    }
    if (hq.unit.ownerCompanyId !== company.id) {
      throw new Error(
        `Company ${company.id} headquarters unit must set owner_company_id=${company.id}.`
      );
    }
    for (const shareholder of company.shareholders) {
      if (shareholder.shareholderKind === "population_class") {
        if (!content.provinces.has(shareholder.provinceId!)) {
          throw new Error(
            `Company ${company.id} shareholder province ${shareholder.provinceId} is unknown.`
          );
        }
        if (!SOCIAL_CLASS_IDS.has(shareholder.socialClassId!)) {
          throw new Error(
            `Company ${company.id} shareholder social class ${shareholder.socialClassId} is unknown.`
          );
        }
      } else if (shareholder.shareholderKind === "government") {
        if (!countryIds.has(shareholder.countryId!)) {
          throw new Error(
            `Company ${company.id} shareholder country ${shareholder.countryId} is unknown.`
          );
        }
      } else if (!companyIds.has(shareholder.companyId!)) {
        throw new Error(
          `Company ${company.id} shareholder company ${shareholder.companyId} is unknown.`
        );
      }
    }
  }

  // Company ownership cycle check (company→company edges only).
  const edges = new Map<string, string[]>();
  for (const company of content.companies) {
    edges.set(
      company.id,
      company.shareholders
        .filter((shareholder) => shareholder.shareholderKind === "company")
        .map((shareholder) => shareholder.companyId!)
    );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (companyId: string): void => {
    if (visited.has(companyId)) return;
    if (visiting.has(companyId)) {
      throw new Error(`Company ownership cycle involving ${companyId}.`);
    }
    visiting.add(companyId);
    for (const next of edges.get(companyId) ?? []) {
      visit(next);
    }
    visiting.delete(companyId);
    visited.add(companyId);
  };
  for (const companyId of companyIds) {
    visit(companyId);
  }
}
