import { describe, expect, it } from "vitest";
import {
  createCompanyWorld,
  createEquityAccountResolver,
  createExternalShareholderAccounts,
  ensureExternalShareholderAccounts
} from "../src/company/index.js";
import {
  createEquityWorld,
  getMajorityShareholder,
  getShareholders,
  issueShares,
  wouldCreateCompanyOwnershipCycle
} from "../src/equity/index.js";
import { createAccount, createLedgerWorld, credit, getBalance } from "../src/ledger/index.js";
import { createOperatingUnitWorld } from "../src/operating-unit/index.js";

function setupResolver() {
  const ledger = createLedgerWorld();
  const equity = createEquityWorld();
  const companies = createCompanyWorld();
  const operatingUnits = createOperatingUnitWorld();
  const external = createExternalShareholderAccounts();
  const accounts = createEquityAccountResolver({ companies, operatingUnits, external });
  return { ledger, equity, companies, operatingUnits, external, accounts };
}

describe("equity", () => {
  it("issues shares and moves cash into issuer cash and capital", () => {
    const { ledger, equity, companies, operatingUnits, external, accounts } = setupResolver();

    createAccount(ledger, "company:alpha:cash");
    createAccount(ledger, "company:alpha:investments");
    createAccount(ledger, "company:alpha:contributedCapital", 0, "equity");
    companies.companies.set("alpha", {
      id: "alpha",
      legalName: "Alpha",
      registrationCountryId: "C",
      status: "active",
      headquartersOperatingUnitId: "hq",
      foundedTick: 0,
      closedTick: null,
      accountRefs: {
        cash: "company:alpha:cash",
        receivables: "company:alpha:receivables",
        payables: "company:alpha:payables",
        debt: "company:alpha:debt",
        investments: "company:alpha:investments",
        contributedCapital: "company:alpha:contributedCapital",
        retainedEarnings: "company:alpha:retainedEarnings"
      },
      dividendPolicy: { targetPayoutRate: 0, minimumCashReserveCents: 0 },
      capitalPolicy: {
        minimumOwnershipForNewOperatingUnit: 0.5,
        maximumDebtToEquity: 2,
        headquartersFundingReserveCents: 0
      }
    });
    // Stub remaining company accounts referenced only by resolver for issuer.
    createAccount(ledger, "company:alpha:receivables");
    createAccount(ledger, "company:alpha:payables", 0, "equity");
    createAccount(ledger, "company:alpha:debt", 0, "equity");
    createAccount(ledger, "company:alpha:retainedEarnings", 0, "equity");

    const subscriber = {
      kind: "population_class" as const,
      provinceId: "p1",
      socialClassId: "capitalist"
    };
    ensureExternalShareholderAccounts(ledger, external, subscriber, 0);
    credit(ledger, accounts.getCashAccount(subscriber), 10_000);

    issueShares(equity, ledger, accounts, {
      kind: "issue-shares",
      commandId: "c1",
      issuer: { kind: "company", companyId: "alpha" },
      subscriber,
      sharesToIssue: 100,
      totalSubscriptionPriceCents: 10_000,
      tick: 1
    });

    expect(getBalance(ledger, accounts.getCashAccount(subscriber))).toBe(0);
    expect(getBalance(ledger, "company:alpha:cash")).toBe(10_000);
    expect(getBalance(ledger, "company:alpha:contributedCapital")).toBe(10_000);
    expect(getShareholders(equity, { kind: "company", companyId: "alpha" })).toHaveLength(1);
    expect(getMajorityShareholder(equity, { kind: "company", companyId: "alpha" })).toEqual(
      subscriber
    );
  });

  it("rejects company self-hold and ownership cycles", () => {
    const { equity } = setupResolver();
    expect(
      wouldCreateCompanyOwnershipCycle(
        equity,
        { kind: "company", companyId: "a" },
        { kind: "company", companyId: "a" }
      )
    ).toBe(true);

    // Seed A owns B
    equity.equityByIssuer.set("company:b", {
      issuer: { kind: "company", companyId: "b" },
      totalSharesOutstanding: 10
    });
    equity.positions.set("company:b|company:a", {
      issuer: { kind: "company", companyId: "b" },
      shareholder: { kind: "company", companyId: "a" },
      sharesOwned: 10,
      lastChangedTick: 0
    });

    expect(
      wouldCreateCompanyOwnershipCycle(
        equity,
        { kind: "company", companyId: "a" },
        { kind: "company", companyId: "b" }
      )
    ).toBe(true);
  });
});
