import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import { determineMergedGroupNames } from "../editor/server-plugin.js";

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
  await writeFile(
    join(projectDir, "roads.json"),
    JSON.stringify({
      schemaVersion: 1,
      segments: [
        {
          id: "G1|G2:local_road",
          typeId: "local_road",
          provinceIdA: "G1",
          provinceIdB: "G2",
          bend: { controlPoints: [[2.5, 2.5]] }
        }
      ]
    })
  );

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
  const exportedRoads = JSON.parse(
    await readFile(join(result.outDir, "geometry/roads.json"), "utf8")
  ) as { segments: Array<{ bend?: { controlPoints: number[][] } }> };
  assert.deepEqual(exportedRoads.segments[0]!.bend?.controlPoints, [[2.5, 2.5]]);

  // Check that L2 project got classes generated
  const l2Classes = await readdir(join(projectDir, "provinces/P1/classes"));
  assert.ok(l2Classes.length > 0);

  // Check that L3 output got classes generated
  const l3Classes = await readdir(join(result.outDir, "provinces/G1/classes"));
  assert.ok(l3Classes.length > 0);

  // Check coreProvinceId for single member group
  const g1Csv = await readFile(join(result.outDir, "provinces/G1/province.csv"), "utf8");
  assert.ok(g1Csv.includes("core_province_id"));
  const g1Rows = g1Csv.trim().split("\n");
  const g1Headers = g1Rows[0]!.split(",");
  const g1Values = g1Rows[1]!.split(",");
  const coreIdx = g1Headers.indexOf("core_province_id");
  assert.equal(g1Values[coreIdx], "P1");

  await rm(tempRoot, { recursive: true, force: true });
});

test("exportProjectToL3L4 selects most populous member as coreProvinceId for merged groups", async () => {
  const { mkdtemp, rm, writeFile, mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { exportProjectToL3L4 } = await import("../src/export-map.js");

  const tempRoot = await mkdtemp(join(tmpdir(), "export-core-test-"));
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
        properties: { adm0A3: "AAA", name: "P1", nameEn: "P1" },
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
        properties: { adm0A3: "AAA", name: "P2", nameEn: "P2" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [1, 0],
              [2, 0],
              [2, 1],
              [1, 1],
              [1, 0]
            ]
          ]
        }
      },
      {
        type: "Feature",
        id: "P3",
        properties: { adm0A3: "AAA", name: "P3", nameEn: "P3" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [2, 0],
              [3, 0],
              [3, 1],
              [2, 1],
              [2, 0]
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
      pop: 5000, // Highest population
      male: 2500,
      female: 2500,
      age: singleYearAges(5000),
      education15Plus: { basic: 2000, secondary: 1500, tertiary: 1000, advanced: 500 },
      gdpPpp: 5000
    },
    P3: {
      pop: 2000,
      male: 1000,
      female: 1000,
      age: singleYearAges(2000),
      education15Plus: { basic: 800, secondary: 600, tertiary: 400, advanced: 200 },
      gdpPpp: 2000
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
      {
        id: "G_MERGED",
        countryId: "AAA",
        members: ["P1", "P2", "P3"],
        name: "Merged Group",
        nameEn: "Merged Group"
      }
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

  const mergedCsv = await readFile(join(result.outDir, "provinces/G_MERGED/province.csv"), "utf8");
  const mergedRows = mergedCsv.trim().split("\n");
  const headers = mergedRows[0]!.split(",");
  const values = mergedRows[1]!.split(",");
  const coreIdx = headers.indexOf("core_province_id");
  assert.equal(values[coreIdx], "P2"); // P2 has 5000 pop, so it is the core province

  const exportedGeo = JSON.parse(
    await readFile(join(result.outDir, "geometry/provinces.geojson"), "utf8")
  ) as {
    features: Array<{ id: string; properties: { coreProvinceId: string } }>;
  };
  assert.equal(exportedGeo.features[0]!.properties.coreProvinceId, "P2");

  await rm(tempRoot, { recursive: true, force: true });
});

test("determineMergedGroupNames selects only top 2 most populous groups for name concatenation", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "merge-names-test-"));
  const baseDir = join(tempRoot, "base");
  const projectDir = join(tempRoot, "project");
  await mkdir(baseDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });

  const demographics = {
    P1: { pop: 1000 },
    P2: { pop: 5000 },
    P3: { pop: 3000 },
    P4: { pop: 500 }
  };
  await writeFile(join(baseDir, "demographics.json"), JSON.stringify(demographics));

  const parts = [
    { id: "G1", members: ["P1"], name: "甲省", nameEn: "Province Alpha" },
    { id: "G2", members: ["P2"], name: "乙省", nameEn: "Province Beta" },
    { id: "G3", members: ["P3"], name: "丙省", nameEn: "Province Gamma" },
    { id: "G4", members: ["P4"], name: "丁省", nameEn: "Province Delta" }
  ];

  // 1. Merging all 4 groups: top 2 by pop are P2 (5000) and P3 (3000) -> "乙省–丙省"
  const result4 = await determineMergedGroupNames({
    projectDir,
    baseRoot: baseDir,
    parts,
    fallbackId: "TST-G123"
  });
  assert.equal(result4.name, "乙省–丙省");
  assert.equal(result4.nameEn, "Province Beta–Province Gamma");

  // 2. Custom name overrides concatenation
  const resultCustom = await determineMergedGroupNames({
    projectDir,
    baseRoot: baseDir,
    parts,
    customName: "自定义新省",
    customNameEn: "Custom New Province",
    fallbackId: "TST-G123"
  });
  assert.equal(resultCustom.name, "自定义新省");
  assert.equal(resultCustom.nameEn, "Custom New Province");

  // 3. Merging 2 groups: keeps both
  const result2 = await determineMergedGroupNames({
    projectDir,
    baseRoot: baseDir,
    parts: [parts[0]!, parts[3]!], // P1 (1000) and P4 (500)
    fallbackId: "TST-G123"
  });
  assert.equal(result2.name, "甲省–丁省");
  assert.equal(result2.nameEn, "Province Alpha–Province Delta");

  await rm(tempRoot, { recursive: true, force: true });
});
