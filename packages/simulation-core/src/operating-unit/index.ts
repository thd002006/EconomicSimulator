import { createAccount, type LedgerWorld } from "../ledger/index.js";
import { removeEmployer, setEmployer } from "../population/index.js";
import type { PopulationWorld } from "../population/types.js";
import { getOperatingUnitKindDefinition } from "./static-data.js";
import type {
  IndustryId,
  MarketId,
  OperatingComponentState,
  OperatingUnitAccountRefs,
  OperatingUnitDividendPolicyState,
  OperatingUnitId,
  OperatingUnitKind,
  OperatingUnitOperatingStatus,
  OperatingUnitState,
  OperatingUnitWorld,
  ProvinceId,
  Tick
} from "./types.js";

export type {
  HeadquartersSiteState,
  IndustryId,
  MarketId,
  OperatingComponentKind,
  OperatingComponentState,
  OperatingUnitAccountRefs,
  OperatingUnitDividendPolicyState,
  OperatingUnitId,
  OperatingUnitKind,
  OperatingUnitKindDefinition,
  OperatingUnitOperatingStatus,
  OperatingUnitState,
  OperatingUnitWorld,
  ProvinceId,
  Tick
} from "./types.js";
export {
  OPERATING_UNIT_KINDS,
  OPERATING_UNIT_STATUSES
} from "./types.js";
export {
  getOperatingUnitKindDefinition,
  OPERATING_UNIT_KIND_DEFINITIONS
} from "./static-data.js";

const DEFAULT_DIVIDEND_POLICY: OperatingUnitDividendPolicyState = {
  targetPayoutRate: 0,
  minimumCashReserveCents: 0
};

export function createOperatingUnitWorld(): OperatingUnitWorld {
  return {
    units: new Map(),
    components: new Map(),
    unitIdsByProvince: new Map(),
    unitIdsByKind: new Map()
  };
}

function accountId(unitId: OperatingUnitId, suffix: string): string {
  return `ou:${unitId}:${suffix}`;
}

export function createOperatingUnitAccountRefs(
  ledger: LedgerWorld,
  unitId: OperatingUnitId
): OperatingUnitAccountRefs {
  return {
    cash: createAccount(ledger, accountId(unitId, "cash")).id,
    receivables: createAccount(ledger, accountId(unitId, "receivables")).id,
    payables: createAccount(ledger, accountId(unitId, "payables"), 0, "equity").id,
    debt: createAccount(ledger, accountId(unitId, "debt"), 0, "equity").id,
    inventory: createAccount(ledger, accountId(unitId, "inventory")).id,
    fixedAssets: createAccount(ledger, accountId(unitId, "fixedAssets")).id,
    accumulatedDepreciation: createAccount(
      ledger,
      accountId(unitId, "accumulatedDepreciation"),
      0,
      "equity"
    ).id,
    contributedCapital: createAccount(ledger, accountId(unitId, "contributedCapital"), 0, "equity")
      .id,
    retainedEarnings: createAccount(ledger, accountId(unitId, "retainedEarnings"), 0, "equity").id
  };
}

function createComponentForKind(
  kind: OperatingUnitKind,
  operatingUnitId: OperatingUnitId
): OperatingComponentState {
  const definition = getOperatingUnitKindDefinition(kind);
  if (!definition.creatable) {
    throw new Error(`Operating unit kind is not creatable in M1: ${kind}.`);
  }
  switch (definition.requiredComponentKind) {
    case "production_site":
      return { kind: "production_site", operatingUnitId };
    case "retail_site":
      return { kind: "retail_site", operatingUnitId };
    case "headquarters_site":
      return { kind: "headquarters_site", operatingUnitId, managementServiceIds: [] };
    case "infrastructure_operator":
      return { kind: "infrastructure_operator", operatingUnitId };
    default:
      throw new Error(`No M1 component implementation for kind: ${kind}.`);
  }
}

function indexAdd(world: OperatingUnitWorld, unit: OperatingUnitState): void {
  let byProvince = world.unitIdsByProvince.get(unit.provinceId);
  if (byProvince === undefined) {
    byProvince = new Set();
    world.unitIdsByProvince.set(unit.provinceId, byProvince);
  }
  byProvince.add(unit.id);

  let byKind = world.unitIdsByKind.get(unit.kind);
  if (byKind === undefined) {
    byKind = new Set();
    world.unitIdsByKind.set(unit.kind, byKind);
  }
  byKind.add(unit.id);
}

function indexRemove(world: OperatingUnitWorld, unit: OperatingUnitState): void {
  world.unitIdsByProvince.get(unit.provinceId)?.delete(unit.id);
  world.unitIdsByKind.get(unit.kind)?.delete(unit.id);
}

export interface CreateOperatingUnitParams {
  readonly id: OperatingUnitId;
  readonly kind: OperatingUnitKind;
  readonly provinceId: ProvinceId;
  readonly industryId: IndustryId;
  readonly defaultMarketId: MarketId;
  readonly foundedTick: Tick;
  readonly operatingStatus?: OperatingUnitOperatingStatus;
  readonly dividendPolicy?: OperatingUnitDividendPolicyState;
  /** When false, skip population employer registration (tests without population). Default true. */
  readonly registerEmployer?: boolean;
}

function createOperatingUnitUnchecked(
  world: OperatingUnitWorld,
  ledger: LedgerWorld,
  population: PopulationWorld | undefined,
  params: CreateOperatingUnitParams
): OperatingUnitState {
  if (world.units.has(params.id)) {
    throw new Error(`Operating unit already exists: ${params.id}.`);
  }
  if (params.id.trim().length === 0) {
    throw new Error("Operating unit id must not be empty.");
  }

  const definition = getOperatingUnitKindDefinition(params.kind);
  if (!definition.creatable) {
    throw new Error(`Operating unit kind is not creatable in M1: ${params.kind}.`);
  }

  const status = params.operatingStatus ?? "active";
  if (status === "closed") {
    throw new Error("Cannot create an operating unit already closed.");
  }

  const accountRefs = createOperatingUnitAccountRefs(ledger, params.id);
  const component = createComponentForKind(params.kind, params.id);
  if (component.kind !== definition.requiredComponentKind) {
    throw new Error(
      `Component kind mismatch for ${params.kind}: expected ${definition.requiredComponentKind}.`
    );
  }

  const unit: OperatingUnitState = {
    id: params.id,
    kind: params.kind,
    provinceId: params.provinceId,
    industryId: params.industryId,
    defaultMarketId: params.defaultMarketId,
    operatingStatus: status,
    foundedTick: params.foundedTick,
    activatedTick: status === "active" ? params.foundedTick : null,
    closedTick: null,
    accountRefs,
    dividendPolicy: { ...(params.dividendPolicy ?? DEFAULT_DIVIDEND_POLICY) }
  };

  world.units.set(unit.id, unit);
  world.components.set(unit.id, component);
  indexAdd(world, unit);

  if (params.registerEmployer !== false && population !== undefined) {
    setEmployer(population, unit.provinceId, { id: unit.id, jobDemands: [] });
  }

  return unit;
}

/** Public create path: headquarters must go through createCompany. */
export function createOperatingUnit(
  world: OperatingUnitWorld,
  ledger: LedgerWorld,
  population: PopulationWorld | undefined,
  params: CreateOperatingUnitParams
): OperatingUnitState {
  if (params.kind === "headquarters") {
    throw new Error("Headquarters must be created via createCompany.");
  }
  return createOperatingUnitUnchecked(world, ledger, population, params);
}

/** Company-module-only HQ create path. Not re-exported from the package root. */
export function createHeadquartersOperatingUnit(
  world: OperatingUnitWorld,
  ledger: LedgerWorld,
  population: PopulationWorld | undefined,
  params: Omit<CreateOperatingUnitParams, "kind">
): OperatingUnitState {
  return createOperatingUnitUnchecked(world, ledger, population, {
    ...params,
    kind: "headquarters"
  });
}

export function getOperatingUnit(
  world: OperatingUnitWorld,
  id: OperatingUnitId
): OperatingUnitState | undefined {
  return world.units.get(id);
}

export function getOperatingComponent(
  world: OperatingUnitWorld,
  id: OperatingUnitId
): OperatingComponentState | undefined {
  return world.components.get(id);
}

export function listOperatingUnitsByProvince(
  world: OperatingUnitWorld,
  provinceId: ProvinceId
): readonly OperatingUnitState[] {
  const ids = world.unitIdsByProvince.get(provinceId);
  if (ids === undefined) {
    return [];
  }
  return [...ids].map((id) => world.units.get(id)!).filter(Boolean);
}

export function listOperatingUnitsByKind(
  world: OperatingUnitWorld,
  kind: OperatingUnitKind
): readonly OperatingUnitState[] {
  const ids = world.unitIdsByKind.get(kind);
  if (ids === undefined) {
    return [];
  }
  return [...ids].map((id) => world.units.get(id)!).filter(Boolean);
}

const ALLOWED_TRANSITIONS: Readonly<
  Record<OperatingUnitOperatingStatus, readonly OperatingUnitOperatingStatus[]>
> = {
  planned: ["under_construction", "active", "closed"],
  under_construction: ["active", "suspended", "closed"],
  active: ["suspended", "insolvent", "liquidating", "closed"],
  suspended: ["active", "insolvent", "liquidating", "closed"],
  insolvent: ["liquidating", "closed"],
  liquidating: ["closed"],
  closed: []
};

export function transitionOperatingUnitStatus(
  world: OperatingUnitWorld,
  population: PopulationWorld | undefined,
  id: OperatingUnitId,
  next: OperatingUnitOperatingStatus,
  tick: Tick
): OperatingUnitState {
  const unit = world.units.get(id);
  if (unit === undefined) {
    throw new Error(`Unknown operating unit: ${id}.`);
  }
  const allowed = ALLOWED_TRANSITIONS[unit.operatingStatus];
  if (!allowed.includes(next)) {
    throw new Error(`Invalid status transition ${unit.operatingStatus} → ${next}.`);
  }
  if (unit.kind === "headquarters" && next === "closed") {
    throw new Error("Headquarters cannot be closed via ordinary operating-unit status transition.");
  }

  unit.operatingStatus = next;
  if (next === "active" && unit.activatedTick === null) {
    unit.activatedTick = tick;
  }
  if (next === "closed") {
    unit.closedTick = tick;
    if (population !== undefined) {
      removeEmployer(population, id);
    }
  }
  return unit;
}

export function rebuildOperatingUnitIndexes(world: OperatingUnitWorld): void {
  world.unitIdsByProvince.clear();
  world.unitIdsByKind.clear();
  for (const unit of world.units.values()) {
    indexAdd(world, unit);
  }
}

/** Remove unit from world maps (used when rolling back a failed CreateCompany batch). */
export function unregisterOperatingUnit(
  world: OperatingUnitWorld,
  population: PopulationWorld | undefined,
  id: OperatingUnitId
): void {
  const unit = world.units.get(id);
  if (unit === undefined) {
    return;
  }
  indexRemove(world, unit);
  world.units.delete(id);
  world.components.delete(id);
  if (population !== undefined) {
    removeEmployer(population, id);
  }
}
