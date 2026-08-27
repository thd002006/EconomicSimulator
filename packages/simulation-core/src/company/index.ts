import {
  createEquityAccountResolver,
  ensureExternalShareholderAccounts,
  type ExternalShareholderAccounts
} from "./accounts.js";
import {
  getEquityState,
  getSharePosition,
  issuerKey,
  issueShares,
  ownershipShare,
  type EquityWorld,
  type ShareIssuerRef,
  type ShareholderRef,
  type SharesIssuedEvent
} from "../equity/index.js";
import {
  captureLedgerCheckpoint,
  createAccount,
  restoreLedgerCheckpoint,
  transfer,
  type LedgerWorld
} from "../ledger/index.js";
import type { PopulationWorld } from "../population/types.js";
import {
  createHeadquartersOperatingUnit,
  createOperatingUnit,
  unregisterOperatingUnit,
  type IndustryId,
  type MarketId,
  type OperatingUnitId,
  type OperatingUnitKind,
  type OperatingUnitWorld,
  type ProvinceId
} from "../operating-unit/index.js";
import type {
  CompanyAccountRefs,
  CompanyCapitalPolicyState,
  CompanyDividendPolicyState,
  CompanyFoundedEvent,
  CompanyId,
  CompanyState,
  CompanyWorld,
  CountryId,
  Tick
} from "./types.js";

export type {
  CompanyAccountRefs,
  CompanyCapitalPolicyState,
  CompanyDividendPolicyState,
  CompanyFoundedEvent,
  CompanyId,
  CompanyState,
  CompanyStatus,
  CompanyWorld,
  CountryId,
  Tick
} from "./types.js";
export { COMPANY_STATUSES } from "./types.js";
export {
  createEquityAccountResolver,
  createExternalShareholderAccounts,
  ensureExternalShareholderAccounts,
  shareholderAccountsKey,
  type ExternalShareholderAccounts,
  type ShareholderAccountPair
} from "./accounts.js";

const DEFAULT_DIVIDEND_POLICY: CompanyDividendPolicyState = {
  targetPayoutRate: 0,
  minimumCashReserveCents: 0
};

const DEFAULT_CAPITAL_POLICY: CompanyCapitalPolicyState = {
  minimumOwnershipForNewOperatingUnit: 0.5,
  maximumDebtToEquity: 2,
  headquartersFundingReserveCents: 0
};

export function createCompanyWorld(): CompanyWorld {
  return {
    companies: new Map(),
    companyIdByHeadquartersUnitId: new Map()
  };
}

function companyAccountId(companyId: CompanyId, suffix: string): string {
  return `company:${companyId}:${suffix}`;
}

export function createCompanyAccountRefs(
  ledger: LedgerWorld,
  companyId: CompanyId
): CompanyAccountRefs {
  return {
    cash: createAccount(ledger, companyAccountId(companyId, "cash")).id,
    receivables: createAccount(ledger, companyAccountId(companyId, "receivables")).id,
    payables: createAccount(ledger, companyAccountId(companyId, "payables"), 0, "equity").id,
    debt: createAccount(ledger, companyAccountId(companyId, "debt"), 0, "equity").id,
    investments: createAccount(ledger, companyAccountId(companyId, "investments")).id,
    contributedCapital: createAccount(
      ledger,
      companyAccountId(companyId, "contributedCapital"),
      0,
      "equity"
    ).id,
    retainedEarnings: createAccount(
      ledger,
      companyAccountId(companyId, "retainedEarnings"),
      0,
      "equity"
    ).id
  };
}

export interface CreateCompanyParams {
  readonly companyId: CompanyId;
  readonly legalName: string;
  readonly registrationCountryId: CountryId;
  readonly headquartersOperatingUnitId: OperatingUnitId;
  readonly headquartersProvinceId: ProvinceId;
  readonly headquartersIndustryId: IndustryId;
  readonly headquartersDefaultMarketId: MarketId;
  readonly foundedTick: Tick;
  readonly subscriber: ShareholderRef;
  readonly companyShares: number;
  readonly companySubscriptionPriceCents: number;
  readonly headquartersShares: number;
  /** Additional cash transfer company → HQ after HQ share subscription (may be 0). */
  readonly headquartersInitialFundingCents: number;
  /** Price the company pays to subscribe HQ shares (from company cash). */
  readonly headquartersSubscriptionPriceCents: number;
  readonly dividendPolicy?: CompanyDividendPolicyState;
  readonly capitalPolicy?: CompanyCapitalPolicyState;
}

export interface CreateCompanyResult {
  readonly company: CompanyState;
  readonly founded: CompanyFoundedEvent;
  readonly companySharesIssued: SharesIssuedEvent;
  readonly headquartersSharesIssued: SharesIssuedEvent;
}

export interface EconomicEntities {
  readonly ledger: LedgerWorld;
  readonly equity: EquityWorld;
  readonly operatingUnits: OperatingUnitWorld;
  readonly companies: CompanyWorld;
  readonly externalShareholders: ExternalShareholderAccounts;
  readonly population?: PopulationWorld;
}

function companyOwnsAllShares(
  equity: EquityWorld,
  issuer: ShareIssuerRef,
  companyId: CompanyId
): boolean {
  const state = getEquityState(equity, issuer);
  const position = getSharePosition(equity, issuer, { kind: "company", companyId });
  return (
    state !== undefined &&
    position !== undefined &&
    state.totalSharesOutstanding > 0 &&
    position.sharesOwned === state.totalSharesOutstanding
  );
}

function clearIssuerEquity(equity: EquityWorld, issuer: ShareIssuerRef): void {
  const key = issuerKey(issuer);
  equity.equityByIssuer.delete(key);
  const prefix = `${key}|`;
  for (const positionId of [...equity.positions.keys()]) {
    if (positionId.startsWith(prefix)) {
      equity.positions.delete(positionId);
    }
  }
}

function restoreExternalShareholderKeys(
  stores: ExternalShareholderAccounts,
  keysBefore: ReadonlySet<string>
): void {
  for (const key of [...stores.byKey.keys()]) {
    if (!keysBefore.has(key)) {
      stores.byKey.delete(key);
    }
  }
}

function assertHeadquartersInvariants(
  entities: EconomicEntities,
  company: CompanyState
): void {
  const hq = entities.operatingUnits.units.get(company.headquartersOperatingUnitId);
  if (hq === undefined) {
    throw new Error(`Company ${company.id} is missing headquarters unit.`);
  }
  if (hq.kind !== "headquarters") {
    throw new Error(`Headquarters unit ${hq.id} must have kind headquarters.`);
  }
  if (hq.operatingStatus === "closed" && company.status !== "closed") {
    throw new Error(`Active company ${company.id} cannot have a closed headquarters.`);
  }
  if (
    !companyOwnsAllShares(
      entities.equity,
      { kind: "operating_unit", operatingUnitId: hq.id },
      company.id
    )
  ) {
    throw new Error(`Company ${company.id} must own 100% of headquarters ${hq.id}.`);
  }

  for (const other of entities.companies.companies.values()) {
    if (other.id === company.id) {
      continue;
    }
    if (other.headquartersOperatingUnitId === company.headquartersOperatingUnitId) {
      throw new Error(`Headquarters ${company.headquartersOperatingUnitId} is already used.`);
    }
  }
}

/**
 * Atomically creates a Company, issues its shares, creates HQ Operating Unit,
 * and has the Company subscribe 100% of HQ shares.
 */
export function createCompany(
  entities: EconomicEntities,
  params: CreateCompanyParams
): CreateCompanyResult {
  if (entities.companies.companies.has(params.companyId)) {
    throw new Error(`Company already exists: ${params.companyId}.`);
  }
  if (params.companyId.trim().length === 0 || params.legalName.trim().length === 0) {
    throw new Error("Company id and legalName must be non-empty.");
  }
  if (!Number.isSafeInteger(params.companyShares) || params.companyShares <= 0) {
    throw new Error("companyShares must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(params.headquartersShares) || params.headquartersShares <= 0) {
    throw new Error("headquartersShares must be a positive safe integer.");
  }
  if (
    params.companySubscriptionPriceCents <
    params.headquartersSubscriptionPriceCents + params.headquartersInitialFundingCents
  ) {
    throw new Error(
      "companySubscriptionPriceCents must cover headquarters subscription and initial funding."
    );
  }
  if (entities.operatingUnits.units.has(params.headquartersOperatingUnitId)) {
    throw new Error(
      `Headquarters operating unit already exists: ${params.headquartersOperatingUnitId}.`
    );
  }
  if (entities.companies.companyIdByHeadquartersUnitId.has(params.headquartersOperatingUnitId)) {
    throw new Error(`Headquarters id already claimed: ${params.headquartersOperatingUnitId}.`);
  }

  if (params.subscriber.kind === "company") {
    if (!entities.companies.companies.has(params.subscriber.companyId)) {
      throw new Error(`Founding subscriber company does not exist: ${params.subscriber.companyId}.`);
    }
  } else {
    ensureExternalShareholderAccounts(
      entities.ledger,
      entities.externalShareholders,
      params.subscriber
    );
  }

  const ledgerCheckpoint = captureLedgerCheckpoint(entities.ledger);

  const accountRefs = createCompanyAccountRefs(entities.ledger, params.companyId);
  const company: CompanyState = {
    id: params.companyId,
    legalName: params.legalName,
    registrationCountryId: params.registrationCountryId,
    status: "active",
    headquartersOperatingUnitId: params.headquartersOperatingUnitId,
    foundedTick: params.foundedTick,
    closedTick: null,
    accountRefs,
    dividendPolicy: { ...(params.dividendPolicy ?? DEFAULT_DIVIDEND_POLICY) },
    capitalPolicy: { ...(params.capitalPolicy ?? DEFAULT_CAPITAL_POLICY) }
  };

  entities.companies.companies.set(company.id, company);

  const accounts = createEquityAccountResolver({
    companies: entities.companies,
    operatingUnits: entities.operatingUnits,
    external: entities.externalShareholders
  });

  let companySharesIssued: SharesIssuedEvent;
  let headquartersSharesIssued: SharesIssuedEvent;

  try {
    companySharesIssued = issueShares(entities.equity, entities.ledger, accounts, {
      kind: "issue-shares",
      commandId: `issue-company:${params.companyId}`,
      issuer: { kind: "company", companyId: params.companyId },
      subscriber: params.subscriber,
      sharesToIssue: params.companyShares,
      totalSubscriptionPriceCents: params.companySubscriptionPriceCents,
      tick: params.foundedTick
    });

    createHeadquartersOperatingUnit(entities.operatingUnits, entities.ledger, entities.population, {
      id: params.headquartersOperatingUnitId,
      provinceId: params.headquartersProvinceId,
      industryId: params.headquartersIndustryId,
      defaultMarketId: params.headquartersDefaultMarketId,
      foundedTick: params.foundedTick,
      operatingStatus: "active"
    });

    headquartersSharesIssued = issueShares(entities.equity, entities.ledger, accounts, {
      kind: "issue-shares",
      commandId: `issue-hq:${params.headquartersOperatingUnitId}`,
      issuer: {
        kind: "operating_unit",
        operatingUnitId: params.headquartersOperatingUnitId
      },
      subscriber: { kind: "company", companyId: params.companyId },
      sharesToIssue: params.headquartersShares,
      totalSubscriptionPriceCents: params.headquartersSubscriptionPriceCents,
      tick: params.foundedTick
    });

    if (params.headquartersInitialFundingCents > 0) {
      transfer(
        entities.ledger,
        company.accountRefs.cash,
        entities.operatingUnits.units.get(params.headquartersOperatingUnitId)!.accountRefs.cash,
        params.headquartersInitialFundingCents
      );
    }

    assertHeadquartersInvariants(entities, company);
    entities.companies.companyIdByHeadquartersUnitId.set(
      params.headquartersOperatingUnitId,
      params.companyId
    );
  } catch (error) {
    clearIssuerEquity(entities.equity, {
      kind: "operating_unit",
      operatingUnitId: params.headquartersOperatingUnitId
    });
    clearIssuerEquity(entities.equity, { kind: "company", companyId: params.companyId });
    unregisterOperatingUnit(
      entities.operatingUnits,
      entities.population,
      params.headquartersOperatingUnitId
    );
    entities.companies.companies.delete(params.companyId);
    entities.companies.companyIdByHeadquartersUnitId.delete(params.headquartersOperatingUnitId);
    restoreLedgerCheckpoint(entities.ledger, ledgerCheckpoint);
    throw error;
  }

  return {
    company,
    founded: {
      kind: "company-founded",
      companyId: params.companyId,
      headquartersOperatingUnitId: params.headquartersOperatingUnitId,
      tick: params.foundedTick
    },
    companySharesIssued,
    headquartersSharesIssued
  };
}

export interface CreateOperatingUnitForCompanyParams {
  readonly operatingUnitId: OperatingUnitId;
  readonly kind: OperatingUnitKind;
  readonly provinceId: ProvinceId;
  readonly industryId: IndustryId;
  readonly defaultMarketId: MarketId;
  readonly foundedTick: Tick;
  readonly controllingCompanyId: CompanyId;
  readonly unitShares: number;
  readonly subscriptionPriceCents: number;
  readonly additionalSubscribers?: readonly {
    readonly shareholder: ShareholderRef;
    readonly shares: number;
    readonly subscriptionPriceCents: number;
  }[];
}

export interface CreateOperatingUnitForCompanyResult {
  readonly operatingUnitId: OperatingUnitId;
  readonly shareEvents: readonly SharesIssuedEvent[];
}

/**
 * Company founds an Operating Unit and must end above 50% ownership when capital policy requires control.
 */
export function createOperatingUnitForCompany(
  entities: EconomicEntities,
  params: CreateOperatingUnitForCompanyParams
): CreateOperatingUnitForCompanyResult {
  const company = entities.companies.companies.get(params.controllingCompanyId);
  if (company === undefined) {
    throw new Error(`Unknown company: ${params.controllingCompanyId}.`);
  }
  if (company.status === "closed") {
    throw new Error(`Closed company cannot found operating units: ${company.id}.`);
  }
  if (params.kind === "headquarters") {
    throw new Error("Use createCompany to establish a headquarters.");
  }
  if (entities.operatingUnits.units.has(params.operatingUnitId)) {
    throw new Error(`Operating unit already exists: ${params.operatingUnitId}.`);
  }

  const ledgerCheckpoint = captureLedgerCheckpoint(entities.ledger);
  const externalKeysBefore = new Set(entities.externalShareholders.byKey.keys());
  const accounts = createEquityAccountResolver({
    companies: entities.companies,
    operatingUnits: entities.operatingUnits,
    external: entities.externalShareholders
  });

  const shareEvents: SharesIssuedEvent[] = [];
  try {
    createOperatingUnit(entities.operatingUnits, entities.ledger, entities.population, {
      id: params.operatingUnitId,
      kind: params.kind,
      provinceId: params.provinceId,
      industryId: params.industryId,
      defaultMarketId: params.defaultMarketId,
      foundedTick: params.foundedTick,
      operatingStatus: "active"
    });

    shareEvents.push(
      issueShares(entities.equity, entities.ledger, accounts, {
        kind: "issue-shares",
        commandId: `issue-ou:${params.operatingUnitId}:controller`,
        issuer: { kind: "operating_unit", operatingUnitId: params.operatingUnitId },
        subscriber: { kind: "company", companyId: params.controllingCompanyId },
        sharesToIssue: params.unitShares,
        totalSubscriptionPriceCents: params.subscriptionPriceCents,
        tick: params.foundedTick
      })
    );

    for (const [index, extra] of (params.additionalSubscribers ?? []).entries()) {
      if (extra.shareholder.kind !== "company") {
        ensureExternalShareholderAccounts(
          entities.ledger,
          entities.externalShareholders,
          extra.shareholder
        );
      }
      shareEvents.push(
        issueShares(entities.equity, entities.ledger, accounts, {
          kind: "issue-shares",
          commandId: `issue-ou:${params.operatingUnitId}:extra:${index}`,
          issuer: { kind: "operating_unit", operatingUnitId: params.operatingUnitId },
          subscriber: extra.shareholder,
          sharesToIssue: extra.shares,
          totalSubscriptionPriceCents: extra.subscriptionPriceCents,
          tick: params.foundedTick
        })
      );
    }

    const ownership = ownershipShare(
      entities.equity,
      { kind: "operating_unit", operatingUnitId: params.operatingUnitId },
      { kind: "company", companyId: params.controllingCompanyId }
    );
    if (ownership <= company.capitalPolicy.minimumOwnershipForNewOperatingUnit) {
      throw new Error(
        `Company ${company.id} ownership ${ownership} of unit ${params.operatingUnitId} is not above required minimum ${company.capitalPolicy.minimumOwnershipForNewOperatingUnit}.`
      );
    }
  } catch (error) {
    clearIssuerEquity(entities.equity, {
      kind: "operating_unit",
      operatingUnitId: params.operatingUnitId
    });
    unregisterOperatingUnit(
      entities.operatingUnits,
      entities.population,
      params.operatingUnitId
    );
    restoreLedgerCheckpoint(entities.ledger, ledgerCheckpoint);
    restoreExternalShareholderKeys(entities.externalShareholders, externalKeysBefore);
    throw error;
  }

  return { operatingUnitId: params.operatingUnitId, shareEvents };
}

export function getCompany(world: CompanyWorld, id: CompanyId): CompanyState | undefined {
  return world.companies.get(id);
}

export function getCompanyByHeadquarters(
  world: CompanyWorld,
  headquartersOperatingUnitId: OperatingUnitId
): CompanyState | undefined {
  const companyId = world.companyIdByHeadquartersUnitId.get(headquartersOperatingUnitId);
  if (companyId === undefined) {
    return undefined;
  }
  return world.companies.get(companyId);
}

export function rebuildCompanyHeadquartersIndex(world: CompanyWorld): void {
  world.companyIdByHeadquartersUnitId.clear();
  for (const company of world.companies.values()) {
    world.companyIdByHeadquartersUnitId.set(company.headquartersOperatingUnitId, company.id);
  }
}
