import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compilePack,
  LOD_TOLERANCES,
  polygonGeometryArea,
  resolveTriangulatableLods,
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
  const geometryDir = join(mapDirectory, "geometry");
  const provinceDir = join(mapDirectory, "provinces", "tiny");
  await mkdir(geometryDir, { recursive: true });
  await mkdir(join(provinceDir, "classes"), { recursive: true });
  await mkdir(join(mapDirectory, "companies"), { recursive: true });
  await writeFile(
    join(mapDirectory, "map.json"),
    JSON.stringify({
      schemaVersion: 3,
      id: "test-map",
      version: "1.0.0",
      nameKey: "map.test",
      coordinateReferenceSystem: "EPSG:4326",
      layers: {
        provinces: "geometry/provinces.geojson",
        boundaries: "geometry/boundaries.json",
        coastlines: "geometry/coastlines.geojson",
        countries: "countries.csv",
        provincesDir: "provinces",
        companiesDir: "companies"
      }
    }),
    "utf8"
  );
  await writeFile(join(mapDirectory, "countries.csv"), "id,name_en,name\nUNK,Unknown,\n", "utf8");
  await writeFile(
    join(provinceDir, "province.csv"),
    [
      "id,name,name_en,owner_country_id,land_area_km2,arable_land_km2,cultivation_condition,habitability,terrain_profile_id,climate_profile_id",
      "tiny,Tiny,Tiny,UNK,1,0,0.5,0.5,temperate,temperate"
    ].join("\n") + "\n",
    "utf8"
  );
  await writeFile(
    join(provinceDir, "operating-units.csv"),
    "id,kind,industry_id,default_market_id,owner_company_id,owner_shares,operating_status,initial_cash_cents\n",
    "utf8"
  );
  await writeFile(
    join(geometryDir, "provinces.geojson"),
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "tiny",
          properties: {
            name: "Tiny",
            adm0A3: "UNK",
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
    join(geometryDir, "boundaries.json"),
    JSON.stringify({ type: "BoundaryCollection", features: [] }),
    "utf8"
  );
  await writeFile(
    join(geometryDir, "coastlines.geojson"),
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

async function readCompiledFiles(directory: string): Promise<Record<string, Uint8Array>> {
  const result: Record<string, Uint8Array> = {};
  for (const filename of (await readdir(directory)).sort()) {
    result[filename] = await readFile(join(directory, filename));
  }
  return result;
}

function jsonFile(files: Record<string, Uint8Array>, filename: string): unknown {
  return JSON.parse(new TextDecoder().decode(files[filename])) as unknown;
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

  it("falls back to a later LOD when coarser triangulation exceeds deviation", () => {
    const invalid = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0]
        ],
        [
          [12, 0],
          [20, 0],
          [20, 10],
          [12, 10],
          [12, 0]
        ]
      ]
    };
    const valid = polygon([
      [0, 0],
      [8, 0],
      [8, 8],
      [0, 8],
      [0, 0]
    ]);
    expect(resolveTriangulatableLods("fallback", [invalid, invalid, valid])).toEqual([
      valid,
      valid,
      valid
    ]);
    expect(() => resolveTriangulatableLods("fallback", [invalid, invalid, invalid])).toThrow(
      /deviation/
    );
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

    const manifest = jsonFile(second, "map.json") as {
      lodTolerances: number[];
      provenance: Record<string, unknown>;
    };
    expect(manifest.lodTolerances).toEqual([0.25, 0.08, 0]);
    expect(manifest.provenance).not.toHaveProperty("builtAt");

    const provinces = jsonFile(second, "provinces.json") as {
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

    const coastlines = jsonFile(second, "coastlines.json") as {
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
        boundaries: jsonFile(second, "boundaries.json"),
        coastlines,
        spatialIndex: jsonFile(second, "spatial-index.json"),
        globeMeshMetadata: jsonFile(second, "globe-mesh.json"),
        globeMeshBuffers: [0, 1, 2].map((index) => {
          const bytes = second[`globe-lod-${index}.bin`]!;
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer;
        })
      })
    ).not.toThrow();
  });
});
