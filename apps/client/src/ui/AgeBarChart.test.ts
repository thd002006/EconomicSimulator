import { describe, expect, it } from "vitest";
import { normalizeAgeCounts } from "./AgeBarChart.js";

describe("AgeBarChart normalizeAgeCounts", () => {
  it("normalizes array of numbers into 101 single-year cohorts", () => {
    const raw = [10, 20, 30];
    const normalized = normalizeAgeCounts(raw);

    expect(normalized).toHaveLength(101);
    expect(normalized[0]).toBe(10);
    expect(normalized[1]).toBe(20);
    expect(normalized[2]).toBe(30);
    expect(normalized[3]).toBe(0);
    expect(normalized[100]).toBe(0);
  });

  it("normalizes record dictionary with string keys", () => {
    const raw = {
      "0": 50,
      "25": 120,
      "100": 15,
      "105": 999, // Should be ignored (> 100)
      invalid: 42 // Should be ignored
    };
    const normalized = normalizeAgeCounts(raw);

    expect(normalized).toHaveLength(101);
    expect(normalized[0]).toBe(50);
    expect(normalized[25]).toBe(120);
    expect(normalized[100]).toBe(15);
    expect(normalized[1]).toBe(0);
  });

  it("handles undefined gracefully with all zeros", () => {
    const normalized = normalizeAgeCounts(undefined);
    expect(normalized).toHaveLength(101);
    expect(normalized.every((v) => v === 0)).toBe(true);
  });
});
