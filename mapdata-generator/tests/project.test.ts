import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
