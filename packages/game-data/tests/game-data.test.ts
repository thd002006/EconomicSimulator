import { describe, expect, it } from "vitest";
import { POPULATION_DATA_PACK, parseGameDataManifest } from "../src";
import { validatePopulationStaticData } from "../../simulation-core/src/population/index";

describe("game-data manifest", () => {
  it("accepts an empty development data pack", () => {
    expect(
      parseGameDataManifest({
        schemaVersion: 1,
        dataPackVersion: "dev",
        definitions: [],
        maps: []
      }).dataPackVersion
    ).toBe("dev");
  });

  it("rejects duplicate IDs across categories", () => {
    expect(() =>
      parseGameDataManifest({
        schemaVersion: 1,
        dataPackVersion: "dev",
        definitions: [{ id: "same", source: "a.json" }],
        maps: [{ id: "same", source: "b.geojson" }]
      })
    ).toThrow(/duplicate/i);
  });
});

describe("population data pack", () => {
  it("passes the simulation-core static data validation", () => {
    const validated = validatePopulationStaticData(POPULATION_DATA_PACK);
    expect(validated.socialClasses).toHaveLength(11);
    expect(validated.socialClasses.map((definition) => definition.id)).toContain("worker");
  });

  it("rejects a pack with a broken class transition rule", () => {
    const broken = {
      ...POPULATION_DATA_PACK,
      classTransitionRules: [
        ...POPULATION_DATA_PACK.classTransitionRules,
        {
          sourceClassId: "*",
          targetClassId: "nonexistent",
          priority: -1,
          delayMonths: 1,
          maximumTransferRatePerMonth: 0.01
        }
      ]
    };
    expect(() => validatePopulationStaticData(broken)).toThrow(/unknown social class/);
  });
});
