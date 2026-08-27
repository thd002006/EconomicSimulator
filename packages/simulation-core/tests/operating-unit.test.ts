import { describe, expect, it } from "vitest";
import { createLedgerWorld } from "../src/ledger/index.js";
import {
  createHeadquartersOperatingUnit,
  createOperatingUnit,
  createOperatingUnitWorld,
  getOperatingComponent,
  getOperatingUnitKindDefinition,
  listOperatingUnitsByKind,
  transitionOperatingUnitStatus
} from "../src/operating-unit/index.js";
import { createPopulationWorld, validatePopulationStaticData } from "../src/population/index.js";
import { makePopulationStaticData } from "./population-static-data.js";

describe("operating unit", () => {
  it("creates factory, store, and road with matching components", () => {
    const world = createOperatingUnitWorld();
    const ledger = createLedgerWorld();
    const kinds = ["factory", "store", "road"] as const;

    for (const [index, kind] of kinds.entries()) {
      const id = `u${index}`;
      createOperatingUnit(world, ledger, undefined, {
        id,
        kind,
        provinceId: "p1",
        industryId: "ind",
        defaultMarketId: "m1",
        foundedTick: 0,
        registerEmployer: false
      });
      const component = getOperatingComponent(world, id)!;
      expect(component.kind).toBe(getOperatingUnitKindDefinition(kind).requiredComponentKind);
      expect(component.operatingUnitId).toBe(id);
    }

    expect(listOperatingUnitsByKind(world, "factory")).toHaveLength(1);
    expect(listOperatingUnitsByKind(world, "road")).toHaveLength(1);
  });

  it("rejects public headquarters creation", () => {
    const world = createOperatingUnitWorld();
    const ledger = createLedgerWorld();
    expect(() =>
      createOperatingUnit(world, ledger, undefined, {
        id: "hq",
        kind: "headquarters",
        provinceId: "p1",
        industryId: "ind",
        defaultMarketId: "m1",
        foundedTick: 0,
        registerEmployer: false
      })
    ).toThrow(/createCompany/);
  });

  it("rejects non-creatable kinds and registers employers", () => {
    const world = createOperatingUnitWorld();
    const ledger = createLedgerWorld();
    expect(() =>
      createOperatingUnit(world, ledger, undefined, {
        id: "farm1",
        kind: "farm",
        provinceId: "p1",
        industryId: "ind",
        defaultMarketId: "m1",
        foundedTick: 0,
        registerEmployer: false
      })
    ).toThrow(/not creatable/);

    const population = createPopulationWorld(
      ["p1"],
      validatePopulationStaticData(makePopulationStaticData())
    );
    createOperatingUnit(world, ledger, population, {
      id: "factory1",
      kind: "factory",
      provinceId: "p1",
      industryId: "ind",
      defaultMarketId: "m1",
      foundedTick: 0
    });
    expect(population.employers.has("factory1")).toBe(true);
    expect(population.employerProvinces.get("factory1")).toBe("p1");
  });

  it("blocks closing headquarters via ordinary status transition", () => {
    const world = createOperatingUnitWorld();
    const ledger = createLedgerWorld();
    createHeadquartersOperatingUnit(world, ledger, undefined, {
      id: "hq",
      provinceId: "p1",
      industryId: "ind",
      defaultMarketId: "m1",
      foundedTick: 0,
      registerEmployer: false
    });
    expect(() => transitionOperatingUnitStatus(world, undefined, "hq", "closed", 1)).toThrow(
      /Headquarters cannot be closed/
    );
  });
});
