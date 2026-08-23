import { describe, expect, it } from "vitest";
import { inspectFeatureCollection } from "../src";

describe("map runtime validation", () => {
  it("indexes stable GeoJSON feature IDs", () => {
    const result = inspectFeatureCollection({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "province-1",
          properties: {},
          geometry: { type: "Polygon", coordinates: [] }
        }
      ]
    });

    expect(result.featureIds).toEqual(["province-1"]);
    expect(result.geometryCounts).toEqual({ Polygon: 1 });
  });
});
