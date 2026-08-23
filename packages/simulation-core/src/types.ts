export const SIMULATION_SNAPSHOT_VERSION = 1 as const;
export const MAX_ADVANCE_TICKS = 1_000_000;

export interface NewSimulationInput {
  readonly simulationId: string;
  readonly seed: number;
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

export interface SimulationEngine {
  advance(tickCount: number): AdvanceResult;
  getSummary(): SimulationSummary;
  createSnapshot(): SimulationSnapshot;
  restoreSnapshot(snapshot: unknown): SimulationSummary;
}
