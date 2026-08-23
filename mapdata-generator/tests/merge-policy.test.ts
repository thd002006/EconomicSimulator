import assert from "node:assert/strict";
import test from "node:test";
import { buildMergeGroups, parseRetainedFraction } from "../src/build-world-modern.js";
import { geometryGapKm, interiorPoint, pointInGeometry } from "../src/geo.js";
import { dynamicMinimumProvinceAreaKm2, type MergeParameters } from "../src/merge-policy.js";
import type { SourceProvince } from "../src/types.js";
import type { AdjacencyData } from "../src/topology.js";

const parameters: MergeParameters = {
  baseMinimumProvinceAreaKm2: 10_000,
  maximumMinimumProvinceAreaKm2: 100_000,
  fullScaleCountryAreaKm2: 1_000_000,
  macroRegionCountryAreaLimitKm2: 5_000_000,
  maximumArchipelagoGapKm: 700,
  defaultRetainedArcFraction: 0.5
};

function province(
  index: number,
  areaKm2: number,
  options: { countryId?: string; x?: number; region?: string } = {}
): SourceProvince {
  const x = options.x ?? index;
  return {
    index,
    id: `T-${index}`,
    countryId: options.countryId ?? "TST",
    name: `Province ${index}`,
    nameEn: `Province ${index}`,
    ...(options.region === undefined ? {} : { region: options.region }),
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x, 0],
          [x + 0.1, 0],
          [x + 0.1, 0.1],
          [x, 0.1],
          [x, 0]
        ]
      ]
    },
    areaKm2,
    center: [x + 0.05, 0.05]
  };
}

function adjacency(
  count: number,
  pairs: ReadonlyArray<readonly [number, number, number]> = [],
  exposed = Array.from({ length: count }, () => true)
): AdjacencyData {
  const neighbors = Array.from({ length: count }, () => new Set<number>());
  const sharedBorder = new Map<string, number>();
  for (const [a, b, border] of pairs) {
    neighbors[a]!.add(b);
    neighbors[b]!.add(a);
    sharedBorder.set(a < b ? `${a}:${b}` : `${b}:${a}`, border);
  }
  return { neighbors, sharedBorder, exposedBoundary: exposed };
}

test("dynamic minimum province area scales linearly and caps at 100,000 km2", () => {
  assert.equal(dynamicMinimumProvinceAreaKm2(0, parameters), 10_000);
  assert.equal(dynamicMinimumProvinceAreaKm2(100_000, parameters), 19_000);
  assert.equal(dynamicMinimumProvinceAreaKm2(500_000, parameters), 55_000);
  assert.equal(dynamicMinimumProvinceAreaKm2(1_000_000, parameters), 100_000);
  assert.equal(dynamicMinimumProvinceAreaKm2(2_000_000, parameters), 100_000);
});

test("simplification retention accepts fractions and percentages", () => {
  assert.equal(parseRetainedFraction([]), 0.5);
  assert.equal(parseRetainedFraction([], 0.6), 0.6);
  assert.equal(parseRetainedFraction(["--retain", "0.35"]), 0.35);
  assert.equal(parseRetainedFraction(["--retain=50%"]), 0.5);
  assert.equal(parseRetainedFraction(["--retained-fraction", "1"]), 1);
  assert.throws(() => parseRetainedFraction(["--retain", "0"]), /must be in/);
  assert.throws(() => parseRetainedFraction(["--retain=101%"]), /must be in/);
  assert.throws(() => parseRetainedFraction(["--unknown", "0.5"]), /Unknown/);
});

test("area merging absorbs the smallest province only through a shared line", () => {
  const provinces = [province(0, 1_000), province(1, 40_000), province(2, 40_000)];
  const groups = buildMergeGroups(
    provinces,
    adjacency(3, [
      [0, 1, 100],
      [1, 2, 100]
    ]),
    parameters
  );
  assert.equal(groups.length, 2);
  assert.ok(
    groups.some((group) => group.memberIndices.includes(0) && group.memberIndices.includes(1))
  );
  const merged = groups.find(
    (group) => group.memberIndices.includes(0) && group.memberIndices.includes(1)
  );
  assert.equal(merged?.name, "Province 0–Province 1");
  assert.equal(merged?.nameEn, "Province 0–Province 1");
});

test("a same-country province fully enclosed by one province merges regardless of area", () => {
  const provinces = [province(0, 100_000), province(1, 100_000)];
  const groups = buildMergeGroups(
    provinces,
    adjacency(2, [[0, 1, 100]], [false, true]),
    parameters
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.method, "enclosure-merge");
});

test("nested same-country enclosures are merged to a fixed point", () => {
  const provinces = [province(0, 60_000), province(1, 60_000), province(2, 60_000)];
  const groups = buildMergeGroups(
    provinces,
    adjacency(
      3,
      [
        [0, 1, 100],
        [1, 2, 100]
      ],
      [false, false, true]
    ),
    parameters
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.memberIndices, [0, 1, 2]);
});

test("foreign borders and point-only contacts never merge", () => {
  const provinces = [
    province(0, 1_000, { countryId: "AAA" }),
    province(1, 1_000, { countryId: "BBB" })
  ];
  const groups = buildMergeGroups(
    provinces,
    adjacency(2, [[0, 1, 100]], [false, true]),
    parameters
  );
  assert.equal(groups.length, 2);
  assert.ok(groups.every((group) => group.memberIndices.length === 1));
});

test("official macroregions are split when their members have no shared line", () => {
  const provinces = [
    province(0, 60_000, { region: "North" }),
    province(1, 60_000, { region: "North" }),
    province(2, 60_000, { region: "South" })
  ];
  const groups = buildMergeGroups(provinces, adjacency(3), parameters);
  assert.equal(groups.length, 3);
});

test("official macroregions apply at 5 million km2 and are skipped above it", () => {
  const pairs = [
    [0, 1, 100],
    [2, 3, 100]
  ] as const;
  const regions = ["North", "North", "South", "South"] as const;
  const atLimit = regions.map((region, index) => province(index, 1_250_000, { region }));
  const overLimit = regions.map((region, index) => province(index, 1_500_000, { region }));

  const grouped = buildMergeGroups(atLimit, adjacency(4, pairs), parameters);
  assert.equal(grouped.length, 2);
  assert.ok(grouped.every((group) => group.method === "official-region"));

  const retained = buildMergeGroups(overLimit, adjacency(4, pairs), parameters);
  assert.equal(retained.length, 4);
  assert.ok(retained.every((group) => group.method === "retained"));
});

test("merged official macroregions concatenate macroregion names instead of province names", () => {
  const provinces = [
    province(0, 1_000, { region: "North" }),
    province(1, 1_000, { region: "North" }),
    province(2, 1_000, { region: "South" }),
    province(3, 1_000, { region: "South" })
  ];
  const groups = buildMergeGroups(
    provinces,
    adjacency(4, [
      [0, 1, 100],
      [1, 2, 100],
      [2, 3, 100]
    ]),
    parameters
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.name, "North–South");
  assert.equal(groups[0]!.nameEn, "North–South");
});

test("archipelago gap uses polygon edges and obeys the 700 km limit", () => {
  const gapDegrees = 699 / 111.195;
  const near = [province(0, 10_000, { x: 0 }), province(1, 10_000, { x: 0.1 + gapDegrees })];
  const nearGap = geometryGapKm(near[0]!.geometry, near[1]!.geometry);
  assert.ok(Math.abs(nearGap - 699) < 0.5);
  assert.equal(buildMergeGroups(near, adjacency(2), parameters).length, 1);

  const farGapDegrees = 701 / 111.195;
  const far = [province(0, 10_000, { x: 0 }), province(1, 10_000, { x: 0.1 + farGapDegrees })];
  assert.ok(geometryGapKm(far[0]!.geometry, far[1]!.geometry) > 700);
  assert.equal(buildMergeGroups(far, adjacency(2), parameters).length, 2);
});

test("generated fallback capital is inside a polygon with a hole", () => {
  const geometry = {
    type: "Polygon" as const,
    coordinates: [
      [[0, 0] as const, [10, 0] as const, [10, 10] as const, [0, 10] as const, [0, 0] as const],
      [[4, 4] as const, [6, 4] as const, [6, 6] as const, [4, 6] as const, [4, 4] as const]
    ]
  };
  assert.equal(pointInGeometry(interiorPoint(geometry), geometry), true);
});
