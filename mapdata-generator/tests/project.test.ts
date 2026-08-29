import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  allocateMapId,
  identityGroupsFromIds,
  mergeGroups,
  splitGroupWithNames,
  validatePartition
} from "../src/project.js";

const singleYearAges = (population: number) =>
  Object.fromEntries(Array.from({ length: 101 }, (_, age) => [age, population / 101]));

test("validatePartition accepts a complete partition", () => {
  const groups = identityGroupsFromIds([
    { id: "A", countryId: "X", name: "A", nameEn: "A" },
    { id: "B", countryId: "X", name: "B", nameEn: "B" }
  ]);
  assert.deepEqual(validatePartition(groups, new Set(["A", "B"])), []);
});

test("mergeGroups and splitGroupWithNames round-trip members", () => {
  let groups = identityGroupsFromIds([
    { id: "A", countryId: "X", name: "A", nameEn: "A" },
    { id: "B", countryId: "X", name: "B", nameEn: "B" }
  ]);
  groups = mergeGroups(groups, ["A", "B"], { id: "X-G1", name: "AB", nameEn: "AB" });
  assert.equal(groups.length, 1);
  assert.deepEqual([...groups[0]!.members].sort(), ["A", "B"]);
  groups = splitGroupWithNames(
    groups,
    "X-G1",
    new Map([
      ["A", { name: "A", nameEn: "A" }],
      ["B", { name: "B", nameEn: "B" }]
    ])
  );
  assert.equal(groups.length, 2);
  assert.deepEqual(validatePartition(groups, new Set(["A", "B"])), []);
});

test("allocateMapId never returns an existing directory name", async () => {
  const root = await mkdtemp(join(tmpdir(), "maps-"));
  await mkdir(join(root, "world-modern"));
  await mkdir(join(root, "world-modern-2"));
  assert.equal(await allocateMapId(root, "world-modern"), "world-modern-3");
  assert.equal(await allocateMapId(root, "fresh-map"), "fresh-map");
});

test("exportProjectToL3L4 auto-generates missing L2 classes from L1 demographics", async () => {
  const { mkdtemp, rm, writeFile, mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { exportProjectToL3L4 } = await import("../src/export-map.js");

  const tempRoot = await mkdtemp(join(tmpdir(), "export-test-"));
  const genRoot = join(tempRoot, "mapdata-generator");
  const repoRoot = tempRoot;
  const baseDir = join(genRoot, "base/test-base");
  const projectDir = join(genRoot, "projects/test-project");

  await mkdir(join(baseDir, "geometry"), { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await mkdir(join(repoRoot, "assets/maps"), { recursive: true });

  const geojson = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "P1",
        properties: {
          adm0A3: "AAA",
          name: "P1",
          nameEn: "P1",
          capital: { coordinates: [2, 2], name: "Outside", nameEn: "Outside EN" }
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0]
            ]
          ]
        }
      },
      {
        type: "Feature",
        id: "P2",
        properties: {
          adm0A3: "AAA",
          name: "P2",
          nameEn: "P2",
          capital: { coordinates: [3.5, 3.5], name: "Inside", nameEn: "Inside EN" }
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [3, 3],
              [4, 3],
              [4, 4],
              [3, 4],
              [3, 3]
            ]
          ]
        }
      }
    ]
  };
  await writeFile(join(baseDir, "geometry/provinces.geojson"), JSON.stringify(geojson));
  await writeFile(join(baseDir, "countries.csv"), "id,name_en,name\nAAA,Country A,国家A\n");

  const demographics = {
    P1: {
      pop: 1000,
      male: 500,
      female: 500,
      age: singleYearAges(1000),
      education15Plus: { basic: 400, secondary: 300, tertiary: 200, advanced: 100 },
      gdpPpp: 1000
    },
    P2: {
      pop: 1000,
      male: 500,
      female: 500,
      age: singleYearAges(1000),
      education15Plus: { basic: 400, secondary: 300, tertiary: 200, advanced: 100 },
      gdpPpp: 1000
    }
  };
  await writeFile(join(baseDir, "demographics.json"), JSON.stringify(demographics));

  const projectMeta = {
    schemaVersion: 1,
    projectId: "test-project",
    baseMapId: "test-base",
    suggestedMapId: "test-export-map",
    name: "Test Project"
  };
  const projectGroups = {
    groups: [
      { id: "G1", countryId: "AAA", members: ["P1"], name: "Group 1", nameEn: "Group 1" },
      { id: "G2", countryId: "AAA", members: ["P2"], name: "Group 2", nameEn: "Group 2" }
    ]
  };
  await writeFile(join(projectDir, "project.json"), JSON.stringify(projectMeta));
  await writeFile(join(projectDir, "groups.json"), JSON.stringify(projectGroups));

  const result = await exportProjectToL3L4({
    generatorRoot: genRoot,
    repoRoot,
    projectId: "test-project",
    requestedMapId: "test-export-map",
    skipPublish: true
  });

  assert.equal(result.mapId, "test-export-map");
  assert.equal(result.provinceCount, 2);
  assert.deepEqual(await readdir(join(repoRoot, "assets/maps")), ["test-export-map"]);

  const exported = JSON.parse(
    await readFile(join(result.outDir, "geometry/provinces.geojson"), "utf8")
  ) as {
    features: Array<{
      id: string;
      properties: { capital: { coordinates: number[]; name: string; nameEn: string } };
    }>;
  };
  const repairedCapital = exported.features.find((feature) => feature.id === "G1")!.properties
    .capital;
  assert.notDeepEqual(repairedCapital.coordinates, [2, 2]);
  assert.equal(repairedCapital.name, "Outside");
  assert.equal(repairedCapital.nameEn, "Outside EN");
  assert.deepEqual(exported.features.find((feature) => feature.id === "G2")!.properties.capital, {
    coordinates: [3.5, 3.5],
    name: "Inside",
    nameEn: "Inside EN"
  });

  // Check that L2 project got classes generated
  const l2Classes = await readdir(join(projectDir, "provinces/P1/classes"));
  assert.ok(l2Classes.length > 0);

  // Check that L3 output got classes generated
  const l3Classes = await readdir(join(result.outDir, "provinces/G1/classes"));
  assert.ok(l3Classes.length > 0);

  await rm(tempRoot, { recursive: true, force: true });
});
