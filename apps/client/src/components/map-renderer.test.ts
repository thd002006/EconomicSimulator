import { describe, expect, it } from "vitest";
import { boundaryIsCountry, boundaryOwnerChanges, showProvinceBorders } from "./map-renderer.js";

describe("map renderer decisions", () => {
  it("hides province borders when the map is zoomed out", () => {
    expect(showProvinceBorders(70)).toBe(false);
    expect(showProvinceBorders(45)).toBe(false);
    expect(showProvinceBorders(40)).toBe(true);
    expect(showProvinceBorders(20)).toBe(true);
  });

  it("classifies shared boundaries using current ownership", () => {
    const boundary = {
      id: "a-b",
      leftProvinceId: "A",
      rightProvinceId: "B",
      coordinates: [[0, 0] as const, [1, 1] as const]
    };
    expect(boundaryIsCountry(boundary, () => "same")).toBe(false);
    expect(boundaryIsCountry(boundary, (id) => id)).toBe(true);
    expect(boundaryOwnerChanges({ A: "X" }, { A: "Y", B: "Z" })).toEqual(["A", "B"]);
  });
});
