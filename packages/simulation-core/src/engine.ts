import { nextXorShift32, normalizeSeed } from "./prng";
import {
  aggregateProvinceDemographics,
  getCountryPopulationSummary,
  getProvinceClassPopulationBreakdowns,
  getProvincePopulationSummary,
  type CountryPopulationSummary
} from "./population/index.js";
import {
  MAX_ADVANCE_TICKS,
  SIMULATION_SNAPSHOT_VERSION,
  type AdvanceResult,
  type CountryId,
  type NewSimulationInput,
  type ProvinceId,
  type ProvincePopulationQueryResult,
  type SimulationEngine,
  type SimulationSnapshot,
  type SimulationStateV1,
  type SimulationSummary
} from "./types";
import { bootstrapGameWorld, type GameWorldV1 } from "./world-bootstrap.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneState(state: SimulationStateV1): SimulationStateV1 {
  return { ...state };
}

function parseSnapshot(value: unknown): SimulationSnapshot {
  if (!isRecord(value) || value.snapshotVersion !== SIMULATION_SNAPSHOT_VERSION) {
    throw new Error("Unsupported or invalid simulation snapshot version.");
  }

  const state = value.state;
  if (!isRecord(state)) {
    throw new Error("Simulation snapshot is missing state.");
  }

  const valid =
    state.schemaVersion === SIMULATION_SNAPSHOT_VERSION &&
    typeof state.simulationId === "string" &&
    state.simulationId.length > 0 &&
    Number.isSafeInteger(state.tick) &&
    (state.tick as number) >= 0 &&
    Number.isSafeInteger(state.seed) &&
    Number.isSafeInteger(state.randomState);

  if (!valid) {
    throw new Error("Simulation snapshot state is invalid.");
  }

  return {
    snapshotVersion: SIMULATION_SNAPSHOT_VERSION,
    state: {
      schemaVersion: SIMULATION_SNAPSHOT_VERSION,
      simulationId: state.simulationId as string,
      tick: state.tick as number,
      seed: (state.seed as number) >>> 0,
      randomState: (state.randomState as number) >>> 0
    }
  };
}

function fingerprint(state: SimulationStateV1): string {
  return [state.schemaVersion, state.simulationId, state.tick, state.seed, state.randomState]
    .join(":")
    .toLowerCase();
}

export class DeterministicSimulationEngine implements SimulationEngine {
  private state: SimulationStateV1;
  private readonly world: GameWorldV1 | undefined;

  public constructor(input: NewSimulationInput) {
    if (input.simulationId.trim().length === 0) {
      throw new Error("Simulation ID must not be empty.");
    }

    const seed = normalizeSeed(input.seed);
    this.state = {
      schemaVersion: SIMULATION_SNAPSHOT_VERSION,
      simulationId: input.simulationId,
      tick: 0,
      seed,
      randomState: seed
    };
    this.world = input.scenario === undefined ? undefined : bootstrapGameWorld(input.scenario);
  }

  private requireWorld(): GameWorldV1 {
    if (this.world === undefined) {
      throw new Error("Simulation world is not initialized; provide scenario on initialize.");
    }
    return this.world;
  }

  public advance(tickCount: number): AdvanceResult {
    if (!Number.isSafeInteger(tickCount) || tickCount < 0 || tickCount > MAX_ADVANCE_TICKS) {
      throw new Error(`tickCount must be an integer between 0 and ${MAX_ADVANCE_TICKS}.`);
    }

    let randomState = this.state.randomState;
    for (let index = 0; index < tickCount; index += 1) {
      randomState = nextXorShift32(randomState);
    }

    this.state = {
      ...this.state,
      tick: this.state.tick + tickCount,
      randomState
    };

    return { advancedTicks: tickCount, summary: this.getSummary() };
  }

  public getSummary(): SimulationSummary {
    return {
      simulationId: this.state.simulationId,
      tick: this.state.tick,
      seed: this.state.seed,
      stateFingerprint: fingerprint(this.state)
    };
  }

  public queryProvincePopulation(provinceId: ProvinceId): ProvincePopulationQueryResult {
    const world = this.requireWorld();
    return {
      summary: getProvincePopulationSummary(world.population, provinceId),
      demographics: aggregateProvinceDemographics(world.population, provinceId),
      classes: getProvinceClassPopulationBreakdowns(world.population, provinceId)
    };
  }

  public queryCountryPopulation(countryId: CountryId): CountryPopulationSummary {
    const world = this.requireWorld();
    return getCountryPopulationSummary(world.population, world.provinceOwnership, countryId);
  }

  public queryProvinceOwner(provinceId: ProvinceId): CountryId | undefined {
    return this.requireWorld().provinceOwnership.get(provinceId);
  }

  public queryOwnershipTable(): Readonly<Record<ProvinceId, CountryId>> {
    return Object.fromEntries(this.requireWorld().provinceOwnership);
  }

  public createSnapshot(): SimulationSnapshot {
    return {
      snapshotVersion: SIMULATION_SNAPSHOT_VERSION,
      state: cloneState(this.state)
    };
  }

  public restoreSnapshot(value: unknown): SimulationSummary {
    const snapshot = parseSnapshot(value);
    this.state = cloneState(snapshot.state);
    return this.getSummary();
  }
}

export function isSimulationSnapshot(value: unknown): value is SimulationSnapshot {
  try {
    parseSnapshot(value);
    return true;
  } catch {
    return false;
  }
}
