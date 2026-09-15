import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  findDisputedSpec,
  findDisputedSpecForProvinces,
  loadDisputedTerritories,
  toDisputedProperty
} from "../src/disputed-territories.js";

test("loads the shipped disputed-territories config", async () => {
  const config = await loadDisputedTerritories(join(import.meta.dirname, ".."));
  assert.ok(config !== undefined);
  assert.ok(config.disputedTerritories.length > 0);
  const crimea = findDisputedSpecForProvinces(["UA-43", "UA-40"], config);
  assert.equal(crimea?.administeredBy, "RUS");
  assert.deepEqual(crimea?.claimedBy, ["UKR", "RUS"]);
  // A merged province inherits the first disputed member.
  assert.equal(findDisputedSpecForProvinces(["Hainan", "CN-X01~"], config)?.countryId, "CHN");
  assert.equal(findDisputedSpecForProvinces(["US-CA", "US-TX"], config), undefined);
});

test("missing config file returns undefined", async () => {
  const dir = await mkdtemp(join(tmpdir(), "disputed-"));
  try {
    assert.equal(await loadDisputedTerritories(dir), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects an invalid spec", async () => {
  const dir = await mkdtemp(join(tmpdir(), "disputed-"));
  try {
    await mkdir(join(dir, "config"), { recursive: true });
    await writeFile(
      join(dir, "config/disputed-territories.json"),
      JSON.stringify({ disputedTerritories: [{ provinceIdPattern: "X", level: "bogus" }] })
    );
    await assert.rejects(() => loadDisputedTerritories(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("toDisputedProperty drops matching-only fields", () => {
  const config = {
    disputedTerritories: [
      {
        provinceIdPattern: "TWN-*",
        countryId: "TWN",
        level: "de-facto-control" as const,
        claimedBy: ["CHN"],
        administeredBy: "TWN",
        noteZh: "台湾",
        noteEn: "Taiwan"
      }
    ]
  };
  const spec = findDisputedSpec("TWN-TAIWAN", config);
  assert.ok(spec !== undefined);
  assert.deepEqual(toDisputedProperty(spec), {
    level: "de-facto-control",
    claimedBy: ["CHN"],
    administeredBy: "TWN",
    noteZh: "台湾",
    noteEn: "Taiwan"
  });
});
