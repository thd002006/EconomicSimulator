import { describe, expect, it } from "vitest";
import {
  MapSchemaError,
  adjacencyPairKey,
  buildAdjacencyPairSet,
  buildRoadDrawBatches,
  buildRoadPairRoutes,
  buildRoadRibbonMesh,
  getRoadTypeDefinition,
  parseRoadCollection,
  parseRuntimeRoadCollection,
  provincePairHasRoutableBridge,
  roadSegmentKey,
  ROAD_STYLE_MAP_SCALE,
  sampleRoadSegmentCurve,
  segmentUsesValidBridgeSpan
} from "../src/index.js";
import type { GeoJsonGeometry, MapBoundary, RoadSegment } from "../src/index.js";

const boundaries: MapBoundary[] = [
  {
    id: "b1",
    leftProvinceId: "A",
    rightProvinceId: "B",
    coordinates: [
      [1, 0],
      [1, 1]
    ]
  },
  {
    id: "b2",
    leftProvinceId: "B",
    rightProvinceId: "C",
    coordinates: [
      [2, 0],
      [2, 1]
    ]
  }
];

function assertEdgesInUnion(
  curve: readonly (readonly [number, number])[],
  inUnion: (lon: number, lat: number) => boolean
): void {
  for (let i = 0; i < curve.length - 1; i += 1) {
    const a = curve[i]!;
    const b = curve[i + 1]!;
    for (const t of [0, 0.5, 1]) {
      const lon = a[0] + (b[0] - a[0]) * t;
      const lat = a[1] + (b[1] - a[1]) * t;
      expect(inUnion(lon, lat)).toBe(true);
    }
  }
}

function rectangle(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number
): Extract<GeoJsonGeometry, { type: "Polygon" }> {
  return {
    type: "Polygon",
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat]
      ]
    ]
  };
}

describe("parseRoadCollection", () => {
  it("returns empty collection for undefined input", () => {
    expect(parseRoadCollection(undefined).segments).toEqual([]);
  });

  it("normalizes province order and rejects duplicates", () => {
    const parsed = parseRoadCollection({
      schemaVersion: 1,
      segments: [
        {
          id: "r1",
          typeId: "highway",
          provinceIdA: "B",
          provinceIdB: "A"
        }
      ]
    });
    expect(parsed.segments[0]).toMatchObject({
      provinceIdA: "A",
      provinceIdB: "B",
      typeId: "highway"
    });
    expect(roadSegmentKey("highway", "B", "A")).toBe("highway|A|B");

    expect(() =>
      parseRoadCollection({
        schemaVersion: 1,
        segments: [
          { id: "r1", typeId: "highway", provinceIdA: "A", provinceIdB: "B" },
          { id: "r2", typeId: "highway", provinceIdA: "B", provinceIdB: "A" }
        ]
      })
    ).toThrow(MapSchemaError);
  });

  it("rejects unknown type, non-adjacent pairs, and invalid bends", () => {
    expect(() =>
      parseRoadCollection({
        schemaVersion: 1,
        segments: [{ id: "r1", typeId: "canal", provinceIdA: "A", provinceIdB: "B" }]
      })
    ).toThrow(/ROAD_TYPE_UNKNOWN/);

    expect(() =>
      parseRoadCollection(
        {
          schemaVersion: 1,
          segments: [{ id: "r1", typeId: "highway", provinceIdA: "A", provinceIdB: "C" }]
        },
        {
          provinceIds: new Set(["A", "B", "C"]),
          adjacencyPairs: buildAdjacencyPairSet(boundaries),
          capitals: new Map([
            ["A", [0.5, 0.5]],
            ["B", [1.5, 0.5]],
            ["C", [2.5, 0.5]]
          ])
        }
      )
    ).toThrow(/ROAD_NOT_ADJACENT/);

    expect(() =>
      parseRoadCollection({
        schemaVersion: 1,
        segments: [
          {
            id: "r1",
            typeId: "highway",
            provinceIdA: "A",
            provinceIdB: "B",
            bend: { controlPoints: [] }
          }
        ]
      })
    ).toThrow(/ROAD_BEND_INVALID/);
  });
});

describe("compiled road routes", () => {
  it("requires exactly one route for every referenced province pair", () => {
    const context = {
      provinceIds: new Set(["A", "B"]),
      adjacencyPairs: new Set(["A|B"]),
      capitals: new Map<string, readonly [number, number]>([
        ["A", [0.5, 0.5]],
        ["B", [1.5, 0.5]]
      ])
    };
    expect(() =>
      parseRuntimeRoadCollection(
        {
          schemaVersion: 2,
          routeInputHash: "hash",
          segments: [{ id: "h", typeId: "highway", provinceIdA: "A", provinceIdB: "B" }],
          pairRoutes: []
        },
        context
      )
    ).toThrow(/ROAD_ROUTE_MISSING/);
    expect(() =>
      parseRuntimeRoadCollection(
        {
          schemaVersion: 1,
          segments: []
        },
        context
      )
    ).toThrow(/map:publish/);
  });

  it("does not let compiled route metadata authorize a non-adjacent road", () => {
    const context = {
      provinceIds: new Set(["A", "B"]),
      adjacencyPairs: new Set<string>(),
      capitals: new Map<string, readonly [number, number]>([
        ["A", [0.5, 0.5]],
        ["B", [2, 0.5]]
      ])
    };
    const segment = { id: "h", typeId: "highway", provinceIdA: "A", provinceIdB: "B" };
    expect(() =>
      parseRuntimeRoadCollection(
        {
          schemaVersion: 2,
          routeInputHash: "hash",
          segments: [segment],
          pairRoutes: [
            {
              provinceIdA: "A",
              provinceIdB: "B",
              mode: "bridge-shortest",
              coordinates: [
                [0.5, 0.5],
                [2, 0.5]
              ]
            }
          ]
        },
        { ...context, adjacencyPairs: new Set(["A|B"]) }
      )
    ).toThrow(/ROAD_ROUTE_BRIDGE_SEGMENTS_MISSING/);
    expect(() =>
      parseRuntimeRoadCollection(
        {
          schemaVersion: 2,
          routeInputHash: "hash",
          segments: [segment],
          pairRoutes: [
            {
              provinceIdA: "A",
              provinceIdB: "B",
              mode: "bridge-shortest",
              coordinates: [
                [0.5, 0.5],
                [2, 0.5]
              ],
              bridgeSegments: [0]
            }
          ]
        },
        context
      )
    ).toThrow(/ROAD_NOT_ADJACENT/);
    expect(() =>
      parseRuntimeRoadCollection(
        {
          schemaVersion: 2,
          routeInputHash: "hash",
          segments: [segment],
          pairRoutes: [
            {
              provinceIdA: "A",
              provinceIdB: "B",
              mode: "union-shortest",
              coordinates: [
                [0.5, 0.5],
                [2, 0.5]
              ],
              bridgeSegments: [0]
            }
          ]
        },
        { ...context, adjacencyPairs: new Set(["A|B"]) }
      )
    ).toThrow(/ROAD_ROUTE_BRIDGE_SEGMENTS_UNEXPECTED/);
    for (const mode of ["union-shortest", "straight-fallback", "bend"] as const) {
      expect(() =>
        parseRuntimeRoadCollection(
          {
            schemaVersion: 2,
            routeInputHash: "hash",
            segments: [segment],
            pairRoutes: [
              {
                provinceIdA: "A",
                provinceIdB: "B",
                mode,
                coordinates: [
                  [0.5, 0.5],
                  [2, 0.5]
                ]
              }
            ]
          },
          context
        )
      ).toThrow(/ROAD_NOT_ADJACENT/);
    }

    const parsed = parseRuntimeRoadCollection(
      {
        schemaVersion: 2,
        routeInputHash: "hash",
        segments: [segment],
        pairRoutes: [
          {
            provinceIdA: "B",
            provinceIdB: "A",
            mode: "bridge-shortest",
            coordinates: [
              [2, 0.5],
              [1.5, 0.5],
              [1, 0.5],
              [0.5, 0.5]
            ],
            bridgeSegments: [0]
          }
        ]
      },
      { ...context, adjacencyPairs: new Set(["A|B"]) }
    );
    expect(parsed.pairRoutes[0]!.coordinates).toEqual([
      [0.5, 0.5],
      [1, 0.5],
      [1.5, 0.5],
      [2, 0.5]
    ]);
    expect(parsed.pairRoutes[0]!.bridgeSegments).toEqual([2]);
  });

  it("validates the actual bridge polyline instead of trusting its metadata", () => {
    const geometryA = rectangle(0, 0, 1, 1);
    const geometryB = rectangle(1.1, 0, 2.1, 1);
    const context = {
      provinceIds: new Set(["A", "B"]),
      adjacencyPairs: new Set<string>(),
      capitals: new Map<string, readonly [number, number]>([
        ["A", [0.5, 0.5]],
        ["B", [1.6, 0.5]]
      ]),
      provinceGeometryById: new Map([
        ["A", geometryA],
        ["B", geometryB]
      ])
    };
    const segment = { id: "h", typeId: "highway", provinceIdA: "A", provinceIdB: "B" };
    expect(
      parseRuntimeRoadCollection(
        {
          schemaVersion: 2,
          routeInputHash: "hash",
          segments: [segment],
          pairRoutes: [
            {
              provinceIdA: "A",
              provinceIdB: "B",
              mode: "bridge-shortest",
              coordinates: [
                [0.5, 0.5],
                [1.6, 0.5]
              ],
              bridgeSegments: [0]
            }
          ]
        },
        context
      ).pairRoutes[0]
    ).toMatchObject({ mode: "bridge-shortest", bridgeSegments: [0] });
    expect(() =>
      parseRuntimeRoadCollection(
        {
          schemaVersion: 2,
          routeInputHash: "hash",
          segments: [segment],
          pairRoutes: [
            {
              provinceIdA: "A",
              provinceIdB: "B",
              mode: "bridge-shortest",
              coordinates: [
                [0.5, 0.5],
                [1.05, 2],
                [1.6, 0.5]
              ],
              bridgeSegments: [0, 1]
            }
          ]
        },
        context
      )
    ).toThrow(/ROAD_ROUTE_GEOMETRY_INVALID/);
  });

  it("bridges water spans up to 20 km and rejects wider gaps", () => {
    const segment: RoadSegment = {
      id: "h",
      typeId: "highway",
      provinceIdA: "A",
      provinceIdB: "B"
    };
    const geometryA = rectangle(0, 0, 1, 1);
    const geometryB = rectangle(1.1, 0, 2.1, 1);
    const geometryById = new Map([
      ["A", geometryA],
      ["B", geometryB]
    ]);
    const routes = buildRoadPairRoutes([segment], {
      capitals: new Map([
        ["A", [0.5, 0.5] as const],
        ["B", [1.6, 0.5] as const]
      ]),
      provinceGeometryById: geometryById
    });
    expect(routes[0]).toMatchObject({ mode: "bridge-shortest", bridgeSegments: [0] });
    expect(routes[0]!.coordinates).toEqual([
      [0.5, 0.5],
      [1.6, 0.5]
    ]);
    expect(
      provincePairHasRoutableBridge(
        "A",
        "B",
        geometryA,
        geometryB,
        geometryById,
        [0.5, 0.5],
        [1.6, 0.5]
      )
    ).toBe(true);
    expect(segmentUsesValidBridgeSpan([0.5, 0.5], [1.6, 0.5], "A", "B", geometryById)).toBe(true);

    const wideGeometryB = rectangle(1.25, 0, 2.25, 1);
    const wideGeometryById = new Map([
      ["A", geometryA],
      ["B", wideGeometryB]
    ]);
    const warnings: string[] = [];
    const wideRoutes = buildRoadPairRoutes([segment], {
      capitals: new Map([
        ["A", [0.5, 0.5] as const],
        ["B", [1.75, 0.5] as const]
      ]),
      provinceGeometryById: wideGeometryById,
      onWarning: (warning) => warnings.push(warning)
    });
    expect(wideRoutes[0]!.mode).toBe("straight-fallback");
    expect(wideRoutes[0]!.bridgeSegments).toBeUndefined();
    expect(warnings[0]).toMatch(/ROAD_ROUTE_UNREACHABLE_FALLBACK/);
    expect(
      provincePairHasRoutableBridge(
        "A",
        "B",
        geometryA,
        wideGeometryB,
        wideGeometryById,
        [0.5, 0.5],
        [1.75, 0.5]
      )
    ).toBe(false);
  });

  it("uses a short bridge across a bay instead of taking the long land detour", () => {
    const geometryA: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 0.1],
          [0.9, 0.1],
          [0.9, 1],
          [0, 1],
          [0, 0]
        ]
      ]
    };
    const geometryB: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [1, 0],
          [2, 0],
          [2, 1],
          [1.05, 1],
          [1.05, 0.1],
          [1, 0.1],
          [1, 0]
        ]
      ]
    };
    const routes = buildRoadPairRoutes(
      [{ id: "h", typeId: "highway", provinceIdA: "A", provinceIdB: "B" }],
      {
        capitals: new Map([
          ["A", [0.4, 0.75] as const],
          ["B", [1.6, 0.75] as const]
        ]),
        provinceGeometryById: new Map([
          ["A", geometryA],
          ["B", geometryB]
        ])
      }
    );
    expect(routes[0]!.mode).toBe("bridge-shortest");
    expect(routes[0]!.coordinates).toEqual([
      [0.4, 0.75],
      [1.6, 0.75]
    ]);
  });

  it("does not bridge through a third province", () => {
    const geometryA = rectangle(0, 0, 1, 1);
    const geometryB = rectangle(1.1, 0, 2.1, 1);
    const geometryC = rectangle(1.02, -1, 1.08, 2);
    const geometryById = new Map([
      ["A", geometryA],
      ["B", geometryB],
      ["C", geometryC]
    ]);
    expect(segmentUsesValidBridgeSpan([0.5, 0.5], [1.6, 0.5], "A", "B", geometryById)).toBe(false);
    expect(
      provincePairHasRoutableBridge(
        "A",
        "B",
        geometryA,
        geometryB,
        geometryById,
        [0.5, 0.5],
        [1.6, 0.5]
      )
    ).toBe(false);
    const routes = buildRoadPairRoutes(
      [{ id: "h", typeId: "highway", provinceIdA: "A", provinceIdB: "B" }],
      {
        capitals: new Map([
          ["A", [0.5, 0.5] as const],
          ["B", [1.6, 0.5] as const]
        ]),
        provinceGeometryById: geometryById
      }
    );
    expect(routes[0]!.mode).toBe("straight-fallback");

    const splitA: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [...rectangle(0, 0, 1, 1).coordinates],
        [...rectangle(1.1, 0, 2.1, 1).coordinates]
      ]
    };
    const farB = rectangle(10, 0, 11, 1);
    const farGeometryById = new Map<string, GeoJsonGeometry>([
      ["A", splitA],
      ["B", farB]
    ]);
    expect(
      provincePairHasRoutableBridge(
        "A",
        "B",
        splitA,
        farB,
        farGeometryById,
        [0.5, 0.5],
        [10.5, 0.5]
      )
    ).toBe(false);

    const satelliteNearB: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [[...rectangle(0, 0, 1, 1).coordinates], [...rectangle(9, 0, 10, 1).coordinates]]
    };
    const nearSatelliteGeometryById = new Map<string, GeoJsonGeometry>([
      ["A", satelliteNearB],
      ["B", rectangle(10.1, 0, 11.1, 1)]
    ]);
    expect(
      provincePairHasRoutableBridge(
        "A",
        "B",
        satelliteNearB,
        nearSatelliteGeometryById.get("B")!,
        nearSatelliteGeometryById,
        [0.5, 0.5],
        [10.6, 0.5]
      )
    ).toBe(false);
  });

  it("precomputes one route per pair and packs road edges in fixed map units", () => {
    const segments: RoadSegment[] = [
      { id: "h", typeId: "highway", provinceIdA: "A", provinceIdB: "B" },
      { id: "l", typeId: "local_road", provinceIdA: "A", provinceIdB: "B" }
    ];
    const capitals = new Map<string, readonly [number, number]>([
      ["A", [0.5, 0.5]],
      ["B", [1.5, 0.5]]
    ]);
    const routes = buildRoadPairRoutes(segments, { capitals });
    expect(routes).toHaveLength(1);

    const single = buildRoadDrawBatches([segments[1]!], { pairRoutes: routes });
    expect(single[0]!.polylines[0]).toEqual([
      [0.5, 0.5],
      [1.5, 0.5]
    ]);

    const multiple = buildRoadDrawBatches(segments, { pairRoutes: routes });
    const highway = multiple.find((batch) => batch.typeId === "highway")!.polylines[0]!;
    const local = multiple.find((batch) => batch.typeId === "local_road")!.polylines[0]!;
    expect(highway).toHaveLength(4);
    expect(local).toHaveLength(4);
    expect(highway[1]![1]).toBeCloseTo(0.5 + 2.1 * ROAD_STYLE_MAP_SCALE, 9);
    expect(local[1]![1]).toBeCloseTo(0.5 - 2.8 * ROAD_STYLE_MAP_SCALE, 9);
    const centerDistanceStyleUnits = (highway[1]![1] - local[1]![1]) / ROAD_STYLE_MAP_SCALE;
    const edgeGapStyleUnits = centerDistanceStyleUnits - (4.2 + 2.8) / 2;
    expect(edgeGapStyleUnits).toBeCloseTo(1.4, 9);
  });

  it("rejects conflicting pair bends and marks disconnected unions as fallback", () => {
    const capitals = new Map<string, readonly [number, number]>([
      ["A", [0.5, 0.5]],
      ["B", [3.5, 0.5]]
    ]);
    expect(() =>
      buildRoadPairRoutes(
        [
          {
            id: "h",
            typeId: "highway",
            provinceIdA: "A",
            provinceIdB: "B",
            bend: { controlPoints: [[1, 0.5]] }
          },
          {
            id: "l",
            typeId: "local_road",
            provinceIdA: "A",
            provinceIdB: "B",
            bend: { controlPoints: [[2, 0.5]] }
          }
        ],
        { capitals }
      )
    ).toThrow(/ROAD_BEND_CONFLICT/);

    const warnings: string[] = [];
    const routes = buildRoadPairRoutes(
      [{ id: "h", typeId: "highway", provinceIdA: "A", provinceIdB: "B" }],
      {
        capitals,
        provinceGeometryById: new Map([
          [
            "A",
            {
              type: "Polygon" as const,
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
          ],
          [
            "B",
            {
              type: "Polygon" as const,
              coordinates: [
                [
                  [3, 0],
                  [4, 0],
                  [4, 1],
                  [3, 1],
                  [3, 0]
                ]
              ]
            }
          ]
        ]),
        onWarning: (warning) => warnings.push(warning)
      }
    );
    expect(routes[0]!.mode).toBe("straight-fallback");
    expect(warnings[0]).toMatch(/ROAD_ROUTE_UNREACHABLE_FALLBACK/);
  });

  it("rejects an authored bend that leaves the province union", () => {
    expect(() =>
      buildRoadPairRoutes(
        [
          {
            id: "h",
            typeId: "highway",
            provinceIdA: "A",
            provinceIdB: "B",
            bend: { controlPoints: [[1, 2]] }
          }
        ],
        {
          capitals: new Map([
            ["A", [0.5, 0.5] as const],
            ["B", [1.5, 0.5] as const]
          ]),
          provinceGeometryById: new Map([
            [
              "A",
              {
                type: "Polygon" as const,
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
            ],
            [
              "B",
              {
                type: "Polygon" as const,
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
            ]
          ])
        }
      )
    ).toThrow(/ROAD_BEND_OUTSIDE_UNION/);
  });

  it("rejects a bend whose continuous water crossing exceeds the bridge limit", () => {
    expect(() =>
      buildRoadPairRoutes(
        [
          {
            id: "h",
            typeId: "highway",
            provinceIdA: "A",
            provinceIdB: "B",
            bend: { controlPoints: [[1.15, 0.5]] }
          }
        ],
        {
          capitals: new Map([
            ["A", [0.5, 0.5] as const],
            ["B", [1.8, 0.5] as const]
          ]),
          provinceGeometryById: new Map([
            ["A", rectangle(0, 0, 1, 1)],
            ["B", rectangle(1.3, 0, 2.3, 1)]
          ])
        }
      )
    ).toThrow(/ROAD_BEND_OUTSIDE_UNION/);
  });

  it("routes around holes, selects the connected multipolygon component, and wraps the dateline", () => {
    const segment: RoadSegment = {
      id: "h",
      typeId: "highway",
      provinceIdA: "A",
      provinceIdB: "B"
    };
    const aroundHole = sampleRoadSegmentCurve(segment, [0.5, 1.5], [3.5, 1.5], {
      geometryA: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [3, 0],
            [3, 3],
            [0, 3],
            [0, 0]
          ],
          [
            [1, 1],
            [1, 2],
            [2, 2],
            [2, 1],
            [1, 1]
          ]
        ]
      },
      geometryB: {
        type: "Polygon",
        coordinates: [
          [
            [3, 0],
            [4, 0],
            [4, 3],
            [3, 3],
            [3, 0]
          ]
        ]
      }
    });
    expect(aroundHole.length).toBeGreaterThan(2);
    assertEdgesInUnion(aroundHole, (lon, lat) => {
      const inA =
        lon >= 0 && lon <= 3 && lat >= 0 && lat <= 3 && !(lon > 1 && lon < 2 && lat > 1 && lat < 2);
      const inB = lon >= 3 && lon <= 4 && lat >= 0 && lat <= 3;
      return inA || inB;
    });

    const multi = sampleRoadSegmentCurve(segment, [0.5, 0.5], [1.5, 0.5], {
      geometryA: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0]
            ]
          ],
          [
            [
              [10, 0],
              [11, 0],
              [11, 1],
              [10, 1],
              [10, 0]
            ]
          ]
        ]
      },
      geometryB: {
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
    });
    expect(multi).toEqual([
      [0.5, 0.5],
      [1.5, 0.5]
    ]);

    const dateline = sampleRoadSegmentCurve(segment, [179, 0], [-179, 0], {
      geometryA: {
        type: "Polygon",
        coordinates: [
          [
            [178, -1],
            [180, -1],
            [180, 1],
            [178, 1],
            [178, -1]
          ]
        ]
      },
      geometryB: {
        type: "Polygon",
        coordinates: [
          [
            [-180, -1],
            [-178, -1],
            [-178, 1],
            [-180, 1],
            [-180, -1]
          ]
        ]
      }
    });
    expect(dateline).toEqual([
      [179, 0],
      [-179, 0]
    ]);
  });
});

describe("buildRoadRibbonMesh", () => {
  it("builds a fixed-width strip with butt caps", () => {
    const mesh = buildRoadRibbonMesh(
      [
        [
          [0, 0],
          [1, 0]
        ]
      ],
      { width: 0.063 }
    );
    expect(mesh.vertices).toEqual([
      [0, 0.0315],
      [0, -0.0315],
      [1, 0.0315],
      [1, -0.0315]
    ]);
    expect(mesh.indices).toEqual([0, 1, 2, 1, 3, 2]);
  });

  it("fills a turn with one bounded bevel instead of segment end caps", () => {
    const mesh = buildRoadRibbonMesh(
      [
        [
          [0, 0],
          [1, 0],
          [1, 1]
        ]
      ],
      { width: 0.2 }
    );
    expect(mesh.vertices).toHaveLength(11);
    expect(mesh.indices).toHaveLength(15);
    expect(mesh.vertices.slice(-3)).toEqual([
      [1, 0],
      [1, -0.1],
      [1.1, 0]
    ]);
    expect(Math.min(...mesh.vertices.map(([x]) => x))).toBe(0);
    expect(Math.max(...mesh.vertices.map(([, y]) => y))).toBe(1);
  });

  it("keeps dash phase continuous across a turn", () => {
    const mesh = buildRoadRibbonMesh(
      [
        [
          [0, 0],
          [0.06, 0],
          [0.06, 0.12]
        ]
      ],
      { width: 0.03, dashSize: 0.09, gapSize: 0.09 }
    );
    expect(mesh.vertices).toHaveLength(11);
    expect(mesh.vertices).toContainEqual([0.045, 0.03]);
    expect(mesh.vertices).toContainEqual([0.075, 0.03]);
  });

  it("unwraps date-line crossings into a short continuous strip", () => {
    const mesh = buildRoadRibbonMesh(
      [
        [
          [179.9, 0],
          [-179.9, 0]
        ]
      ],
      { width: 0.02 }
    );
    const longitudes = mesh.vertices.map(([longitude]) => longitude);
    expect(Math.min(...longitudes)).toBeCloseTo(179.9, 9);
    expect(Math.max(...longitudes)).toBeCloseTo(180.1, 9);
  });

  it("uses butt-ended strips for each branch of a junction", () => {
    const mesh = buildRoadRibbonMesh(
      [
        [
          [0, 0],
          [1, 0]
        ],
        [
          [0, 0],
          [0, 1]
        ],
        [
          [0, 0],
          [-1, 0]
        ]
      ],
      { width: 0.04 }
    );
    expect(mesh.vertices).toHaveLength(12);
    expect(mesh.indices).toHaveLength(18);
    expect(mesh.vertices.every(([x, y]) => Math.abs(x) <= 1 && Math.abs(y) <= 1)).toBe(true);
  });
});

describe("buildRoadDrawBatches", () => {
  it("keeps every two-type combination centered with a half-width edge gap", () => {
    const types = ["local_road", "highway", "railway"] as const;
    const capitals = new Map<string, readonly [number, number]>([
      ["A", [0.5, 0.5]],
      ["B", [1.5, 0.5]]
    ]);
    for (let first = 0; first < types.length; first += 1) {
      for (let second = first + 1; second < types.length; second += 1) {
        const segments: RoadSegment[] = [types[first]!, types[second]!].map((typeId) => ({
          id: typeId,
          typeId,
          provinceIdA: "A",
          provinceIdB: "B"
        }));
        const batches = buildRoadDrawBatches(segments, { capitals });
        const centers = batches.map((batch) => batch.polylines[0]![1]![1]);
        const widths = segments.map((segment) => {
          const def = getRoadTypeDefinition(segment.typeId)!;
          return def.casingWidth ?? def.lineWidth;
        });
        const centerDistanceStyleUnits = Math.abs(centers[1]! - centers[0]!) / ROAD_STYLE_MAP_SCALE;
        const edgeGapStyleUnits = centerDistanceStyleUnits - (widths[0]! + widths[1]!) / 2;
        expect(edgeGapStyleUnits).toBeCloseTo(Math.min(...widths) / 2, 9);
        const leftEdge = centers[0]! - (widths[0]! / 2) * ROAD_STYLE_MAP_SCALE;
        const rightEdge = centers[1]! + (widths[1]! / 2) * ROAD_STYLE_MAP_SCALE;
        expect((leftEdge + rightEdge) / 2).toBeCloseTo(0.5, 9);
      }
    }
  });

  it("converts all road style dimensions to the selected fixed map scale", () => {
    const local = getRoadTypeDefinition("local_road")!;
    const highway = getRoadTypeDefinition("highway")!;
    const railway = getRoadTypeDefinition("railway")!;
    expect(local.lineWidth * ROAD_STYLE_MAP_SCALE).toBeCloseTo(0.03, 9);
    expect(local.casingWidth! * ROAD_STYLE_MAP_SCALE).toBeCloseTo(0.042, 9);
    expect(highway.lineWidth * ROAD_STYLE_MAP_SCALE).toBeCloseTo(0.048, 9);
    expect(highway.casingWidth! * ROAD_STYLE_MAP_SCALE).toBeCloseTo(0.063, 9);
    expect(railway.lineWidth * ROAD_STYLE_MAP_SCALE).toBeCloseTo(0.027, 9);
    expect(railway.casingWidth! * ROAD_STYLE_MAP_SCALE).toBeCloseTo(0.042, 9);
    expect(railway.dashSize! * ROAD_STYLE_MAP_SCALE).toBeCloseTo(0.09, 9);
    expect(railway.gapSize! * ROAD_STYLE_MAP_SCALE).toBeCloseTo(0.09, 9);
  });

  it("samples metro-style straight capital-to-capital lines with PCB lane jogs", () => {
    const segments: RoadSegment[] = [
      { id: "h", typeId: "highway", provinceIdA: "A", provinceIdB: "B" },
      { id: "r", typeId: "railway", provinceIdA: "A", provinceIdB: "B" },
      { id: "l", typeId: "local_road", provinceIdA: "A", provinceIdB: "B" }
    ];
    const capitals = new Map<string, readonly [number, number]>([
      ["A", [0.5, 0.5]],
      ["B", [1.5, 0.5]]
    ]);
    const batches = buildRoadDrawBatches(segments, { capitals });
    expect(batches.map((b) => b.typeId)).toEqual(["local_road", "highway", "railway"]);

    const highway = batches.find((b) => b.typeId === "highway")!.polylines[0]!;
    expect(highway[0]).toEqual([0.5, 0.5]);
    expect(highway[highway.length - 1]).toEqual([1.5, 0.5]);
    for (const [, lat] of highway) {
      expect(Math.abs(lat - 0.5)).toBeLessThan(1e-9);
    }

    const local = batches.find((b) => b.typeId === "local_road")!.polylines[0]!;
    expect(local).toHaveLength(4);
    expect(local[0]).toEqual([0.5, 0.5]);
    expect(local[3]).toEqual([1.5, 0.5]);
    expect(Math.abs(local[1]![1] - (0.5 - 4.9 * ROAD_STYLE_MAP_SCALE))).toBeLessThan(1e-9);
    expect(Math.abs(local[2]![1] - (0.5 - 4.9 * ROAD_STYLE_MAP_SCALE))).toBeLessThan(1e-9);
    expect(Math.abs(local[1]![1] - local[2]![1])).toBeLessThan(1e-9);

    const curve = sampleRoadSegmentCurve(segments[0]!, capitals.get("A")!, capitals.get("B")!);
    expect(curve).toEqual([
      [0.5, 0.5],
      [1.5, 0.5]
    ]);
    expect(adjacencyPairKey("B", "A")).toBe("A|B");
  });

  it("keeps straight path when chord stays inside A∪B", () => {
    const segment: RoadSegment = {
      id: "h",
      typeId: "highway",
      provinceIdA: "A",
      provinceIdB: "B"
    };
    const geomA = {
      type: "Polygon" as const,
      coordinates: [
        [[0, 0] as const, [1.05, 0] as const, [1.05, 1] as const, [0, 1] as const, [0, 0] as const]
      ]
    };
    const geomB = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0.95, 0] as const,
          [2, 0] as const,
          [2, 1] as const,
          [0.95, 1] as const,
          [0.95, 0] as const
        ]
      ]
    };
    const curve = sampleRoadSegmentCurve(segment, [0.5, 0.5], [1.5, 0.5], {
      geometryA: geomA,
      geometryB: geomB
    });
    expect(curve[0]).toEqual([0.5, 0.5]);
    expect(curve[curve.length - 1]).toEqual([1.5, 0.5]);
    expect(curve).toHaveLength(2);
    expect(Math.abs(curve[0]![1] - 0.5)).toBeLessThan(1e-9);
  });

  it("routes around a land gap via A∪B shortest path instead of crossing it", () => {
    const segment: RoadSegment = {
      id: "h",
      typeId: "highway",
      provinceIdA: "A",
      provinceIdB: "B"
    };
    // Touch at a southern corridor; capitals sit above a middle gap.
    const geomA = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0, 0] as const,
          [1, 0] as const,
          [1, 0.2] as const,
          [0.85, 0.2] as const,
          [0.85, 1] as const,
          [0, 1] as const,
          [0, 0] as const
        ]
      ]
    };
    const geomB = {
      type: "Polygon" as const,
      coordinates: [
        [
          [1, 0] as const,
          [2, 0] as const,
          [2, 1] as const,
          [1.15, 1] as const,
          [1.15, 0.2] as const,
          [1, 0.2] as const,
          [1, 0] as const
        ]
      ]
    };
    const curve = sampleRoadSegmentCurve(segment, [0.4, 0.7], [1.6, 0.7], {
      geometryA: geomA,
      geometryB: geomB
    });
    expect(curve[0]![0]).toBeCloseTo(0.4, 9);
    expect(curve[0]![1]).toBeCloseTo(0.7, 9);
    expect(curve[curve.length - 1]![0]).toBeCloseTo(1.6, 9);
    expect(curve[curve.length - 1]![1]).toBeCloseTo(0.7, 9);
    expect(curve.length).toBeGreaterThan(2);

    // Must not stay on the high chord through the gap.
    const staysOnHighChord = curve.every(([, lat]) => Math.abs(lat - 0.7) < 0.05);
    expect(staysOnHighChord).toBe(false);

    assertEdgesInUnion(curve, (lon, lat) => {
      const inA =
        (lon >= 0 && lon <= 0.85 && lat >= 0 && lat <= 1) ||
        (lon >= 0.85 && lon <= 1 && lat >= 0 && lat <= 0.2);
      const inB =
        (lon >= 1.15 && lon <= 2 && lat >= 0 && lat <= 1) ||
        (lon >= 1 && lon <= 1.15 && lat >= 0 && lat <= 0.2);
      return inA || inB;
    });
  });

  it("routes inside an L-shaped province instead of cutting the notch", () => {
    const segment: RoadSegment = {
      id: "h",
      typeId: "highway",
      provinceIdA: "A",
      provinceIdB: "B"
    };
    const geomA = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0, 0] as const,
          [0.9, 0] as const,
          [0.9, 0.35] as const,
          [0.35, 0.35] as const,
          [0.35, 1] as const,
          [0, 1] as const,
          [0, 0] as const
        ]
      ]
    };
    const geomB = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0.9, 0] as const,
          [2, 0] as const,
          [2, 0.35] as const,
          [0.9, 0.35] as const,
          [0.9, 0] as const
        ]
      ]
    };
    const capitalA: readonly [number, number] = [0.15, 0.85];
    const capitalB: readonly [number, number] = [1.5, 0.18];
    const curve = sampleRoadSegmentCurve(segment, capitalA, capitalB, {
      geometryA: geomA,
      geometryB: geomB
    });

    expect(curve[0]![0]).toBeCloseTo(0.15, 9);
    expect(curve[0]![1]).toBeCloseTo(0.85, 9);
    expect(curve[curve.length - 1]![0]).toBeCloseTo(1.5, 9);
    expect(curve[curve.length - 1]![1]).toBeCloseTo(0.18, 9);
    expect(curve.length).toBeGreaterThan(2);

    assertEdgesInUnion(curve, (lon, lat) => {
      const inAVertical = lon >= 0 && lon <= 0.35 && lat >= 0 && lat <= 1;
      const inAHorizontal = lon >= 0 && lon <= 0.9 && lat >= 0 && lat <= 0.35;
      const inB = lon >= 0.9 && lon <= 2 && lat >= 0 && lat <= 0.35;
      return inAVertical || inAHorizontal || inB;
    });
  });

  it("hugs the coast instead of cutting across a bay outside A∪B", () => {
    const segment: RoadSegment = {
      id: "h",
      typeId: "highway",
      provinceIdA: "A",
      provinceIdB: "B"
    };
    // Two coastal provinces with a bay notch between northern capitals.
    const geomA = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0, 0] as const,
          [1.6, 0] as const,
          [1.6, 0.35] as const,
          [0.7, 0.35] as const,
          [0.7, 1] as const,
          [0, 1] as const,
          [0, 0] as const
        ]
      ]
    };
    const geomB = {
      type: "Polygon" as const,
      coordinates: [
        [
          [1.6, 0] as const,
          [3.2, 0] as const,
          [3.2, 1] as const,
          [2.5, 1] as const,
          [2.5, 0.35] as const,
          [1.6, 0.35] as const,
          [1.6, 0] as const
        ]
      ]
    };
    const curve = sampleRoadSegmentCurve(segment, [0.3, 0.75], [2.9, 0.75], {
      geometryA: geomA,
      geometryB: geomB
    });

    expect(curve.length).toBeGreaterThan(2);
    // Straight chord at y=0.75 crosses the bay (0.7..2.5); path must dip south.
    const hasSouthernWaypoint = curve.some(([, lat]) => lat <= 0.4);
    expect(hasSouthernWaypoint).toBe(true);

    assertEdgesInUnion(curve, (lon, lat) => {
      const inA =
        (lon >= 0 && lon <= 0.7 && lat >= 0 && lat <= 1) ||
        (lon >= 0.7 && lon <= 1.6 && lat >= 0 && lat <= 0.35);
      const inB =
        (lon >= 2.5 && lon <= 3.2 && lat >= 0 && lat <= 1) ||
        (lon >= 1.6 && lon <= 2.5 && lat >= 0 && lat <= 0.35);
      return inA || inB;
    });
  });

  it("chains same-type segments that share an endpoint", () => {
    const segments: RoadSegment[] = [
      { id: "ab", typeId: "highway", provinceIdA: "A", provinceIdB: "B" },
      { id: "bc", typeId: "highway", provinceIdA: "B", provinceIdB: "C" }
    ];
    const capitals = new Map<string, readonly [number, number]>([
      ["A", [0.5, 0.5]],
      ["B", [1.5, 0.5]],
      ["C", [2.5, 0.5]]
    ]);
    const batches = buildRoadDrawBatches(segments, { capitals });
    expect(batches).toHaveLength(1);
    expect(batches[0]!.polylines).toHaveLength(1);
    expect(batches[0]!.polylines[0]!.length).toBeGreaterThanOrEqual(3);
    expect(batches[0]!.polylines[0]![0]).toEqual([0.5, 0.5]);
    expect(batches[0]!.polylines[0]!.at(-1)).toEqual([2.5, 0.5]);
  });
});
