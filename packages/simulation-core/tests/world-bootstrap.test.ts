import { describe, expect, it } from "vitest";
import {
  bootstrapGameWorld,
  getCountryPopulationSummary,
  getProvincePopulationSummary,
  aggregateProvinceDemographics,
  type ScenarioBootstrap
} from "../src/index.js";

function singleYearAges(groups: readonly [number, number, number][]): Record<string, number> {
  return Object.fromEntries(
    groups.flatMap(([from, to, total]) =>
      Array.from({ length: to - from + 1 }, (_, offset) => [
        String(from + offset),
        total / (to - from + 1)
      ])
    )
  );
}

describe("world bootstrap", () => {
  const scenario: ScenarioBootstrap = {
    mapId: "test",
    provinces: [
      {
        id: "A",
        ownerCountryId: "AAA",
        demographics: {
          pop: 1000,
          male: 510,
          female: 490,
          age: singleYearAges([
            [0, 14, 240],
            [15, 24, 120],
            [25, 44, 300],
            [45, 64, 220],
            [65, 100, 120]
          ]),
          education15Plus: { basic: 400, secondary: 350, tertiary: 180, advanced: 70 }
        }
      },
      {
        id: "B",
        ownerCountryId: "AAA",
        demographics: {
          pop: 500,
          male: 250,
          female: 250,
          age: singleYearAges([
            [0, 14, 120],
            [15, 24, 60],
            [25, 44, 150],
            [45, 64, 110],
            [65, 100, 60]
          ]),
          education15Plus: { basic: 200, secondary: 175, tertiary: 90, advanced: 35 }
        }
      },
      {
        id: "C",
        ownerCountryId: "BBB",
        demographics: {
          pop: 200,
          male: 100,
          female: 100,
          age: singleYearAges([
            [0, 14, 48],
            [15, 24, 24],
            [25, 44, 60],
            [45, 64, 44],
            [65, 100, 24]
          ]),
          education15Plus: { basic: 80, secondary: 70, tertiary: 36, advanced: 14 }
        }
      }
    ]
  };

  it("seeds population from scenario demographics", () => {
    const world = bootstrapGameWorld(scenario);
    expect(getProvincePopulationSummary(world.population, "A").populationPersons).toBe(1000);
    expect(getProvincePopulationSummary(world.population, "B").populationPersons).toBe(500);
  });

  it("aggregates country population by ownership", () => {
    const world = bootstrapGameWorld(scenario);
    expect(getCountryPopulationSummary(world.population, world.provinceOwnership, "AAA")).toEqual({
      countryId: "AAA",
      provinceCount: 2,
      populationPersons: 1500
    });
    expect(getCountryPopulationSummary(world.population, world.provinceOwnership, "BBB")).toEqual({
      countryId: "BBB",
      provinceCount: 1,
      populationPersons: 200
    });
  });

  it("aggregates province age and gender from class states", () => {
    const world = bootstrapGameWorld(scenario);
    const demo = aggregateProvinceDemographics(world.population, "A");
    expect(demo.male + demo.female).toBe(1000);
    expect(demo.age.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1000, 5);
  });

  it("applies explicit classSeeds instead of default class shares", () => {
    const world = bootstrapGameWorld({
      mapId: "seeded",
      provinces: [
        {
          id: "A",
          ownerCountryId: "AAA",
          demographics: {
            pop: 100,
            male: 60,
            female: 40,
            age: singleYearAges([
              [0, 14, 10],
              [15, 24, 10],
              [25, 44, 40],
              [45, 64, 20],
              [65, 100, 20]
            ]),
            education15Plus: { basic: 25, secondary: 25, tertiary: 25, advanced: 25 }
          }
        }
      ],
      seed: {
        mapId: "seeded",
        provinces: [{ id: "A", ownerCountryId: "AAA" }],
        classSeeds: [
          {
            provinceId: "A",
            socialClassId: "farmer",
            populationPersons: 100,
            male: 60,
            female: 40,
            age: singleYearAges([
              [0, 14, 10],
              [15, 24, 10],
              [25, 44, 40],
              [45, 64, 20],
              [65, 100, 20]
            ]),
            education15Plus: { basic: 25, secondary: 25, tertiary: 25, advanced: 25 }
          }
        ]
      }
    });
    const farmer = world.population.classStatesByProvince.get("A")?.get("farmer");
    expect(farmer?.populationPersons).toBe(100);
    expect(farmer?.genderCounts.male).toBe(60);
    expect(farmer?.genderCounts.female).toBe(40);
    expect(farmer?.ageCounts.slice(25, 45).reduce((a, b) => a + b, 0)).toBeCloseTo(40, 5);
    expect(world.population.classStatesByProvince.get("A")?.get("worker")).toBeUndefined();
  });
});

describe("DeterministicSimulationEngine queries", () => {
  it("exposes province and country queries after scenario initialize", async () => {
    const { DeterministicSimulationEngine } = await import("../src/engine.js");
    const engine = new DeterministicSimulationEngine({
      simulationId: "q-test",
      seed: 1,
      scenario: {
        mapId: "test",
        provinces: [
          {
            id: "A",
            ownerCountryId: "AAA",
            demographics: {
              pop: 100,
              male: 50,
              female: 50,
              age: singleYearAges([
                [0, 14, 24],
                [15, 24, 12],
                [25, 44, 30],
                [45, 64, 22],
                [65, 100, 12]
              ]),
              education15Plus: { basic: 40, secondary: 35, tertiary: 18, advanced: 7 }
            }
          }
        ]
      }
    });
    expect(engine.queryProvinceOwner("A")).toBe("AAA");
    expect(engine.queryOwnershipTable()).toEqual({ A: "AAA" });
    expect(engine.queryProvincePopulation("A").summary.populationPersons).toBe(100);
    const pop = engine.queryProvincePopulation("A");
    expect(pop.classes.length).toBeGreaterThan(0);
    expect(pop.classes.every((entry) => entry.populationPersons > 0)).toBe(true);
    expect(pop.classes.reduce((sum, entry) => sum + entry.populationPersons, 0)).toBe(100);
    const employmentTotal = Object.values(pop.demographics.employment).reduce(
      (sum, value) => sum + value,
      0
    );
    expect(employmentTotal).toBeCloseTo(100, 5);
    expect(engine.queryCountryPopulation("AAA").populationPersons).toBe(100);
  });
});
