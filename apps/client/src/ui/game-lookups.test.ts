import { describe, expect, it } from "vitest";
import { formatGdp, mergeGameUiLookups, ageCountsToSingleYearRecord } from "./game-lookups.js";

describe("mergeGameUiLookups", () => {
  it("reads population from simulation cache, not map demographics", () => {
    const ageArray = new Array(101).fill(0);
    ageArray[5] = 10;
    ageArray[20] = 8;
    ageArray[30] = 12;
    ageArray[50] = 8;
    ageArray[70] = 4;

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
            age: ageArray,
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
              age: ageArray,
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
          age: Object.fromEntries(Array.from({ length: 101 }, (_, age) => [age, age])),
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
    expect(lookups.getProvinceArableLandKm2("non-existent-province")).toBeUndefined();
    expect(formatGdp(1_500_000_000)).toBe("$1.50B");

    const ageRecord = ageCountsToSingleYearRecord(ageArray);
    expect(ageRecord?.["5"]).toBe(10);
    expect(ageRecord?.["20"]).toBe(8);
    expect(ageRecord?.["30"]).toBe(12);
    expect(ageRecord?.["50"]).toBe(8);
    expect(ageRecord?.["70"]).toBe(4);
  });
});
