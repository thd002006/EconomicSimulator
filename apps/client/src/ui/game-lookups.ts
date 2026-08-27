import type { ProvinceFeature } from "@economic-simulator/map-runtime";
import type {
  CountryPopulationSummary,
  ProvincePopulationQueryResult
} from "@economic-simulator/simulation-core";
import type { MapSelection } from "./selection.js";

export interface MapDisplayLookups {
  readonly findProvince: (id: string) => ProvinceFeature | undefined;
  readonly getCountryName: (ownerId: string) => string | undefined;
}

export interface GameUiLookups extends MapDisplayLookups {
  readonly getOwner: (provinceId: string) => string | undefined;
  readonly getProvincePopulation: (provinceId: string) => ProvincePopulationQueryResult | undefined;
  readonly getCountryPopulation: (countryId: string) => CountryPopulationSummary | undefined;
}

export function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function formatGdp(): string {
  return "—";
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
    return {
      title: provinceDisplayName(feature, selection.id),
      lines: [
        ownerId === undefined ? "—" : countryDisplayName(lookups, ownerId),
        `人口 ${formatCount(pop?.summary.populationPersons)}`,
        `GDP ${formatGdp()}`
      ]
    };
  }
  const aggregate = lookups.getCountryPopulation(selection.id);
  return {
    title: countryDisplayName(lookups, selection.id),
    lines: [
      `人口 ${formatCount(aggregate?.populationPersons)}`,
      `GDP ${formatGdp()}`
    ]
  };
}

export function mergeGameUiLookups(
  map: MapDisplayLookups,
  ownership: Readonly<Record<string, string>>,
  provincePopulation: Readonly<Record<string, ProvincePopulationQueryResult>>,
  countryPopulation: Readonly<Record<string, CountryPopulationSummary>>
): GameUiLookups {
  return {
    findProvince: map.findProvince,
    getCountryName: map.getCountryName,
    getOwner: (provinceId) => ownership[provinceId],
    getProvincePopulation: (provinceId) => provincePopulation[provinceId],
    getCountryPopulation: (countryId) => countryPopulation[countryId]
  };
}
