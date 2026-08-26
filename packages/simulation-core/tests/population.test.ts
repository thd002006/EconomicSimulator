import { describe, expect, it } from "vitest";
import {
  applyClassIncomeEvent,
  applyExogenousMigrationCommand,
  createPopulationWorld,
  getPopulationInvariantReport,
  getProvinceLaborMarket,
  getProvincePopulationSummary,
  removeEmployer,
  runClassTransitions,
  runMonthlyPopulationStep,
  runVitalEvents,
  setEmployer,
  upsertJobDemand
} from "../src/population/index";
import { makePopulationStaticData } from "./population-static-data";
import type { PopulationWorld } from "../src/population/types";

function makeEmployer(
  id: string,
  demands: Array<{ jobTypeId: string; desiredFte: number; wageCents: number }>
) {
  return {
    id,
    jobDemands: demands.map((demand) => ({
      jobTypeId: demand.jobTypeId,
      arrangement: "permanent" as const,
      desiredFte: demand.desiredFte,
      offeredMonthlyWageCentsPerFte: demand.wageCents
    }))
  };
}

describe("population system", () => {
  it("seeds the reference scenario and keeps invariants over 1,200 months", () => {
    const world = createPopulationWorld(["p1"], makePopulationStaticData(), {
      p1: {
        farmer: 20_000,
        worker: 60_000,
        skilled_worker: 15_000,
        office_worker: 8_000,
        professional: 5_000,
        managerial: 2_000
      }
    });
    setEmployer(
      world,
      "p1",
      makeEmployer("farm_coop", [
        { jobTypeId: "farm_worker", desiredFte: 15_000, wageCents: 160_000 }
      ])
    );
    setEmployer(
      world,
      "p1",
      makeEmployer("basic_factory", [
        { jobTypeId: "production_operator", desiredFte: 45_000, wageCents: 200_000 }
      ])
    );
    setEmployer(
      world,
      "p1",
      makeEmployer("advanced_factory", [
        { jobTypeId: "technician", desiredFte: 12_000, wageCents: 260_000 },
        { jobTypeId: "engineer", desiredFte: 4_000, wageCents: 320_000 }
      ])
    );

    const initialPopulation = getProvincePopulationSummary(world, "p1").populationPersons;

    for (let month = 0; month < 1200; month += 1) {
      runMonthlyPopulationStep(world);
    }

    const report = getPopulationInvariantReport(world);
    expect(report.violations).toEqual([]);
    expect(report.valid).toBe(true);

    const summary = getProvincePopulationSummary(world, "p1");
    expect(Number.isFinite(summary.populationPersons)).toBe(true);
    expect(summary.populationPersons).toBeGreaterThan(0);
    expect(initialPopulation).toBeGreaterThan(0);
  });

  it("runs identically after a snapshot round trip", () => {
    const buildWorld = (): PopulationWorld => {
      const world = createPopulationWorld(["p1"], makePopulationStaticData(), {
        p1: { worker: 10_000, skilled_worker: 3_000 }
      });
      setEmployer(
        world,
        "p1",
        makeEmployer("factory_a", [
          { jobTypeId: "production_operator", desiredFte: 6_000, wageCents: 180_000 }
        ])
      );
      return world;
    };

    const uninterrupted = buildWorld();
    for (let month = 0; month < 24; month += 1) {
      runMonthlyPopulationStep(uninterrupted);
    }
    const restored = (
      globalThis as typeof globalThis & {
        structuredClone(value: unknown): unknown;
      }
    ).structuredClone(uninterrupted) as PopulationWorld;

    for (let month = 0; month < 12; month += 1) {
      runMonthlyPopulationStep(uninterrupted);
      runMonthlyPopulationStep(restored);
    }

    expect(getProvincePopulationSummary(restored, "p1")).toEqual(
      getProvincePopulationSummary(uninterrupted, "p1")
    );
    expect([...restored.referenceWages.entries()].sort()).toEqual(
      [...uninterrupted.referenceWages.entries()].sort()
    );
  });

  it("produces unemployment and falling wages when jobs are scarce", () => {
    const staticData = makePopulationStaticData();
    const minimumWage = staticData.laborMarketParameters.legalMinimumWageCentsPerMonth;
    const world = createPopulationWorld(["p1"], staticData, { p1: { worker: 10_000 } });
    setEmployer(
      world,
      "p1",
      makeEmployer("factory_a", [
        { jobTypeId: "production_operator", desiredFte: 1_000, wageCents: 200_000 }
      ])
    );

    runMonthlyPopulationStep(world);

    const summary = getProvincePopulationSummary(world, "p1");
    expect(summary.employedPersons).toBeLessThanOrEqual(1_000 + 1e-6);
    expect(summary.unemploymentRate).toBeGreaterThan(0.5);

    let previousWage = Number.POSITIVE_INFINITY;
    for (let month = 0; month < 30; month += 1) {
      runMonthlyPopulationStep(world);
      const labor = getProvinceLaborMarket(world, "p1");
      const wage = labor.referenceWageCentsByJobType.production_operator ?? 0;
      expect(wage).toBeLessThanOrEqual(previousWage + 1e-9);
      previousWage = wage;
    }
    expect(previousWage).toBeGreaterThanOrEqual(minimumWage - 1e-9);
  });

  it("raises reference wages gradually when high-skill vacancies persist", () => {
    const world = createPopulationWorld(["p1"], makePopulationStaticData(), {
      p1: { worker: 20_000, professional: 500 }
    });
    setEmployer(
      world,
      "p1",
      makeEmployer("lab", [{ jobTypeId: "engineer", desiredFte: 5_000, wageCents: 300_000 }])
    );

    const wages: number[] = [];
    for (let month = 0; month < 12; month += 1) {
      runMonthlyPopulationStep(world);
      wages.push(getProvinceLaborMarket(world, "p1").referenceWageCentsByJobType.engineer ?? 0);
    }

    expect(wages[0] ?? 0).toBeLessThan(wages[wages.length - 1] ?? 0);
    let maximumJump = 1;
    for (let index = 1; index < wages.length; index += 1) {
      const previous = wages[index - 1] ?? 1;
      maximumJump = Math.max(maximumJump, (wages[index] ?? 0) / previous);
    }
    expect(maximumJump).toBeLessThan(1.06);
  });

  it("lays off workers when demand shrinks and rehires when it recovers", () => {
    const world = createPopulationWorld(["p1"], makePopulationStaticData(), {
      p1: { worker: 10_000 }
    });
    setEmployer(
      world,
      "p1",
      makeEmployer("factory_a", [
        { jobTypeId: "production_operator", desiredFte: 5_000, wageCents: 200_000 }
      ])
    );
    runMonthlyPopulationStep(world);

    upsertJobDemand(world, "factory_a", {
      jobTypeId: "production_operator",
      arrangement: "permanent",
      desiredFte: 1_000,
      offeredMonthlyWageCentsPerFte: 200_000
    });
    runMonthlyPopulationStep(world);
    expect(getProvincePopulationSummary(world, "p1").employedPersons).toBeCloseTo(1_000, 4);

    upsertJobDemand(world, "factory_a", {
      jobTypeId: "production_operator",
      arrangement: "permanent",
      desiredFte: 4_000,
      offeredMonthlyWageCentsPerFte: 200_000
    });
    runMonthlyPopulationStep(world);
    expect(getProvincePopulationSummary(world, "p1").employedPersons).toBeCloseTo(4_000, 4);

    removeEmployer(world, "factory_a");
    expect(getProvincePopulationSummary(world, "p1").employedPersons).toBeCloseTo(0, 4);
    expect(getPopulationInvariantReport(world).valid).toBe(true);
  });

  it("transfers class membership with lagged progress without creating or destroying people or assets", () => {
    const world = createPopulationWorld(["p1"], makePopulationStaticData(), {
      p1: { worker: 50_000 }
    });

    for (let month = 0; month < 40; month += 1) {
      applyClassIncomeEvent(world, "p1", "worker", { businessIncomeCents: 900_000_000 });
      applyClassIncomeEvent(world, "p1", "worker", { laborIncomeCents: 100_000_000 });
      runClassTransitions(world);
    }

    const summary = getProvincePopulationSummary(world, "p1");
    expect(summary.populationBySocialClass.capitalist ?? 0).toBeGreaterThan(0);
    expect(summary.populationBySocialClass.worker).toBeLessThan(50_000);
    expect(summary.populationPersons).toBeCloseTo(50_000, 4);
    expect(getPopulationInvariantReport(world).valid).toBe(true);
  });

  it("transfers workers into capitalist through the full monthly step using business income", () => {
    const world = createPopulationWorld(["p1"], makePopulationStaticData(), {
      p1: { worker: 50_000 }
    });

    for (let month = 0; month < 40; month += 1) {
      applyClassIncomeEvent(world, "p1", "worker", {
        businessIncomeCents: 900_000_000,
        laborIncomeCents: 100_000_000
      });
      runMonthlyPopulationStep(world);
    }

    const summary = getProvincePopulationSummary(world, "p1");
    expect(summary.populationBySocialClass.capitalist ?? 0).toBeGreaterThan(0);
    expect(summary.populationPersons).toBeGreaterThan(0);
    expect(getPopulationInvariantReport(world).valid).toBe(true);
  });

  it("completes the managerial transition when only middle management jobs dominate", () => {
    const world = createPopulationWorld(["p1"], makePopulationStaticData(), {
      p1: { office_worker: 5_000 }
    });
    setEmployer(
      world,
      "p1",
      makeEmployer("hq", [
        { jobTypeId: "department_manager", desiredFte: 2_000, wageCents: 400_000 }
      ])
    );

    for (let month = 0; month < 20; month += 1) {
      runMonthlyPopulationStep(world);
    }

    const summary = getProvincePopulationSummary(world, "p1");
    expect(summary.populationBySocialClass.managerial ?? 0).toBeGreaterThan(0);
    expect(summary.populationBySocialClass.office_worker).toBeLessThan(5_000);
    expect(getPopulationInvariantReport(world).valid).toBe(true);
  });

  it("moves workers into rentier using combined passive income dominance", () => {
    const world = createPopulationWorld(["p1"], makePopulationStaticData(), {
      p1: { worker: 10_000 }
    });
    for (const state of world.classStatesByProvince.get("p1")!.values()) {
      state.balanceSheet.securitiesCents = 20_000_000 * state.populationPersons;
    }

    for (let month = 0; month < 20; month += 1) {
      applyClassIncomeEvent(world, "p1", "worker", {
        rentIncomeCents: 700_000_000,
        capitalIncomeCents: 300_000_000
      });
      runMonthlyPopulationStep(world);
    }

    const summary = getProvincePopulationSummary(world, "p1");
    expect(summary.populationBySocialClass.rentier ?? 0).toBeGreaterThan(0);
    expect(getPopulationInvariantReport(world).valid).toBe(true);
  });

  it("keeps total assets and debts constant across vital events by emitting inheritance events", () => {
    const world = createPopulationWorld(["p1"], makePopulationStaticData(), {
      p1: { worker: 10_000 }
    });
    for (const state of world.classStatesByProvince.get("p1")!.values()) {
      state.balanceSheet.cashCents = 100 * state.populationPersons;
      state.balanceSheet.securitiesCents = 50 * state.populationPersons;
      state.balanceSheet.mortgageDebtCents = 30 * state.populationPersons;
    }
    const assetsBefore = worldTotalAssets(world);
    const investmentsBefore = worldTotalInvestmentBookValue(world);
    const debtsBefore = worldTotalDebt(world);

    let inheritedAssetsCents = 0;
    let inheritedDebtCents = 0;
    let inheritedInvestmentBookValueCents = 0;
    for (let month = 0; month < 120; month += 1) {
      const result = runMonthlyPopulationStep(world);
      for (const event of result.inheritanceEvents) {
        inheritedAssetsCents += event.inheritedAssetsCents;
        inheritedDebtCents += event.inheritedDebtCents;
        inheritedInvestmentBookValueCents += event.inheritedInvestmentBookValueCents;
      }
    }

    expect(inheritedAssetsCents).toBeGreaterThan(0);
    expect(inheritedDebtCents).toBeGreaterThan(0);
    expect(inheritedInvestmentBookValueCents).toBeGreaterThan(0);
    expect(worldOrdinaryAssets(world) + inheritedAssetsCents).toBeCloseTo(
      assetsBefore - investmentsBefore,
      3
    );
    expect(worldTotalInvestmentBookValue(world)).toBeCloseTo(investmentsBefore, 3);
    expect(worldTotalDebt(world) + inheritedDebtCents).toBeCloseTo(debtsBefore, 3);
    expect(getPopulationInvariantReport(world).valid).toBe(true);
  });

  it("emits equity reclassification events instead of moving investment assets proportionally", () => {
    const world = createPopulationWorld(["p1"], makePopulationStaticData(), {
      p1: { worker: 50_000 }
    });
    for (const state of world.classStatesByProvince.get("p1")!.values()) {
      state.balanceSheet.securitiesCents = 1_000 * state.populationPersons;
    }
    const investmentsBefore = worldTotalInvestmentBookValue(world);
    let reclassifications = 0;
    let deceasedInvestmentBookValueCents = 0;
    for (let month = 0; month < 40; month += 1) {
      applyClassIncomeEvent(world, "p1", "worker", { businessIncomeCents: 900_000_000 });
      applyClassIncomeEvent(world, "p1", "worker", { laborIncomeCents: 100_000_000 });
      const result = runMonthlyPopulationStep(world);
      for (const event of result.inheritanceEvents) {
        deceasedInvestmentBookValueCents += event.inheritedInvestmentBookValueCents;
      }
      for (const event of result.equityReclassifications) {
        reclassifications += 1;
        expect(event.reason).toBe("class_transition");
        expect(event.fromProvinceId).toBe("p1");
        expect(event.toProvinceId).toBe("p1");
        expect(event.fromSocialClassId).toBe("worker");
        expect(event.toSocialClassId).toBe("capitalist");
        expect(event.sourceShare).toBeGreaterThan(0);
        expect(event.sourceShare).toBeLessThan(1);
      }
    }

    expect(reclassifications).toBeGreaterThan(0);
    const summary = getProvincePopulationSummary(world, "p1");
    expect(summary.populationBySocialClass.capitalist ?? 0).toBeGreaterThan(0);
    const capitalistState = world.classStatesByProvince.get("p1")!.get("capitalist")!;
    expect(capitalistState.balanceSheet.securitiesCents).toBeCloseTo(0, 6);
    expect(worldTotalInvestmentBookValue(world)).toBeCloseTo(investmentsBefore, 3);
    expect(deceasedInvestmentBookValueCents).toBeGreaterThan(0);
    expect(getPopulationInvariantReport(world).valid).toBe(true);
  });

  it("reduces employment only by the labor-force share of deaths", () => {
    const staticData = makePopulationStaticData();
    staticData.rates.annualCrudeBirthRate = 0;
    const mortality = staticData.rates.annualMortalityRateByAgeBand as unknown as Record<
      string,
      number
    >;
    for (const band of Object.keys(mortality)) {
      mortality[band] = 0.06;
    }
    const world = createPopulationWorld(["p1"], staticData, { p1: { worker: 10_000 } });
    setEmployer(
      world,
      "p1",
      makeEmployer("factory_a", [
        { jobTypeId: "production_operator", desiredFte: 4_000, wageCents: 200_000 }
      ])
    );
    runMonthlyPopulationStep(world);

    const mutableDurations = world.staticData.rates.ageBandDurationMonths as unknown as Record<
      string,
      number
    >;
    for (const band of Object.keys(mutableDurations)) {
      mutableDurations[band] = Number.POSITIVE_INFINITY;
    }

    const before = getProvincePopulationSummary(world, "p1");
    const classState = world.classStatesByProvince.get("p1")!.get("worker")!;
    const employedBefore = classState.employmentStatusCounts.employed;

    runVitalEvents(world);

    const after = getProvincePopulationSummary(world, "p1");
    const employedAfter = classState.employmentStatusCounts.employed;

    const populationSurvival = after.populationPersons / before.populationPersons;
    expect(employedAfter / employedBefore).toBeCloseTo(populationSurvival, 9);

    const liveRates = world.staticData.rates as {
      annualCrudeBirthRate: number;
      annualMortalityRateByAgeBand: Record<string, number>;
    };
    liveRates.annualCrudeBirthRate = 0;
    liveRates.annualMortalityRateByAgeBand.child_0_14 = 0;
    liveRates.annualMortalityRateByAgeBand.youth_15_24 = 0;
    liveRates.annualMortalityRateByAgeBand.prime_25_44 = 0;
    liveRates.annualMortalityRateByAgeBand.mature_45_64 = 0;
    liveRates.annualMortalityRateByAgeBand.senior_65_plus = 0.2;

    const beforeAsymmetric = getProvincePopulationSummary(world, "p1");
    const employedBeforeAsymmetric = classState.employmentStatusCounts.employed;
    runVitalEvents(world);
    const afterAsymmetric = getProvincePopulationSummary(world, "p1");
    const employedAfterAsymmetric = classState.employmentStatusCounts.employed;

    const survivalWithSeniorOnlyDeaths =
      afterAsymmetric.populationPersons / beforeAsymmetric.populationPersons;
    expect(employedAfterAsymmetric / employedBeforeAsymmetric).toBeGreaterThan(
      survivalWithSeniorOnlyDeaths
    );
    expect(getPopulationInvariantReport(world).valid).toBe(true);
  });

  it("seeds observed age/sex/education distributions proportionally", () => {
    const observed = {
      pop: 10_000,
      male: 5_200,
      female: 4_800,
      age: {
        child_0_14: 2_400,
        youth_15_24: 1_200,
        prime_25_44: 3_000,
        mature_45_64: 2_200,
        senior_65_plus: 1_200
      },
      education15Plus: {
        basic: 4_000,
        secondary: 3_500,
        tertiary: 1_800,
        advanced: 700
      }
    };
    const world = createPopulationWorld(["p1"], makePopulationStaticData(), undefined, {
      provinceDemographics: { p1: observed }
    });
    const summary = getProvincePopulationSummary(world, "p1");
    expect(summary.populationPersons).toBeCloseTo(10_000, 5);
    const state = world.classStatesByProvince.get("p1")!.values().next().value!;
    // Age/gender/education totals must match the seeded population within tolerance.
    const ageSum = Object.values(state.ageCounts).reduce((sum, value) => sum + value, 0);
    expect(ageSum).toBeCloseTo(state.populationPersons, 5);
    const genderSum = state.genderCounts.male + state.genderCounts.female;
    expect(genderSum).toBeCloseTo(state.populationPersons, 5);
    expect(state.genderCounts.male).toBeCloseTo(state.populationPersons * 0.52, 5);
    const educationSum = Object.values(state.workingAgeEducationCounts).reduce(
      (sum, value) => sum + value,
      0
    );
    const workingAge = state.ageCounts.youth_15_24 + state.ageCounts.prime_25_44 + state.ageCounts.mature_45_64;
    expect(educationSum).toBeCloseTo(workingAge, 5);
    expect(getPopulationInvariantReport(world).valid).toBe(true);
  });

  it("moves population between provinces through exogenous migration commands", () => {
    const world = createPopulationWorld(["a", "b"], makePopulationStaticData(), {
      a: { worker: 10_000 },
      b: { worker: 5_000 }
    });
    const before = worldTotalPopulation(world);

    applyExogenousMigrationCommand(world, {
      fromProvinceId: "a",
      toProvinceId: "b",
      socialClassId: "worker",
      persons: 2_500,
      includeAssets: true
    });

    const summaryA = getProvincePopulationSummary(world, "a");
    const summaryB = getProvincePopulationSummary(world, "b");
    expect(summaryA.populationPersons).toBeCloseTo(7_500, 4);
    expect(summaryB.populationPersons).toBeCloseTo(7_500, 4);
    expect(worldTotalPopulation(world)).toBeCloseTo(before, 4);
    expect(getPopulationInvariantReport(world).valid).toBe(true);
  });
});

function worldTotalPopulation(world: PopulationWorld): number {
  let population = 0;
  for (const classes of world.classStatesByProvince.values()) {
    for (const state of classes.values()) {
      population += state.populationPersons;
    }
  }
  return population;
}

function worldTotalAssets(world: PopulationWorld): number {
  return worldTotalInvestmentBookValue(world) + worldOrdinaryAssets(world);
}

function worldOrdinaryAssets(world: PopulationWorld): number {
  let total = 0;
  for (const classes of world.classStatesByProvince.values()) {
    for (const state of classes.values()) {
      for (const field of Object.keys(state.balanceSheet)) {
        if (
          field === "mortgageDebtCents" ||
          field === "otherDebtCents" ||
          field === "securitiesCents" ||
          field === "businessEquityCents"
        ) {
          continue;
        }
        total += state.balanceSheet[field as keyof typeof state.balanceSheet];
      }
    }
  }
  return total;
}

function worldTotalInvestmentBookValue(world: PopulationWorld): number {
  let total = 0;
  for (const classes of world.classStatesByProvince.values()) {
    for (const state of classes.values()) {
      total += state.balanceSheet.securitiesCents + state.balanceSheet.businessEquityCents;
    }
  }
  return total;
}

function worldTotalDebt(world: PopulationWorld): number {
  let total = 0;
  for (const classes of world.classStatesByProvince.values()) {
    for (const state of classes.values()) {
      total += state.balanceSheet.mortgageDebtCents + state.balanceSheet.otherDebtCents;
    }
  }
  return total;
}
