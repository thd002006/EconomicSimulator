import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveContainedFile } from "../src/path-safety.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function fixture(): Promise<{ root: string; map: string; outside: string }> {
  const root = await mkdtemp(join(tmpdir(), "economic-simulator-map-paths-"));
  temporaryDirectories.push(root);
  const map = join(root, "map");
  const outside = join(root, "outside.json");
  await mkdir(map);
  await writeFile(join(map, "inside.json"), "{}", "utf8");
  await writeFile(outside, "{}", "utf8");
  return { root, map, outside };
}

describe("map layer path containment", () => {
  it("accepts a file inside the map directory", async () => {
    const { map } = await fixture();
    await expect(resolveContainedFile(map, "inside.json", "layer")).resolves.toBe(
      join(map, "inside.json")
    );
  });

  it("rejects traversal and absolute paths", async () => {
    const { map, outside } = await fixture();
    await expect(resolveContainedFile(map, "../outside.json", "layer")).rejects.toThrow(
      "escapes its map directory"
    );
    await expect(resolveContainedFile(map, outside, "layer")).rejects.toThrow(
      "must be a non-empty relative path"
    );
  });

  it("rejects a symlink that resolves outside the map directory when supported", async () => {
    const { map, outside } = await fixture();
    try {
      await symlink(outside, join(map, "linked.json"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await expect(resolveContainedFile(map, "linked.json", "layer")).rejects.toThrow(
      "escapes its map directory"
    );
  });
});
