import type { LedgerAccountId } from "../ledger/types.js";

export type OperatingUnitId = string;
export type ProvinceId = string;
export type IndustryId = string;
export type MarketId = string;
export type Tick = number;

export const OPERATING_UNIT_KINDS = [
  "factory",
  "farm",
  "store",
  "service_business",
  "headquarters",
  "warehouse",
  "road",
  "railway",
  "port",
  "utility",
  "government_service"
] as const;

export type OperatingUnitKind = (typeof OPERATING_UNIT_KINDS)[number];

export const OPERATING_UNIT_STATUSES = [
  "planned",
  "under_construction",
  "active",
  "suspended",
  "insolvent",
  "liquidating",
  "closed"
] as const;

export type OperatingUnitOperatingStatus = (typeof OPERATING_UNIT_STATUSES)[number];

export type OperatingComponentKind =
  | "production_site"
  | "retail_site"
  | "service_site"
  | "headquarters_site"
  | "warehouse_site"
  | "infrastructure_operator"
  | "utility_site"
  | "government_service_site";

export interface OperatingUnitKindDefinition {
  readonly kind: OperatingUnitKind;
  readonly requiredComponentKind: OperatingComponentKind;
  readonly permitsInventory: boolean;
  readonly permitsRelocation: boolean;
  /** M1: only these kinds can be created. */
  readonly creatable: boolean;
}

export interface OperatingUnitAccountRefs {
  readonly cash: LedgerAccountId;
  readonly receivables: LedgerAccountId;
  readonly payables: LedgerAccountId;
  readonly debt: LedgerAccountId;
  readonly inventory: LedgerAccountId;
  readonly fixedAssets: LedgerAccountId;
  readonly accumulatedDepreciation: LedgerAccountId;
  readonly contributedCapital: LedgerAccountId;
  readonly retainedEarnings: LedgerAccountId;
}

export interface OperatingUnitDividendPolicyState {
  targetPayoutRate: number;
  minimumCashReserveCents: number;
}

export interface OperatingUnitState {
  readonly id: OperatingUnitId;
  readonly kind: OperatingUnitKind;
  provinceId: ProvinceId;
  industryId: IndustryId;
  defaultMarketId: MarketId;
  operatingStatus: OperatingUnitOperatingStatus;
  readonly foundedTick: Tick;
  activatedTick: Tick | null;
  closedTick: Tick | null;
  readonly accountRefs: OperatingUnitAccountRefs;
  dividendPolicy: OperatingUnitDividendPolicyState;
}

export interface ProductionSiteState {
  readonly kind: "production_site";
  readonly operatingUnitId: OperatingUnitId;
}

export interface RetailSiteState {
  readonly kind: "retail_site";
  readonly operatingUnitId: OperatingUnitId;
}

export interface HeadquartersSiteState {
  readonly kind: "headquarters_site";
  readonly operatingUnitId: OperatingUnitId;
  managementServiceIds: string[];
}

export interface InfrastructureOperatorState {
  readonly kind: "infrastructure_operator";
  readonly operatingUnitId: OperatingUnitId;
}

export type OperatingComponentState =
  | ProductionSiteState
  | RetailSiteState
  | HeadquartersSiteState
  | InfrastructureOperatorState;

export interface OperatingUnitWorld {
  readonly units: Map<OperatingUnitId, OperatingUnitState>;
  readonly components: Map<OperatingUnitId, OperatingComponentState>;
  /** Rebuildable index: provinceId → unit ids */
  readonly unitIdsByProvince: Map<ProvinceId, Set<OperatingUnitId>>;
  /** Rebuildable index: kind → unit ids */
  readonly unitIdsByKind: Map<OperatingUnitKind, Set<OperatingUnitId>>;
}
