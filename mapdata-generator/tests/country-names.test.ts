import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectCountryNames,
  ensureCountriesOnlyCompanionLayers
} from "../src/build-world-modern.js";
import type { GeoJsonFeatureCollection } from "../src/types.js";

test("collectCountryNames maps adm0_a3 to admin and applies reassignments", () => {
  const source = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { adm0_a3: "USA", admin: "United States of America" },
        geometry: null
      },
      {
        type: "Feature",
        properties: { adm0_a3: "USA", admin: "United States of America" },
        geometry: null
      },
      {
        type: "Feature",
        properties: { adm0_a3: "KAB", admin: "Kazakhstan" },
        geometry: null
      },
      {
        type: "Feature",
        properties: { adm0_a3: "FRA", admin: "France" },
        geometry: null
      }
    ]
  } as GeoJsonFeatureCollection;

  assert.deepEqual(collectCountryNames(source), {
    FRA: { nameEn: "France" },
    KAZ: { nameEn: "Kazakhstan" },
    USA: { nameEn: "United States of America" }
  });
  assert.deepEqual(collectCountryNames(source, new Set(["FRA"])), {
    FRA: { nameEn: "France" }
  });
});

test("ensureCountriesOnlyCompanionLayers copies missing layers from assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "countries-only-"));
  const outDir = join(root, "out");
  const assetsDir = join(root, "assets");
  await mkdir(assetsDir, { recursive: true });
  await writeFile(
    join(assetsDir, "provinces.geojson"),
    '{"type":"FeatureCollection","features":[]}\n'
  );
  await writeFile(join(assetsDir, "boundaries.json"), "[]\n");
  await writeFile(
    join(assetsDir, "coastlines.geojson"),
    '{"type":"FeatureCollection","features":[]}\n'
  );

  const result = await ensureCountriesOnlyCompanionLayers(outDir, assetsDir);
  assert.deepEqual(result.copied.sort(), [
    "boundaries.json",
    "coastlines.geojson",
    "provinces.geojson"
  ]);
  assert.equal(await readFile(join(outDir, "boundaries.json"), "utf8"), "[]\n");
  await rm(root, { recursive: true, force: true });
});

test("ensureCountriesOnlyCompanionLayers fails when companions are absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "countries-only-missing-"));
  await assert.rejects(
    () => ensureCountriesOnlyCompanionLayers(join(root, "out"), join(root, "assets")),
    /Missing: provinces\.geojson, boundaries\.json, coastlines\.geojson/
  );
  await rm(root, { recursive: true, force: true });
});
