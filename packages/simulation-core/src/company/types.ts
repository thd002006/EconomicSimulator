import type { LedgerAccountId } from "../ledger/types.js";
import type { OperatingUnitId } from "../operating-unit/types.js";

export type CompanyId = string;
export type CountryId = string;
export type Tick = number;

export const COMPANY_STATUSES = ["active", "insolvent", "liquidating", "closed"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export interface CompanyAccountRefs {
  readonly cash: LedgerAccountId;
  readonly receivables: LedgerAccountId;
  readonly payables: LedgerAccountId;
  readonly debt: LedgerAccountId;
  readonly investments: LedgerAccountId;
  readonly contributedCapital: LedgerAccountId;
  readonly retainedEarnings: LedgerAccountId;
}

export interface CompanyDividendPolicyState {
  targetPayoutRate: number;
  minimumCashReserveCents: number;
}

export interface CompanyCapitalPolicyState {
  minimumOwnershipForNewOperatingUnit: number;
  maximumDebtToEquity: number;
  headquartersFundingReserveCents: number;
}

export interface CompanyState {
  readonly id: CompanyId;
  legalName: string;
  registrationCountryId: CountryId;
  status: CompanyStatus;
  readonly headquartersOperatingUnitId: OperatingUnitId;
  readonly foundedTick: Tick;
  closedTick: Tick | null;
  readonly accountRefs: CompanyAccountRefs;
  dividendPolicy: CompanyDividendPolicyState;
  capitalPolicy: CompanyCapitalPolicyState;
}

export interface CompanyWorld {
  readonly companies: Map<CompanyId, CompanyState>;
  /** Rebuildable: headquarters unit id → company id */
  readonly companyIdByHeadquartersUnitId: Map<OperatingUnitId, CompanyId>;
}

export interface CompanyFoundedEvent {
  readonly kind: "company-founded";
  readonly companyId: CompanyId;
  readonly headquartersOperatingUnitId: OperatingUnitId;
  readonly tick: Tick;
}
