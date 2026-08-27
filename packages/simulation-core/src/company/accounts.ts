import {
  createAccount,
  type LedgerWorld
} from "../ledger/index.js";
import type {
  EquityAccountResolver,
  ShareIssuerRef,
  ShareholderRef
} from "../equity/types.js";
import type { CompanyWorld } from "./types.js";
import type { OperatingUnitWorld } from "../operating-unit/types.js";

export interface ShareholderAccountPair {
  readonly cash: string;
  readonly investments: string;
}

export interface ExternalShareholderAccounts {
  readonly byKey: Map<string, ShareholderAccountPair>;
}

export function createExternalShareholderAccounts(): ExternalShareholderAccounts {
  return { byKey: new Map() };
}

export function shareholderAccountsKey(shareholder: ShareholderRef): string {
  if (shareholder.kind === "population_class") {
    return `population_class:${shareholder.provinceId}:${shareholder.socialClassId}`;
  }
  if (shareholder.kind === "government") {
    return `government:${shareholder.countryId}`;
  }
  return `company:${shareholder.companyId}`;
}

export function ensureExternalShareholderAccounts(
  ledger: LedgerWorld,
  stores: ExternalShareholderAccounts,
  shareholder: ShareholderRef,
  openingCashCents = 0
): ShareholderAccountPair {
  if (shareholder.kind === "company") {
    throw new Error("Company shareholder accounts come from CompanyState, not external stores.");
  }
  const key = shareholderAccountsKey(shareholder);
  const existing = stores.byKey.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const pair: ShareholderAccountPair = {
    cash: createAccount(ledger, `shareholder:${key}:cash`, openingCashCents).id,
    investments: createAccount(ledger, `shareholder:${key}:investments`).id
  };
  stores.byKey.set(key, pair);
  return pair;
}

export function createEquityAccountResolver(deps: {
  readonly companies: CompanyWorld;
  readonly operatingUnits: OperatingUnitWorld;
  readonly external: ExternalShareholderAccounts;
}): EquityAccountResolver {
  return {
    getCashAccount(shareholder: ShareholderRef) {
      if (shareholder.kind === "company") {
        const company = deps.companies.companies.get(shareholder.companyId);
        if (company === undefined) {
          throw new Error(`Unknown company shareholder: ${shareholder.companyId}.`);
        }
        return company.accountRefs.cash;
      }
      const pair = deps.external.byKey.get(shareholderAccountsKey(shareholder));
      if (pair === undefined) {
        throw new Error(`Missing external shareholder cash account for ${shareholderAccountsKey(shareholder)}.`);
      }
      return pair.cash;
    },
    getInvestmentAccount(shareholder: ShareholderRef) {
      if (shareholder.kind === "company") {
        const company = deps.companies.companies.get(shareholder.companyId);
        if (company === undefined) {
          throw new Error(`Unknown company shareholder: ${shareholder.companyId}.`);
        }
        return company.accountRefs.investments;
      }
      const pair = deps.external.byKey.get(shareholderAccountsKey(shareholder));
      if (pair === undefined) {
        throw new Error(
          `Missing external shareholder investment account for ${shareholderAccountsKey(shareholder)}.`
        );
      }
      return pair.investments;
    },
    getIssuerCashAccount(issuer: ShareIssuerRef) {
      if (issuer.kind === "company") {
        const company = deps.companies.companies.get(issuer.companyId);
        if (company === undefined) {
          throw new Error(`Unknown company issuer: ${issuer.companyId}.`);
        }
        return company.accountRefs.cash;
      }
      const unit = deps.operatingUnits.units.get(issuer.operatingUnitId);
      if (unit === undefined) {
        throw new Error(`Unknown operating unit issuer: ${issuer.operatingUnitId}.`);
      }
      return unit.accountRefs.cash;
    },
    getIssuerContributedCapitalAccount(issuer: ShareIssuerRef) {
      if (issuer.kind === "company") {
        const company = deps.companies.companies.get(issuer.companyId);
        if (company === undefined) {
          throw new Error(`Unknown company issuer: ${issuer.companyId}.`);
        }
        return company.accountRefs.contributedCapital;
      }
      const unit = deps.operatingUnits.units.get(issuer.operatingUnitId);
      if (unit === undefined) {
        throw new Error(`Unknown operating unit issuer: ${issuer.operatingUnitId}.`);
      }
      return unit.accountRefs.contributedCapital;
    }
  };
}
