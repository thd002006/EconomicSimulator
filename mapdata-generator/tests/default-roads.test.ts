import assert from "node:assert/strict";
import test from "node:test";
import type { GeoJsonGeometry } from "@economic-simulator/map-runtime";
import {
  ProvinceIndex,
  buildGeneratedRoadSegments,
  parseArgs,
  railwayFeatureFactor,
  scoreLineFeatures,
  type ProvinceHit
} from "../src/generate-default-roads.js";
import type { AreaGeometry } from "../src/types.js";

function rectangle(minLon: number, maxLon: number): AreaGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [minLon, 0],
        [maxLon, 0],
        [maxLon, 0.1],
        [minLon, 0.1],
        [minLon, 0]
      ]
    ]
  };
}

function province(id: string, minLon: number, maxLon: number): ProvinceHit {
  return { id, geometry: rectangle(minLon, maxLon), bbox: [minLon, 0, maxLon, 0.1] };
}

function railroad(coordinates: unknown, featurecla: unknown = "Railroad", scalerank = 4) {
  return {
    type: "Feature",
    properties: { featurecla, scalerank },
    geometry: { type: "LineString", coordinates }
  };
}

function scoreRailways(
  features: readonly unknown[],
  provinces: readonly ProvinceHit[],
  adjacency: ReadonlySet<string> = new Set()
) {
  const scores = new Map<string, number>();
  const bridgePairs = new Set<string>();
  const geometryById = new Map<string, GeoJsonGeometry>(
    provinces.map((item) => [item.id, item.geometry])
  );
  const stats = scoreLineFeatures(
    features,
    railwayFeatureFactor,
    new ProvinceIndex(provinces),
    adjacency,
    geometryById,
    scores,
    bridgePairs
  );
  return { scores, bridgePairs, stats };
}

test("railway threshold argument defaults to 2.5 and accepts an override", () => {
  assert.equal(parseArgs([]).railwayThreshold, 2.5);
  assert.equal(parseArgs(["--railway-threshold", "3.25"]).railwayThreshold, 3.25);
  assert.throws(() => parseArgs(["--railway-threshold=-1"]), /Invalid arguments/);
});

test("global and North American railroad evidence accumulates into one railway segment", () => {
  const provinces = [province("AA-A", 0, 0.1), province("AA-B", 0.1, 0.2)];
  const adjacency = new Set(["AA-A|AA-B"]);
  const scores = new Map<string, number>();
  const bridges = new Set<string>();
  const index = new ProvinceIndex(provinces);
  const geometries = new Map<string, GeoJsonGeometry>(
    provinces.map((item) => [item.id, item.geometry])
  );
  const feature = railroad([
    [0.05, 0.05],
    [0.15, 0.05]
  ]);

  scoreLineFeatures([feature], railwayFeatureFactor, index, adjacency, geometries, scores, bridges);
  const scoreFromGlobal = scores.get("AA-A|AA-B")!;
  scoreLineFeatures([feature], railwayFeatureFactor, index, adjacency, geometries, scores, bridges);

  assert.ok(scores.get("AA-A|AA-B")! > scoreFromGlobal);
  assert.deepEqual(buildGeneratedRoadSegments(new Map(), scores, 8, 2.5, 2.5), [
    {
      id: "road-rail-AA-A-AA-B",
      typeId: "railway",
      provinceIdA: "AA-A",
      provinceIdB: "AA-B"
    }
  ]);
});

test("railroad ferries, unknown classes, and invalid geometry are ignored", () => {
  const provinces = [province("AA-A", 0, 0.1), province("AA-B", 0.1, 0.2)];
  const result = scoreRailways(
    [
      railroad(
        [
          [0.05, 0.05],
          [0.15, 0.05]
        ],
        "Railroad ferry"
      ),
      railroad(
        [
          [0.05, 0.05],
          [0.15, 0.05]
        ],
        null
      ),
      railroad([
        [0.05, 0.05],
        [Number.NaN, 0.05]
      ])
    ],
    provinces,
    new Set(["AA-A|AA-B"])
  );

  assert.equal(result.scores.size, 0);
  assert.deepEqual(result.stats, {
    sampledFeatures: 0,
    skippedFerry: 1,
    skippedOther: 1,
    skippedInvalidGeometry: 1
  });
});

test("railway threshold is inclusive and railway can coexist with a road on one pair", () => {
  const segments = buildGeneratedRoadSegments(
    new Map([
      ["AA-A|AA-B", 8],
      ["AA-B|AA-C", 2.5]
    ]),
    new Map([
      ["AA-A|AA-B", 2.5],
      ["AA-B|AA-C", 2.49]
    ]),
    8,
    2.5,
    2.5
  );

  assert.deepEqual(
    segments.map((segment) => [segment.id, segment.typeId]),
    [
      ["road-hw-AA-A-AA-B", "highway"],
      ["road-local-AA-B-AA-C", "local_road"],
      ["road-rail-AA-A-AA-B", "railway"]
    ]
  );
});

test("cross-water railway evidence must fit the bridge span and avoid third provinces", () => {
  const valid = scoreRailways(
    [
      railroad([
        [0.05, 0.05],
        [0.2, 0.05]
      ])
    ],
    [province("AA-A", 0, 0.1), province("AA-B", 0.15, 0.25)]
  );
  assert.ok(valid.scores.has("AA-A|AA-B"));
  assert.ok(valid.bridgePairs.has("AA-A|AA-B"));

  const tooFar = scoreRailways(
    [
      railroad([
        [0.05, 0.05],
        [0.35, 0.05]
      ])
    ],
    [province("AA-A", 0, 0.1), province("AA-B", 0.3, 0.4)]
  );
  assert.equal(tooFar.scores.size, 0);

  const crossesThirdProvince = scoreRailways(
    [
      railroad([
        [0.05, 0.05],
        [0.2, 0.05]
      ])
    ],
    [province("AA-A", 0, 0.1), province("AA-B", 0.15, 0.25), province("AA-C", 0.11, 0.12)]
  );
  assert.equal(crossesThirdProvince.scores.has("AA-A|AA-B"), false);
});
