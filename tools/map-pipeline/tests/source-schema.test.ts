import { describe, expect, it } from "vitest";
import { assertUniqueFeatureIds } from "../src/feature-ids.js";
import { parseSourceMapManifest } from "../src/source-manifest.js";

const validManifest = {
  schemaVersion: 2,
  id: "test-map",
  version: "1.2.3",
  nameKey: "map.test.name",
  coordinateReferenceSystem: "EPSG:4326",
  layers: { provinces: "provinces.geojson", boundaries: "boundaries.json" }
};

describe("source map schema", () => {
  it("accepts a complete supported manifest", () => {
    expect(parseSourceMapManifest(validManifest, "test-map")).toEqual(validManifest);
  });

  it.each([
    ["schemaVersion", { ...validManifest, schemaVersion: 1 }],
    ["version", { ...validManifest, version: undefined }],
    ["version format", { ...validManifest, version: "first" }],
    ["nameKey", { ...validManifest, nameKey: "" }],
    ["coordinate reference system", { ...validManifest, coordinateReferenceSystem: "EPSG:3857" }],
    ["required layer", { ...validManifest, layers: { boundaries: "boundaries.json" } }]
  ])("rejects an invalid %s", (_label, manifest) => {
    expect(() => parseSourceMapManifest(manifest, "test-map")).toThrow();
  });
});

describe("stable feature IDs", () => {
  it("requires IDs on every layer feature", () => {
    expect(() => assertUniqueFeatureIds([{ id: "one" }, {}], "provinces")).toThrow(
      "missing a stable id"
    );
  });

  it("rejects duplicate IDs after normalization", () => {
    expect(() => assertUniqueFeatureIds([{ id: 7 }, { id: "7" }], "boundaries")).toThrow(
      "duplicate feature id"
    );
  });
});
