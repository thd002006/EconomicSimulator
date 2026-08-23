import { describe, expect, it } from "vitest";
import {
  MapSchemaError,
  ProvinceGridIndex,
  createDefaultViewport,
  createMapViewModel,
  inspectFeatureCollection,
  parsePolygonGeometry,
  pointInPolygon,
  type LoadedMapPack,
  type LonLat,
  type ProvinceFeature
} from "../src/index.js";

describe("map runtime validation", () => {
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
        schemaVersion: 3,
        format: "economic-simulator.map-runtime/v2",
        id: "test",
        version: "0.0.1",
        nameKey: "test",
        coordinateReferenceSystem: "EPSG:4326",
        assets: {
          provinces: "provinces.runtime.json",
          boundaries: "boundaries.runtime.json",
          spatialIndex: "spatial-index.json"
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
      }
    };

    const model = createMapViewModel(pack, createDefaultViewport(800, 600));
    expect(model.getProvinceOwner("A")).toBe("AAA");
    expect(model.getProvinceOwner("B")).toBe("BBB");

    const annexed = createMapViewModel(pack, createDefaultViewport(800, 600), {
      getProvinceOwner: (id) =>
        id === "B" ? "AAA" : pack.provinces.find((p) => p.id === id)?.properties.adm0A3
    });
    expect(annexed.getProvinceOwner("A")).toBe("AAA");
    expect(annexed.getProvinceOwner("B")).toBe("AAA");
  });
});
