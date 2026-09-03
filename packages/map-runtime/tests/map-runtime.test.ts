import { describe, expect, it } from "vitest";
import {
  MapSchemaError,
  ProvinceGridIndex,
  createMapViewModel,
  inspectFeatureCollection,
  lonLatToMapXY,
  lonLatToUnitVector,
  mapXYToLonLat,
  parsePolygonGeometry,
  pointInPolygon,
  unitVectorToLonLat,
  wrapLongitude,
  type LoadedMapPack,
  type LonLat,
  type ProvinceFeature
} from "../src/index.js";

describe("map runtime validation", () => {
  it("wraps longitude into (-180, 180] and round-trips planar map coordinates", () => {
    expect(wrapLongitude(180)).toBe(180);
    expect(wrapLongitude(-180)).toBe(180);
    expect(wrapLongitude(190)).toBeCloseTo(-170, 8);
    expect(wrapLongitude(-190)).toBeCloseTo(170, 8);
    expect(wrapLongitude(540)).toBeCloseTo(180, 8);

    for (const [lon, lat] of [
      [179.5, 12],
      [-179.5, -12],
      [30, 89.9],
      [-45, -89.9]
    ] as const) {
      const [x, y] = lonLatToMapXY(lon, lat);
      const actual = mapXYToLonLat(x, y);
      expect(actual[0]).toBeCloseTo(wrapLongitude(lon), 8);
      expect(actual[1]).toBeCloseTo(lat, 8);
    }
  });

  it("round-trips globe coordinates across the antimeridian and poles", () => {
    for (const [lon, lat] of [
      [179.5, 12],
      [-179.5, -12],
      [30, 89.9],
      [-45, -89.9]
    ] as const) {
      const actual = unitVectorToLonLat(lonLatToUnitVector(lon, lat));
      expect(actual[0]).toBeCloseTo(lon, 8);
      expect(actual[1]).toBeCloseTo(lat, 8);
    }
  });

  it("indexes stable GeoJSON feature IDs", () => {
    const result = inspectFeatureCollection({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "province-1",
          properties: {},
          geometry: { type: "Polygon", coordinates: [] }
        }
      ]
    });

    expect(result.featureIds).toEqual(["province-1"]);
    expect(result.geometryCounts).toEqual({ Polygon: 1 });
  });

  it("detects points inside polygons", () => {
    const square: LonLat[][] = [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0]
      ]
    ];
    expect(pointInPolygon(1, 1, square)).toBe(true);
    expect(pointInPolygon(3, 3, square)).toBe(false);
  });

  it("rejects invalid polygon rings with structured schema errors", () => {
    expect(() =>
      parsePolygonGeometry(
        {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1]
            ]
          ]
        },
        "provinces",
        "bad-ring"
      )
    ).toThrow(MapSchemaError);

    expect(() =>
      parsePolygonGeometry(
        {
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
        },
        "provinces",
        "ok"
      )
    ).not.toThrow();

    expect(() =>
      parsePolygonGeometry(
        {
          type: "Unknown",
          coordinates: []
        },
        "provinces",
        "unknown"
      )
    ).toThrow(/Unsupported geometry type/);
  });

  it("hit-tests multipolygons with holes via spatial index", () => {
    const feature: ProvinceFeature = {
      id: "island-with-lake",
      properties: { adm0A3: "TST", capital: { coordinates: [1, 1] } },
      bbox: [0, 0, 6, 6],
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [6, 0],
              [6, 6],
              [0, 6],
              [0, 0]
            ],
            [
              [2, 2],
              [4, 2],
              [4, 4],
              [2, 4],
              [2, 2]
            ]
          ]
        ]
      }
    };
    const index = new ProvinceGridIndex([feature], 5);
    expect(index.hitTest(1, 1)?.id).toBe("island-with-lake");
    expect(index.hitTest(3, 3)).toBeUndefined();
    expect(index.hitTest(10, 10)).toBeUndefined();
  });

  it("styles shared boundaries by ownership in the view model", () => {
    const left: ProvinceFeature = {
      id: "A",
      properties: { adm0A3: "AAA", capital: { coordinates: [0.5, 0.5] } },
      bbox: [0, 0, 1, 1],
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
    };
    const right: ProvinceFeature = {
      id: "B",
      properties: { adm0A3: "BBB", capital: { coordinates: [1.5, 0.5] } },
      bbox: [1, 0, 2, 1],
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
    };
    const pack: LoadedMapPack = {
      manifest: {
        schemaVersion: 4,
        format: "economic-simulator.map-runtime/v3",
        id: "test",
        version: "0.0.1",
        nameKey: "test",
        coordinateReferenceSystem: "EPSG:4326",
        assets: {
          provinces: "provinces.runtime.json",
          boundaries: "boundaries.runtime.json",
          spatialIndex: "spatial-index.json",
          globeMesh: "globe-mesh.json"
        },
        lodTolerances: [0.1],
        provenance: {
          toolVersion: "0.1.0",
          naturalEarthCommit: null,
          sourceHashes: {},
          assetHashes: {},
          outputHash: "sha256:test"
        }
      },
      provinces: [left, right],
      coastlines: [],
      roads: { schemaVersion: 1, segments: [] },
      countries: {
        AAA: { nameEn: "Alpha" },
        BBB: { nameEn: "Beta" }
      },
      demographics: {
        A: {
          pop: 100,
          male: 50,
          female: 50,
          age: Object.fromEntries(Array.from({ length: 101 }, (_, age) => [age, 100 / 101])),
          education15Plus: { basic: 40, secondary: 30, tertiary: 20, advanced: 10 },
          gdpPpp: 1000
        },
        B: {
          pop: 50,
          male: 25,
          female: 25,
          age: Object.fromEntries(Array.from({ length: 101 }, (_, age) => [age, 50 / 101])),
          education15Plus: { basic: 20, secondary: 15, tertiary: 10, advanced: 5 },
          gdpPpp: 500
        }
      },
      boundaries: [
        {
          id: "boundary-1",
          leftProvinceId: "A",
          rightProvinceId: "B",
          coordinates: [
            [1, 0],
            [1, 1]
          ]
        }
      ],
      spatialIndex: {
        cellSizeDegrees: 5,
        cells: { "0:0": ["A", "B"] }
      },
      globeMesh: {
        provinceIds: ["A", "B"],
        lods: [
          {
            tolerance: 0.1,
            positions: new Float32Array([0, 0, 1, 0.01, 0, 1, 0, 0.01, 1]),
            provinceSlots: new Uint16Array([0, 0, 0]),
            indices: new Uint32Array([0, 1, 2])
          }
        ]
      }
    };

    const model = createMapViewModel(pack);
    expect(model.getProvinceOwner("A")).toBe("AAA");
    expect(model.getProvinceOwner("B")).toBe("BBB");
    expect(model.getCountryName("AAA")).toBe("Alpha");
    expect(model.getCountryName("BBB")).toBe("Beta");
    expect(model.getCountryName("ZZZ")).toBeUndefined();
    expect(model.getProvinceDemographics("A")?.pop).toBe(100);
    expect(model.getCountryAggregate("AAA")).toEqual({
      provinceCount: 1,
      pop: 100,
      gdpPpp: 1000
    });
    expect(model.getCountryAggregate("BBB")).toEqual({
      provinceCount: 1,
      pop: 50,
      gdpPpp: 500
    });

    const annexed = createMapViewModel(pack, {
      getProvinceOwner: (id) =>
        id === "B" ? "AAA" : pack.provinces.find((p) => p.id === id)?.properties.adm0A3
    });
    expect(annexed.getProvinceOwner("A")).toBe("AAA");
    expect(annexed.getProvinceOwner("B")).toBe("AAA");
    expect(annexed.getCountryAggregate("AAA")).toEqual({
      provinceCount: 2,
      pop: 150,
      gdpPpp: 1500
    });
  });
});
