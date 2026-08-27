import { describe, expect, it } from "vitest";
import { formatGdp, mergeGameUiLookups } from "./game-lookups.js";

describe("mergeGameUiLookups", () => {
  it("reads population from simulation cache, not map demographics", () => {
    const lookups = mergeGameUiLookups(
      {
        findProvince: () => undefined,
        getCountryName: (id) => (id === "AAA" ? "Alpha" : undefined),
        getCountryGdpPpp: (id) => (id === "AAA" ? 1_500_000_000 : undefined)
      },
      { p1: "AAA" },
      {
        p1: {
          summary: {
            provinceId: "p1",
            populationPersons: 42,
            workingAgePopulation: 30,
            laborForcePopulation: 20,
            employedPersons: 18,
            unemployedPersons: 2,
            employmentRate: 0.6,
            unemploymentRate: 0.1,
            populationBySocialClass: { worker: 42 }
          },
          demographics: {
            provinceId: "p1",
            male: 21,
            female: 21,
            age: {
              child_0_14: 10,
              youth_15_24: 8,
              prime_25_44: 12,
              mature_45_64: 8,
              senior_65_plus: 4
            },
            employment: {
              employed: 18,
              unemployed: 2,
              student: 5,
              retired: 4,
              not_in_labor_force: 13
            }
          },
          classes: [
            {
              socialClassId: "worker",
              populationPersons: 42,
              age: {
                child_0_14: 10,
                youth_15_24: 8,
                prime_25_44: 12,
                mature_45_64: 8,
                senior_65_plus: 4
              },
              gender: { male: 21, female: 21 },
              education: { basic: 10, secondary: 20, tertiary: 8, advanced: 4 },
              skill: { low: 10, medium: 20, high: 8, expert: 4 },
              employment: {
                employed: 18,
                unemployed: 2,
                student: 5,
                retired: 4,
                not_in_labor_force: 13
              }
            }
          ]
        }
      },
      {
        AAA: { countryId: "AAA", provinceCount: 1, populationPersons: 42 }
      },
      {
        p1: {
          pop: 42,
          male: 21,
          female: 21,
          age: {
            child_0_14: 10,
            youth_15_24: 8,
            prime_25_44: 12,
            mature_45_64: 8,
            senior_65_plus: 4
          },
          education15Plus: { basic: 10, secondary: 20, tertiary: 8, advanced: 4 },
          gdpPpp: 1_500_000_000
        }
      }
    );

    expect(lookups.getOwner("p1")).toBe("AAA");
    expect(lookups.getProvincePopulation("p1")?.summary.populationPersons).toBe(42);
    expect(lookups.getCountryPopulation("AAA")?.populationPersons).toBe(42);
    expect(lookups.getCountryName("AAA")).toBe("Alpha");
    expect(lookups.getProvinceGdpPpp("p1")).toBe(1_500_000_000);
    expect(lookups.getCountryGdpPpp("AAA")).toBe(1_500_000_000);
    expect(formatGdp(1_500_000_000)).toBe("$1.50B");
  });
});
