import type { CountryPopulationSummary, ProvinceDemographicBreakdown } from "./population/index.js";
import type { ProvincePopulationSummary } from "./population/types.js";

export const SIMULATION_SNAPSHOT_VERSION = 1 as const;
export const MAX_ADVANCE_TICKS = 1_000_000;

export type ProvinceId = string;
export type CountryId = string;

/** Map demographics used only to seed PopulationWorld at initialize. */
export interface ScenarioProvinceDemographics {
  readonly pop: number;
  readonly male: number;
  readonly female: number;
  readonly age: Readonly<Record<string, number>>;
  readonly education15Plus: Readonly<Record<string, number>>;
}

export interface ScenarioProvinceBootstrap {
  readonly id: ProvinceId;
  readonly ownerCountryId: CountryId;
  readonly demographics?: ScenarioProvinceDemographics;
}

export interface ScenarioBootstrap {
  readonly mapId: string;
  readonly provinces: readonly ScenarioProvinceBootstrap[];
}

export interface NewSimulationInput {
  readonly simulationId: string;
  readonly seed: number;
  readonly scenario?: ScenarioBootstrap;
}

export interface SimulationStateV1 {
  readonly schemaVersion: typeof SIMULATION_SNAPSHOT_VERSION;
  readonly simulationId: string;
  readonly tick: number;
  readonly seed: number;
  readonly randomState: number;
}

export interface SimulationSnapshotV1 {
  readonly snapshotVersion: typeof SIMULATION_SNAPSHOT_VERSION;
  readonly state: SimulationStateV1;
}

export type SimulationSnapshot = SimulationSnapshotV1;

export interface SimulationSummary {
  readonly simulationId: string;
  readonly tick: number;
  readonly seed: number;
  readonly stateFingerprint: string;
}

export interface AdvanceResult {
  readonly advancedTicks: number;
  readonly summary: SimulationSummary;
}

export interface ProvincePopulationQueryResult {
  readonly summary: ProvincePopulationSummary;
  readonly demographics: ProvinceDemographicBreakdown;
}

export interface SimulationEngine {
  advance(tickCount: number): AdvanceResult;
  getSummary(): SimulationSummary;
  createSnapshot(): SimulationSnapshot;
  restoreSnapshot(snapshot: unknown): SimulationSummary;
  queryProvincePopulation(provinceId: ProvinceId): ProvincePopulationQueryResult;
  queryCountryPopulation(countryId: CountryId): CountryPopulationSummary;
  queryProvinceOwner(provinceId: ProvinceId): CountryId | undefined;
  queryOwnershipTable(): Readonly<Record<ProvinceId, CountryId>>;
}
