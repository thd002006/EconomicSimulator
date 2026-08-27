import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVINCE_DEFINITIONS, parseProvinceDefinitions } from "../src/province-definition";

describe("province definitions", () => {
  it("contains exactly 1287 provinces matching the authored map", () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const geoText = readFileSync(join(repoRoot, "assets/maps/world-modern/provinces.geojson"), "utf8");
    const reviewText = readFileSync(
      join(repoRoot, "mapdata-generator/output/world-modern/review-report.json"),
      "utf8",
    );
    const geo = JSON.parse(geoText) as { features: Array<{ id: string }> };
    const review = JSON.parse(reviewText) as { provinces: Array<{ id: string }> };
    expect(PROVINCE_DEFINITIONS).toHaveLength(1287);
    expect(PROVINCE_DEFINITIONS).toHaveLength(geo.features.length);
    expect(PROVINCE_DEFINITIONS).toHaveLength(review.provinces.length);
    const geoIds = new Set(geo.features.map((f) => String(f.id)));
    const defIds = new Set(PROVINCE_DEFINITIONS.map((d) => d.id));
    expect(defIds).toEqual(geoIds);
  });

  it("satisfies invariants for all provinces", () => {
    for (const def of PROVINCE_DEFINITIONS) {
      expect(def.landAreaKm2).toBeGreaterThan(0);
      expect(Number.isFinite(def.landAreaKm2)).toBe(true);
      expect(def.arableLandKm2).toBeGreaterThanOrEqual(0);
      expect(def.arableLandKm2).toBeLessThanOrEqual(def.landAreaKm2);
      expect(def.cultivationCondition).toBeGreaterThanOrEqual(0);
      expect(def.cultivationCondition).toBeLessThanOrEqual(1);
      expect(def.habitability).toBeGreaterThanOrEqual(0);
      expect(def.habitability).toBeLessThanOrEqual(1);
      expect(def.map.featureId).toBe(def.id);
      expect(def.map.mapId).toBe("world-modern");
    }
  });

  it("rejects duplicates and arable overflow", () => {
    const dup = [...PROVINCE_DEFINITIONS, PROVINCE_DEFINITIONS[0]!];
    expect(() => parseProvinceDefinitions(dup)).toThrow(/duplicate/i);
    const overflow = PROVINCE_DEFINITIONS.map((d) => ({ ...d, arableLandKm2: d.landAreaKm2 + 1 }));
    expect(() => parseProvinceDefinitions([overflow[0]!])).toThrow(/exceeds landArea/i);
  });

  it("has plausible global totals and distributions", () => {
    const totalLand = PROVINCE_DEFINITIONS.reduce((s, p) => s + p.landAreaKm2, 0);
    const totalArable = PROVINCE_DEFINITIONS.reduce((s, p) => s + p.arableLandKm2, 0);
    // Global cropland ~10-12% of land
    expect(totalArable / totalLand).toBeGreaterThan(0.05);
    expect(totalArable / totalLand).toBeLessThan(0.20);
    // Check extremes are not all equal
    const cultivations = PROVINCE_DEFINITIONS.map((p) => p.cultivationCondition);
    expect(Math.min(...cultivations)).toBeLessThanOrEqual(0.06);
    expect(Math.max(...cultivations)).toBeGreaterThanOrEqual(0.90);
    const habits = PROVINCE_DEFINITIONS.map((p) => p.habitability);
    expect(Math.min(...habits)).toBeLessThanOrEqual(0.06);
    expect(Math.max(...habits)).toBeGreaterThanOrEqual(0.85);
  });

  it("assigns known high/low provinces correctly", () => {
    const byId = new Map(PROVINCE_DEFINITIONS.map((p) => [p.id, p]));
    // Fertile Pampas / French plains should be high cultivation
    expect(byId.get("FRA-Centre-Val-de-Loire")!.cultivationCondition).toBeGreaterThan(0.85);
    expect(byId.get("FRA-Centre-Val-de-Loire")!.habitability).toBeGreaterThan(0.80);
    expect(byId.get("US-IA")!.cultivationCondition).toBeGreaterThan(0.80);
    expect(byId.get("US-IA")!.arableLandKm2).toBeGreaterThan(20000);
    // Tibetan plateau should be very low
    expect(byId.get("CN-XZ")!.cultivationCondition).toBeLessThan(0.25);
    expect(byId.get("CN-XZ")!.habitability).toBeLessThan(0.30);
    expect(byId.get("CN-XZ")!.arableLandKm2 / byId.get("CN-XZ")!.landAreaKm2).toBeLessThan(0.02);
    // Polar / desert should be low
    expect(byId.get("US-AK")!.habitability).toBeLessThan(0.25);
    expect(byId.get("US-AK")!.cultivationCondition).toBeLessThan(0.20);
    expect(byId.get("CA-NU")!.habitability).toBeLessThan(0.12);
    expect(byId.get("-99-X02~")!.arableLandKm2).toBe(0);
    expect(byId.get("VA-X01~")!.habitability).toBeGreaterThan(0.90);
  });
});
