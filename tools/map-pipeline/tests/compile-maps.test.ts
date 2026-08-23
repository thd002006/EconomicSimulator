import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compilePack,
  LOD_TOLERANCES,
  polygonGeometryArea,
  simplifyGeometry
} from "../src/compile-maps.js";
import { signedRingArea } from "../src/simplify.js";
import type { GeoJsonGeometry, LonLat } from "@economic-simulator/map-runtime";
import { parseMapPackBundle } from "@economic-simulator/map-runtime";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

function polygon(coordinates: LonLat[]): Extract<GeoJsonGeometry, { type: "Polygon" }> {
  return { type: "Polygon", coordinates: [coordinates] };
}

async function createMapFixture(): Promise<{ sourceRoot: string; outputRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "economic-simulator-map-compile-"));
  temporaryDirectories.push(root);
  const sourceRoot = join(root, "source");
  const outputRoot = join(root, "output");
  const mapDirectory = join(sourceRoot, "test-map");
  await mkdir(mapDirectory, { recursive: true });
  await writeFile(
    join(mapDirectory, "map.json"),
    JSON.stringify({
      schemaVersion: 2,
      id: "test-map",
      version: "1.0.0",
      nameKey: "map.test",
      coordinateReferenceSystem: "EPSG:4326",
      layers: {
        provinces: "provinces.geojson",
        boundaries: "boundaries.json",
        coastlines: "coastlines.geojson"
      }
    }),
    "utf8"
  );
  await writeFile(
    join(mapDirectory, "provinces.geojson"),
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "tiny",
          properties: {
            name: "Tiny",
            capital: { coordinates: [0.005, 0.005], nameEn: "Tiny Capital" }
          },
          geometry: polygon([
            [0, 0],
            [0.01, 0],
            [0.012, 0.004],
            [0.01, 0.01],
            [0, 0.01],
            [0, 0]
          ])
        }
      ]
    }),
    "utf8"
  );
  await writeFile(
    join(mapDirectory, "boundaries.json"),
    JSON.stringify({ type: "BoundaryCollection", features: [] }),
    "utf8"
  );
  await writeFile(
    join(mapDirectory, "coastlines.geojson"),
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "coast",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [0.001, 0.005],
              [0.002, 0]
            ]
          }
        }
      ]
    }),
    "utf8"
  );
  return { sourceRoot, outputRoot };
}

async function readCompiledFiles(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const filename of (await readdir(directory)).sort()) {
    result[filename] = await readFile(join(directory, filename), "utf8");
  }
  return result;
}

describe("map compiler", () => {
  it("preserves area and winding while always retaining authored geometry as final LOD", () => {
    const source = polygon([
      [0, 0],
      [0.005, 0],
      [0.01, 0.001],
      [0.012, 0.006],
      [0.009, 0.01],
      [0, 0.008],
      [0, 0]
    ]);
    const simplified = simplifyGeometry(source, 0.12);
    const areaError =
      Math.abs(polygonGeometryArea(simplified) - polygonGeometryArea(source)) /
      polygonGeometryArea(source);
    expect(areaError).toBeLessThanOrEqual(0.1);
    expect(Math.sign(signedRingArea(simplified.coordinates[0]!))).toBe(
      Math.sign(signedRingArea(source.coordinates[0]!))
    );
    expect(simplifyGeometry(source, 0)).toEqual(source);
    expect(LOD_TOLERANCES.at(-1)).toBe(0);
  });

  it("produces byte-identical output for identical input", async () => {
    const { sourceRoot, outputRoot } = await createMapFixture();
    const entry = { id: "test-map", path: "test-map" };
    await compilePack(sourceRoot, outputRoot, entry);
    const compiledDirectory = join(outputRoot, "test-map", "compiled");
    const first = await readCompiledFiles(compiledDirectory);
    await compilePack(sourceRoot, outputRoot, entry);
    const second = await readCompiledFiles(compiledDirectory);
    expect(second).toEqual(first);

    const manifest = JSON.parse(second["map.json"]!) as {
      lodTolerances: number[];
      provenance: Record<string, unknown>;
    };
    expect(manifest.lodTolerances).toEqual([0.25, 0.08, 0]);
    expect(manifest.provenance).not.toHaveProperty("builtAt");

    const provinces = JSON.parse(second["provinces.json"]!) as {
      features: Array<{ lod: unknown[] }>;
    };
    expect(provinces.features[0]?.lod.at(-1)).toEqual(
      polygon([
        [0, 0],
        [0.01, 0],
        [0.012, 0.004],
        [0.01, 0.01],
        [0, 0.01],
        [0, 0]
      ])
    );

    const coastlines = JSON.parse(second["coastlines.json"]!) as {
      features: Array<{ coordinates: unknown }>;
    };
    expect(coastlines.features[0]?.coordinates).toEqual([
      [0, 0],
      [0.001, 0.005],
      [0.002, 0]
    ]);

    expect(() =>
      parseMapPackBundle({
        manifest,
        provinces,
        boundaries: JSON.parse(second["boundaries.json"]!),
        coastlines,
        spatialIndex: JSON.parse(second["spatial-index.json"]!)
      })
    ).not.toThrow();
  });
});
