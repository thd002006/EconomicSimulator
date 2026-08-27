import { describe, expect, it } from "vitest";
import { mergeGameUiLookups } from "./game-lookups.js";

describe("mergeGameUiLookups", () => {
  it("reads population from simulation cache, not map demographics", () => {
    const lookups = mergeGameUiLookups(
      {
        findProvince: () => undefined,
        getCountryName: (id) => (id === "AAA" ? "Alpha" : undefined)
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
            }
          }
        }
      },
      {
        AAA: { countryId: "AAA", provinceCount: 1, populationPersons: 42 }
      }
    );

    expect(lookups.getOwner("p1")).toBe("AAA");
    expect(lookups.getProvincePopulation("p1")?.summary.populationPersons).toBe(42);
    expect(lookups.getCountryPopulation("AAA")?.populationPersons).toBe(42);
    expect(lookups.getCountryName("AAA")).toBe("Alpha");
  });
});
