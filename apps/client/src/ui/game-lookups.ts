import { getProvinceDefinition } from "@economic-simulator/game-data";
import type { ProvinceFeature, ProvinceDemographicsTable } from "@economic-simulator/map-runtime";
import type {
  CountryPopulationSummary,
  ProvincePopulationQueryResult
} from "@economic-simulator/simulation-core";
import type { MapSelection } from "./selection.js";

export interface MapDisplayLookups {
  readonly findProvince: (id: string) => ProvinceFeature | undefined;
  readonly getCountryName: (ownerId: string) => string | undefined;
  readonly getCountryGdpPpp: (ownerId: string) => number | undefined;
}

export interface GameUiLookups extends MapDisplayLookups {
  readonly getOwner: (provinceId: string) => string | undefined;
  readonly getProvincePopulation: (provinceId: string) => ProvincePopulationQueryResult | undefined;
  readonly getCountryPopulation: (countryId: string) => CountryPopulationSummary | undefined;
  readonly getProvinceGdpPpp: (provinceId: string) => number | undefined;
  readonly getProvinceArableLandKm2: (provinceId: string) => number | undefined;
  readonly getProvinceLivability: (provinceId: string) => number | undefined;
  readonly getProvinceLandAreaKm2: (provinceId: string) => number | undefined;
}

export function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function formatGdp(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function formatAreaKm2(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString("en-US")} km²`;
}

export function formatLivability(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

const SOCIAL_CLASS_LABELS: Readonly<Record<string, string>> = {
  farmer: "Farmer",
  worker: "Worker",
  skilled_worker: "Skilled Worker",
  service_worker: "Service Worker",
  office_worker: "Office Worker",
  professional: "Professional",
  managerial: "Managerial",
  civil_servant: "Civil Servant",
  small_business_owner: "Small Business Owner",
  capitalist: "Capitalist",
  rentier: "Rentier"
};

const EMPLOYMENT_LABELS: Readonly<Record<string, string>> = {
  employed: "Employed",
  unemployed: "Unemployed",
  student: "Student",
  retired: "Retired",
  not_in_labor_force: "Not in labor force"
};

const EDUCATION_LABELS: Readonly<Record<string, string>> = {
  basic: "Basic",
  secondary: "Secondary",
  tertiary: "Tertiary",
  advanced: "Advanced"
};

const SKILL_LABELS: Readonly<Record<string, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  expert: "Expert"
};

const GENDER_LABELS: Readonly<Record<string, string>> = {
  male: "Male",
  female: "Female"
};

export function socialClassDisplayName(socialClassId: string): string {
  return SOCIAL_CLASS_LABELS[socialClassId] ?? socialClassId.replaceAll("_", " ");
}

export function dimensionLabel(dimension: string, key: string): string {
  switch (dimension) {
    case "age":
      return key;
    case "employment":
      return EMPLOYMENT_LABELS[key] ?? key;
    case "education":
      return EDUCATION_LABELS[key] ?? key;
    case "skill":
      return SKILL_LABELS[key] ?? key;
    case "gender":
      return GENDER_LABELS[key] ?? key;
    case "social_class":
      return socialClassDisplayName(key);
    default:
      return key.replaceAll("_", " ");
  }
}

export function ageCountsToSingleYearRecord(
  age: readonly number[] | Readonly<Record<string, number>> | undefined
): Record<string, number> | undefined {
  if (age === undefined) return undefined;
  if (Array.isArray(age)) {
    return Object.fromEntries(age.map((value, age) => [String(age), value ?? 0]));
  }
  return age as Record<string, number>;
}

export function countryDisplayName(lookups: MapDisplayLookups, countryId: string): string {
  return lookups.getCountryName(countryId) ?? countryId;
}

export function provinceDisplayName(feature: ProvinceFeature | undefined, id: string): string {
  if (feature === undefined) return id;
  return feature.properties.nameEn ?? feature.properties.name ?? id;
}

export function hoverStats(
  selection: MapSelection,
  lookups: GameUiLookups
): { title: string; lines: readonly string[] } {
  if (selection.kind === "province") {
    const feature = lookups.findProvince(selection.id);
    const ownerId = lookups.getOwner(selection.id);
    const pop = lookups.getProvincePopulation(selection.id);
    const disputed = feature?.properties.disputed;
    const lines = [
      ownerId === undefined ? "—" : countryDisplayName(lookups, ownerId),
      `Population ${formatCount(pop?.summary.populationPersons)}`,
      `GDP ${formatGdp(lookups.getProvinceGdpPpp(selection.id))}`
    ];
    if (disputed !== undefined) {
      lines.push(
        `Disputed · ${countryDisplayName(lookups, disputed.administeredBy)} administers · claimed by ${disputed.claimedBy
          .map((id) => countryDisplayName(lookups, id))
          .join(", ")}`
      );
    }
    return {
      title: provinceDisplayName(feature, selection.id),
      lines
    };
  }
  const aggregate = lookups.getCountryPopulation(selection.id);
  return {
    title: countryDisplayName(lookups, selection.id),
    lines: [
      `Population ${formatCount(aggregate?.populationPersons)}`,
      `GDP ${formatGdp(lookups.getCountryGdpPpp(selection.id))}`
    ]
  };
}

export function mergeGameUiLookups(
  map: MapDisplayLookups,
  ownership: Readonly<Record<string, string>>,
  provincePopulation: Readonly<Record<string, ProvincePopulationQueryResult>>,
  countryPopulation: Readonly<Record<string, CountryPopulationSummary>>,
  demographics: ProvinceDemographicsTable | undefined
): GameUiLookups {
  return {
    findProvince: map.findProvince,
    getCountryName: map.getCountryName,
    getCountryGdpPpp: map.getCountryGdpPpp,
    getOwner: (provinceId) => ownership[provinceId],
    getProvincePopulation: (provinceId) => provincePopulation[provinceId],
    getCountryPopulation: (countryId) => countryPopulation[countryId],
    getProvinceGdpPpp: (provinceId) => demographics?.[provinceId]?.gdpPpp,
    getProvinceArableLandKm2: (provinceId) => getProvinceDefinition(provinceId)?.arableLandKm2,
    getProvinceLivability: (provinceId) => getProvinceDefinition(provinceId)?.habitability,
    getProvinceLandAreaKm2: (provinceId) => getProvinceDefinition(provinceId)?.landAreaKm2
  };
}
