import { describe, expect, it } from "vitest";
import {
  bootstrapGameWorld,
  createCompany,
  createOperatingUnitForCompany,
  credit,
  ensureExternalShareholderAccounts,
  getBalance,
  getCompany,
  getEquityState,
  getMajorityShareholder,
  getOperatingComponent,
  getSharePosition,
  issueShares,
  type EconomicEntities,
  type ScenarioBootstrap
} from "../src/index.js";
import { createEquityAccountResolver } from "../src/company/index.js";

function seedWorld(): EconomicEntities & { mapId: string } {
  const scenario: ScenarioBootstrap = {
    mapId: "test",
    provinces: [
      { id: "p1", ownerCountryId: "C1" },
      { id: "p2", ownerCountryId: "C1" }
    ]
  };
  const world = bootstrapGameWorld(scenario);
  return {
    mapId: world.mapId,
    ledger: world.ledger,
    equity: world.equity,
    operatingUnits: world.operatingUnits,
    companies: world.companies,
    externalShareholders: world.externalShareholders,
    population: world.population
  };
}

function fundFounder(entities: EconomicEntities, cashCents: number) {
  const subscriber = {
    kind: "population_class" as const,
    provinceId: "p1",
    socialClassId: "capitalist"
  };
  const accounts = ensureExternalShareholderAccounts(
    entities.ledger,
    entities.externalShareholders,
    subscriber,
    0
  );
  credit(entities.ledger, accounts.cash, cashCents);
  return subscriber;
}

describe("company", () => {
  it("atomically creates company with HQ, 100% HQ ownership, and employer", () => {
    const entities = seedWorld();
    const subscriber = fundFounder(entities, 100_000);

    const result = createCompany(entities, {
      companyId: "alpha",
      legalName: "Alpha Holdings",
      registrationCountryId: "C1",
      headquartersOperatingUnitId: "hq-alpha",
      headquartersProvinceId: "p1",
      headquartersIndustryId: "admin",
      headquartersDefaultMarketId: "m1",
      foundedTick: 0,
      subscriber,
      companyShares: 1000,
      companySubscriptionPriceCents: 50_000,
      headquartersShares: 100,
      headquartersSubscriptionPriceCents: 10_000,
      headquartersInitialFundingCents: 5_000
    });

    expect(result.company.status).toBe("active");
    expect(getCompany(entities.companies, "alpha")?.headquartersOperatingUnitId).toBe("hq-alpha");

    const hq = entities.operatingUnits.units.get("hq-alpha")!;
    expect(hq.kind).toBe("headquarters");
    expect(getOperatingComponent(entities.operatingUnits, "hq-alpha")?.kind).toBe(
      "headquarters_site"
    );

    const hqEquity = getEquityState(entities.equity, {
      kind: "operating_unit",
      operatingUnitId: "hq-alpha"
    })!;
    const hqPosition = getSharePosition(
      entities.equity,
      { kind: "operating_unit", operatingUnitId: "hq-alpha" },
      { kind: "company", companyId: "alpha" }
    )!;
    expect(hqPosition.sharesOwned).toBe(hqEquity.totalSharesOutstanding);
    expect(getMajorityShareholder(entities.equity, { kind: "company", companyId: "alpha" })).toEqual(
      subscriber
    );

    expect(entities.population!.employers.has("hq-alpha")).toBe(true);
    expect(entities.population!.employerProvinces.get("hq-alpha")).toBe("p1");

    expect(getBalance(entities.ledger, result.company.accountRefs.cash)).toBe(35_000);
    expect(getBalance(entities.ledger, hq.accountRefs.cash)).toBe(15_000);
  });

  it("rejects founding without covering HQ funding from company subscription cash", () => {
    const entities = seedWorld();
    const subscriber = fundFounder(entities, 100_000);
    expect(() =>
      createCompany(entities, {
        companyId: "alpha",
        legalName: "Alpha",
        registrationCountryId: "C1",
        headquartersOperatingUnitId: "hq-alpha",
        headquartersProvinceId: "p1",
        headquartersIndustryId: "admin",
        headquartersDefaultMarketId: "m1",
        foundedTick: 0,
        subscriber,
        companyShares: 100,
        companySubscriptionPriceCents: 1000,
        headquartersShares: 10,
        headquartersSubscriptionPriceCents: 800,
        headquartersInitialFundingCents: 500
      })
    ).toThrow(/must cover headquarters/);
    expect(entities.companies.companies.has("alpha")).toBe(false);
  });

  it("lets a company found factory/store/road units under control", () => {
    const entities = seedWorld();
    const subscriber = fundFounder(entities, 200_000);
    createCompany(entities, {
      companyId: "alpha",
      legalName: "Alpha",
      registrationCountryId: "C1",
      headquartersOperatingUnitId: "hq-alpha",
      headquartersProvinceId: "p1",
      headquartersIndustryId: "admin",
      headquartersDefaultMarketId: "m1",
      foundedTick: 0,
      subscriber,
      companyShares: 1000,
      companySubscriptionPriceCents: 100_000,
      headquartersShares: 100,
      headquartersSubscriptionPriceCents: 1_000,
      headquartersInitialFundingCents: 0
    });

    createOperatingUnitForCompany(entities, {
      operatingUnitId: "factory-1",
      kind: "factory",
      provinceId: "p1",
      industryId: "goods",
      defaultMarketId: "m1",
      foundedTick: 1,
      controllingCompanyId: "alpha",
      unitShares: 100,
      subscriptionPriceCents: 20_000
    });
    createOperatingUnitForCompany(entities, {
      operatingUnitId: "store-1",
      kind: "store",
      provinceId: "p1",
      industryId: "retail",
      defaultMarketId: "m1",
      foundedTick: 1,
      controllingCompanyId: "alpha",
      unitShares: 80,
      subscriptionPriceCents: 10_000,
      additionalSubscribers: [
        {
          shareholder: subscriber,
          shares: 20,
          subscriptionPriceCents: 2_500
        }
      ]
    });
    createOperatingUnitForCompany(entities, {
      operatingUnitId: "road-1",
      kind: "road",
      provinceId: "p2",
      industryId: "transport",
      defaultMarketId: "m1",
      foundedTick: 1,
      controllingCompanyId: "alpha",
      unitShares: 100,
      subscriptionPriceCents: 5_000
    });

    expect(entities.operatingUnits.units.get("factory-1")?.kind).toBe("factory");
    expect(entities.operatingUnits.units.get("store-1")?.kind).toBe("store");
    expect(entities.operatingUnits.units.get("road-1")?.provinceId).toBe("p2");
    expect(entities.population!.employers.has("factory-1")).toBe(true);
    expect(
      getMajorityShareholder(entities.equity, {
        kind: "operating_unit",
        operatingUnitId: "store-1"
      })
    ).toEqual({ kind: "company", companyId: "alpha" });
  });

  it("rejects company ownership cycles when issuing company shares to another company", () => {
    const entities = seedWorld();
    const founder = fundFounder(entities, 300_000);

    createCompany(entities, {
      companyId: "alpha",
      legalName: "Alpha",
      registrationCountryId: "C1",
      headquartersOperatingUnitId: "hq-alpha",
      headquartersProvinceId: "p1",
      headquartersIndustryId: "admin",
      headquartersDefaultMarketId: "m1",
      foundedTick: 0,
      subscriber: founder,
      companyShares: 100,
      companySubscriptionPriceCents: 50_000,
      headquartersShares: 10,
      headquartersSubscriptionPriceCents: 1_000,
      headquartersInitialFundingCents: 0
    });

    createCompany(entities, {
      companyId: "beta",
      legalName: "Beta",
      registrationCountryId: "C1",
      headquartersOperatingUnitId: "hq-beta",
      headquartersProvinceId: "p1",
      headquartersIndustryId: "admin",
      headquartersDefaultMarketId: "m1",
      foundedTick: 0,
      subscriber: { kind: "company", companyId: "alpha" },
      companyShares: 100,
      companySubscriptionPriceCents: 10_000,
      headquartersShares: 10,
      headquartersSubscriptionPriceCents: 1_000,
      headquartersInitialFundingCents: 0
    });

    const accounts = createEquityAccountResolver({
      companies: entities.companies,
      operatingUnits: entities.operatingUnits,
      external: entities.externalShareholders
    });

    expect(() =>
      issueShares(entities.equity, entities.ledger, accounts, {
        kind: "issue-shares",
        commandId: "cycle",
        issuer: { kind: "company", companyId: "alpha" },
        subscriber: { kind: "company", companyId: "beta" },
        sharesToIssue: 1,
        totalSubscriptionPriceCents: 0,
        tick: 2
      })
    ).toThrow(/cycle|self-hold/);
  });

  it("rolls back ledger on createCompany failure so the same ids can retry", () => {
    const entities = seedWorld();
    const subscriber = fundFounder(entities, 1_000);
    const founderCash = ensureExternalShareholderAccounts(
      entities.ledger,
      entities.externalShareholders,
      subscriber
    ).cash;
    const accountIdsBefore = new Set(entities.ledger.accounts.keys());

    expect(() =>
      createCompany(entities, {
        companyId: "alpha",
        legalName: "Alpha",
        registrationCountryId: "C1",
        headquartersOperatingUnitId: "hq-alpha",
        headquartersProvinceId: "p1",
        headquartersIndustryId: "admin",
        headquartersDefaultMarketId: "m1",
        foundedTick: 0,
        subscriber,
        companyShares: 100,
        companySubscriptionPriceCents: 50_000,
        headquartersShares: 10,
        headquartersSubscriptionPriceCents: 1_000,
        headquartersInitialFundingCents: 0
      })
    ).toThrow(/Insufficient funds/);

    expect(entities.companies.companies.has("alpha")).toBe(false);
    expect(entities.operatingUnits.units.has("hq-alpha")).toBe(false);
    expect(getBalance(entities.ledger, founderCash)).toBe(1_000);
    expect([...entities.ledger.accounts.keys()].sort()).toEqual([...accountIdsBefore].sort());
    expect(
      getEquityState(entities.equity, { kind: "company", companyId: "alpha" })
    ).toBeUndefined();

    credit(entities.ledger, founderCash, 99_000);
    const retry = createCompany(entities, {
      companyId: "alpha",
      legalName: "Alpha",
      registrationCountryId: "C1",
      headquartersOperatingUnitId: "hq-alpha",
      headquartersProvinceId: "p1",
      headquartersIndustryId: "admin",
      headquartersDefaultMarketId: "m1",
      foundedTick: 0,
      subscriber,
      companyShares: 100,
      companySubscriptionPriceCents: 50_000,
      headquartersShares: 10,
      headquartersSubscriptionPriceCents: 1_000,
      headquartersInitialFundingCents: 0
    });
    expect(retry.company.id).toBe("alpha");
    expect(entities.operatingUnits.units.get("hq-alpha")?.kind).toBe("headquarters");
  });

  it("rolls back ledger on createOperatingUnitForCompany ownership failure", () => {
    const entities = seedWorld();
    const subscriber = fundFounder(entities, 200_000);
    const company = createCompany(entities, {
      companyId: "alpha",
      legalName: "Alpha",
      registrationCountryId: "C1",
      headquartersOperatingUnitId: "hq-alpha",
      headquartersProvinceId: "p1",
      headquartersIndustryId: "admin",
      headquartersDefaultMarketId: "m1",
      foundedTick: 0,
      subscriber,
      companyShares: 1000,
      companySubscriptionPriceCents: 100_000,
      headquartersShares: 100,
      headquartersSubscriptionPriceCents: 1_000,
      headquartersInitialFundingCents: 0
    }).company;

    const companyCashBefore = getBalance(entities.ledger, company.accountRefs.cash);
    const accountIdsBefore = new Set(entities.ledger.accounts.keys());

    expect(() =>
      createOperatingUnitForCompany(entities, {
        operatingUnitId: "factory-1",
        kind: "factory",
        provinceId: "p1",
        industryId: "goods",
        defaultMarketId: "m1",
        foundedTick: 1,
        controllingCompanyId: "alpha",
        unitShares: 40,
        subscriptionPriceCents: 4_000,
        additionalSubscribers: [
          {
            shareholder: subscriber,
            shares: 60,
            subscriptionPriceCents: 6_000
          }
        ]
      })
    ).toThrow(/not above required minimum/);

    expect(entities.operatingUnits.units.has("factory-1")).toBe(false);
    expect(getBalance(entities.ledger, company.accountRefs.cash)).toBe(companyCashBefore);
    expect([...entities.ledger.accounts.keys()].sort()).toEqual([...accountIdsBefore].sort());
    expect(
      getEquityState(entities.equity, {
        kind: "operating_unit",
        operatingUnitId: "factory-1"
      })
    ).toBeUndefined();

    createOperatingUnitForCompany(entities, {
      operatingUnitId: "factory-1",
      kind: "factory",
      provinceId: "p1",
      industryId: "goods",
      defaultMarketId: "m1",
      foundedTick: 1,
      controllingCompanyId: "alpha",
      unitShares: 80,
      subscriptionPriceCents: 8_000,
      additionalSubscribers: [
        {
          shareholder: subscriber,
          shares: 20,
          subscriptionPriceCents: 2_000
        }
      ]
    });
    expect(entities.operatingUnits.units.get("factory-1")?.kind).toBe("factory");
  });

  it("rolls back new external shareholder keys when ownership fails", () => {
    const entities = seedWorld();
    const subscriber = fundFounder(entities, 200_000);
    createCompany(entities, {
      companyId: "alpha",
      legalName: "Alpha",
      registrationCountryId: "C1",
      headquartersOperatingUnitId: "hq-alpha",
      headquartersProvinceId: "p1",
      headquartersIndustryId: "admin",
      headquartersDefaultMarketId: "m1",
      foundedTick: 0,
      subscriber,
      companyShares: 1000,
      companySubscriptionPriceCents: 100_000,
      headquartersShares: 100,
      headquartersSubscriptionPriceCents: 1_000,
      headquartersInitialFundingCents: 0
    });

    const newMinority = { kind: "government" as const, countryId: "C1" };
    const externalKeysBefore = new Set(entities.externalShareholders.byKey.keys());
    const accountIdsBefore = new Set(entities.ledger.accounts.keys());
    expect(entities.externalShareholders.byKey.has("government:C1")).toBe(false);

    expect(() =>
      createOperatingUnitForCompany(entities, {
        operatingUnitId: "factory-2",
        kind: "factory",
        provinceId: "p1",
        industryId: "goods",
        defaultMarketId: "m1",
        foundedTick: 1,
        controllingCompanyId: "alpha",
        unitShares: 40,
        subscriptionPriceCents: 4_000,
        additionalSubscribers: [
          {
            shareholder: newMinority,
            shares: 60,
            subscriptionPriceCents: 0
          }
        ]
      })
    ).toThrow(/not above required minimum/);

    expect(entities.operatingUnits.units.has("factory-2")).toBe(false);
    expect([...entities.externalShareholders.byKey.keys()].sort()).toEqual(
      [...externalKeysBefore].sort()
    );
    expect([...entities.ledger.accounts.keys()].sort()).toEqual([...accountIdsBefore].sort());
    expect(entities.externalShareholders.byKey.has("government:C1")).toBe(false);
  });
});
