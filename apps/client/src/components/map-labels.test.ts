import { describe, expect, it } from "vitest";
import type { ProvinceFeature } from "@economic-simulator/map-runtime";
import {
  buildCountryLabelAnchors,
  buildProvinceLabels,
  labelVisibility,
  wrapLabelX
} from "./map-labels.js";

function province(id: string, owner: string, lon: number, lat: number, name = id): ProvinceFeature {
  return {
    id,
    properties: {
      nameEn: name,
      adm0A3: owner,
      capital: { coordinates: [lon, lat] }
    },
    geometry: { type: "Polygon", coordinates: [] },
    bbox: [lon, lat, lon, lat]
  };
}

describe("map label LOD", () => {
  it("shows major country labels at every zoom, smaller countries when closer", () => {
    expect(labelVisibility(70, "country-major")).toBe(true);
    expect(labelVisibility(70, "country")).toBe(false);
    expect(labelVisibility(70, "province")).toBe(false);
    expect(labelVisibility(50, "country")).toBe(true);
    expect(labelVisibility(50, "province")).toBe(false);
    expect(labelVisibility(30, "province")).toBe(true);
  });

  it("wraps label longitudes toward the camera", () => {
    expect(wrapLabelX(-170, 170)).toBeCloseTo(190, 8);
    expect(wrapLabelX(170, -170)).toBeCloseTo(-190, 8);
    expect(wrapLabelX(10, 20)).toBeCloseTo(10, 8);
  });

  it("aggregates country anchors from province capitals", () => {
    const labels = buildCountryLabelAnchors(
      [
        province("a", "AAA", 0, 0),
        province("b", "AAA", 10, 10),
        province("c", "BBB", 40, 20),
        ...Array.from({ length: 12 }, (_, index) =>
          province(`m${index}`, "MAJ", index, index, `Major ${index}`)
        )
      ],
      (id) => {
        if (id.startsWith("m")) return "MAJ";
        if (id === "a" || id === "b") return "AAA";
        return "BBB";
      }
    );
    const aaa = labels.find((label) => label.id === "country:AAA");
    const maj = labels.find((label) => label.id === "country:MAJ");
    expect(aaa?.kind).toBe("country");
    expect(aaa?.x).toBeCloseTo(5, 5);
    expect(aaa?.y).toBeCloseTo(5, 5);
    expect(maj?.kind).toBe("country-major");
    expect(maj?.provinceCount).toBe(12);
  });

  it("builds province labels from English or local names", () => {
    const labels = buildProvinceLabels([
      province("p1", "AAA", 1, 2, "Alpha"),
      {
        id: "p2",
        properties: {
          name: "仅本地名",
          adm0A3: "BBB",
          capital: { coordinates: [3, 4] }
        },
        geometry: { type: "Polygon", coordinates: [] },
        bbox: [3, 4, 3, 4]
      }
    ]);
    expect(labels).toEqual([
      expect.objectContaining({ id: "province:p1", text: "Alpha", kind: "province" }),
      expect.objectContaining({ id: "province:p2", text: "仅本地名", kind: "province" })
    ]);
  });
});
