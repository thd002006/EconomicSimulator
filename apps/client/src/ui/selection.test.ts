import { describe, expect, it } from "vitest";
import { selectionFromPick, sameSelection } from "./selection.js";
import { clearTabMemory, getRememberedTab, rememberTab } from "./tab-memory.js";

describe("selectionFromPick", () => {
  it("selects provinces when detail LOD is active", () => {
    expect(selectionFromPick("p1", "USA", true)).toEqual({ kind: "province", id: "p1" });
  });

  it("selects countries when province borders are hidden", () => {
    expect(selectionFromPick("p1", "USA", false)).toEqual({ kind: "country", id: "USA" });
  });

  it("clears selection for ocean or missing owner at country LOD", () => {
    expect(selectionFromPick(undefined, undefined, true)).toBeUndefined();
    expect(selectionFromPick("p1", undefined, false)).toBeUndefined();
    expect(selectionFromPick("p1", "", false)).toBeUndefined();
  });
});

describe("sameSelection", () => {
  it("compares kind and id", () => {
    expect(sameSelection(undefined, undefined)).toBe(true);
    expect(sameSelection({ kind: "province", id: "a" }, { kind: "province", id: "a" })).toBe(
      true
    );
    expect(sameSelection({ kind: "province", id: "a" }, { kind: "country", id: "a" })).toBe(false);
  });
});

describe("tab memory", () => {
  it("remembers tabs per entity kind", () => {
    clearTabMemory();
    rememberTab("province", "population");
    rememberTab("country", "overview");
    expect(getRememberedTab("province", ["overview", "population"], "overview")).toBe(
      "population"
    );
    expect(getRememberedTab("country", ["overview"], "overview")).toBe("overview");
    rememberTab("province", "overview");
    expect(getRememberedTab("province", ["overview", "population"], "population")).toBe(
      "overview"
    );
  });

  it("falls back when remembered tab is unavailable", () => {
    clearTabMemory();
    rememberTab("province", "companies");
    expect(getRememberedTab("province", ["overview", "population"], "overview")).toBe("overview");
  });
});
