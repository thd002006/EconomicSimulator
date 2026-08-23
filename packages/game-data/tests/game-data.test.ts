import { describe, expect, it } from "vitest";
import { parseGameDataManifest } from "../src";

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
