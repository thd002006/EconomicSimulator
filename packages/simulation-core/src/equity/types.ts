export type CompanyId = string;
export type OperatingUnitId = string;
export type ProvinceId = string;
export type SocialClassId = string;
export type CountryId = string;
export type Tick = number;
export type LedgerAccountId = string;

export type ShareIssuerRef =
  | { readonly kind: "company"; readonly companyId: CompanyId }
  | { readonly kind: "operating_unit"; readonly operatingUnitId: OperatingUnitId };

export type ShareholderRef =
  | {
      readonly kind: "population_class";
      readonly provinceId: ProvinceId;
      readonly socialClassId: SocialClassId;
    }
  | { readonly kind: "government"; readonly countryId: CountryId }
  | { readonly kind: "company"; readonly companyId: CompanyId };

export interface EquityState {
  readonly issuer: ShareIssuerRef;
  totalSharesOutstanding: number;
}

export interface SharePositionState {
  readonly issuer: ShareIssuerRef;
  readonly shareholder: ShareholderRef;
  sharesOwned: number;
  lastChangedTick: Tick;
}

export interface IssueSharesCommand {
  readonly kind: "issue-shares";
  readonly commandId: string;
  readonly issuer: ShareIssuerRef;
  readonly subscriber: ShareholderRef;
  readonly sharesToIssue: number;
  readonly totalSubscriptionPriceCents: number;
  readonly tick: Tick;
}

export interface EquityAccountResolver {
  getCashAccount(shareholder: ShareholderRef): LedgerAccountId;
  getInvestmentAccount(shareholder: ShareholderRef): LedgerAccountId;
  getIssuerCashAccount(issuer: ShareIssuerRef): LedgerAccountId;
  getIssuerContributedCapitalAccount(issuer: ShareIssuerRef): LedgerAccountId;
}

export interface EquityWorld {
  readonly equityByIssuer: Map<string, EquityState>;
  readonly positions: Map<string, SharePositionState>;
}

export interface SharesIssuedEvent {
  readonly kind: "shares-issued";
  readonly commandId: string;
  readonly issuer: ShareIssuerRef;
  readonly subscriber: ShareholderRef;
  readonly sharesIssued: number;
  readonly totalSubscriptionPriceCents: number;
  readonly tick: Tick;
}
