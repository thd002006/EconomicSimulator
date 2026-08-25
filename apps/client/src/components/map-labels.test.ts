import { describe, expect, it } from "vitest";
import type { ProvinceFeature } from "@economic-simulator/map-runtime";
import {
  buildCountryBaseline,
  buildCountryLabelAnchors,
  buildProvinceBaseline,
  buildProvinceLabels,
  geometryAreaDegrees,
  labelPlacementFromPoints,
  labelVisibility,
  layoutGlyphsAlongPath,
  mapLabelLod,
  normalizeReadingDirection,
  resolveCountryLabelText,
  selectPrimaryLandmass,
  MIN_GLYPH_ADVANCE_EM,
  visibleLabelCopies,
  wrapLabelX,
  wrapPathToCamera
} from "./map-labels.js";
import { MAP_WRAP } from "./map-controls.js";

function province(id: string, owner: string, lon: number, lat: number, name = id): ProvinceFeature {
  return {
    id,
    properties: {
      nameEn: name,
      adm0A3: owner,
      capital: { coordinates: [lon, lat] }
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon - 0.5, lat - 2],
          [lon + 0.5, lat - 2],
          [lon + 0.5, lat + 2],
          [lon - 0.5, lat + 2],
          [lon - 0.5, lat - 2]
        ]
      ]
    },
    bbox: [lon - 0.5, lat - 2, lon + 0.5, lat + 2]
  };
}

describe("map label LOD", () => {
  it("shows countries when zoomed out and only provinces when zoomed in", () => {
    expect(labelVisibility(70, "country-major")).toBe(true);
    expect(labelVisibility(70, "country")).toBe(true);
    expect(labelVisibility(70, "province")).toBe(false);
    expect(labelVisibility(50, "country-major")).toBe(true);
    expect(labelVisibility(50, "country")).toBe(true);
    expect(labelVisibility(50, "province")).toBe(false);
    expect(labelVisibility(30, "country-major")).toBe(true);
    expect(labelVisibility(30, "country")).toBe(true);
    expect(labelVisibility(30, "province")).toBe(false);
    expect(labelVisibility(mapLabelLod.detailHalfHeight, "province")).toBe(true);
    expect(labelVisibility(mapLabelLod.detailHalfHeight, "country")).toBe(false);
    expect(labelVisibility(mapLabelLod.detailHalfHeight, "country-major")).toBe(false);
    expect(mapLabelLod.detailHalfHeight).toBe(10);
  });

  it("wraps label longitudes toward the camera", () => {
    expect(wrapLabelX(-170, 170)).toBeCloseTo(190, 8);
    expect(wrapLabelX(170, -170)).toBeCloseTo(-190, 8);
    expect(wrapLabelX(10, 20)).toBeCloseTo(10, 8);
  });

  it("aggregates country anchors from province capitals and uses display names", () => {
    const labels = buildCountryLabelAnchors(
      [
        province("a", "AAA", 0, 0),
        province("b", "AAA", 10, 10),
        province("c", "BBB", 40, 20),
        ...Array.from({ length: 12 }, (_, index) =>
          province(`m${index}`, "MAJ", index, index, `Major ${index}`)
        )
      ],
      (id) => {
        if (id.startsWith("m")) return "MAJ";
        if (id === "a" || id === "b") return "AAA";
        return "BBB";
      },
      {
        AAA: { nameEn: "Alpha Republic" },
        MAJ: { nameEn: "Majorland" }
      }
    );
    const aaa = labels.find((label) => label.id === "country:AAA");
    const maj = labels.find((label) => label.id === "country:MAJ");
    const bbb = labels.find((label) => label.id === "country:BBB");
    expect(aaa?.kind).toBe("country");
    expect(aaa?.text).toBe("Alpha Republic");
    expect(aaa?.path.length).toBeGreaterThanOrEqual(2);
    expect(maj?.kind).toBe("country-major");
    expect(maj?.text).toBe("Majorland");
    expect(maj?.provinceCount).toBe(12);
    expect(bbb?.text).toBe("BBB");
  });

  it("builds province labels with centerline paths", () => {
    const labels = buildProvinceLabels([
      province("p1", "AAA", 1, 2, "Alpha"),
      {
        id: "p2",
        properties: {
          name: "仅本地名",
          adm0A3: "BBB",
          capital: { coordinates: [3, 4] }
        },
        geometry: { type: "Polygon", coordinates: [] },
        bbox: [3, 4, 3, 4]
      }
    ]);
    expect(labels[0]).toEqual(
      expect.objectContaining({
        id: "province:p1",
        text: "Alpha",
        kind: "province",
        path: expect.any(Array),
        rotationDeg: expect.any(Number),
        fontSizePx: expect.any(Number)
      })
    );
    expect(labels[0]?.path.length).toBeGreaterThanOrEqual(2);
    expect(labels[1]).toEqual(
      expect.objectContaining({ id: "province:p2", text: "仅本地名", kind: "province" })
    );
  });

  it("rotates elongated point clouds along their principal axis", () => {
    const placement = labelPlacementFromPoints(
      [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 0, y: 20 },
        { x: 0, y: 30 }
      ],
      "Chile",
      "country"
    );
    expect(Math.abs(placement.rotationDeg)).toBeGreaterThan(45);
    expect(placement.extent).toBeCloseTo(30, 5);
    expect(placement.fontSizePx).toBeGreaterThan(0);
  });

  it("resolves country label text from the name table", () => {
    expect(resolveCountryLabelText("USA", { USA: { nameEn: "United States of America" } })).toBe(
      "United States of America"
    );
    expect(resolveCountryLabelText("ZZZ", {})).toBe("ZZZ");
  });
});

describe("curved label baselines", () => {
  it("builds a north-south baseline for an elongated province", () => {
    const path = buildProvinceBaseline({
      type: "Polygon",
      coordinates: [
        [
          [0, -10],
          [1, -10],
          [1, 10],
          [0, 10],
          [0, -10]
        ]
      ]
    });
    expect(path.length).toBeGreaterThanOrEqual(2);
    const dy = Math.abs(path[path.length - 1]!.y - path[0]!.y);
    const dx = Math.abs(path[path.length - 1]!.x - path[0]!.x);
    expect(dy).toBeGreaterThan(dx);
  });

  it("builds a gentle country chord along the principal axis", () => {
    const path = buildCountryBaseline([
      { x: 0, y: 0 },
      { x: 0, y: 5 },
      { x: 0, y: 10 },
      { x: 0, y: 15 }
    ]);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(path[path.length - 1]!.y - path[0]!.y)).toBeGreaterThan(4);
    expect(Math.abs(path[path.length - 1]!.x - path[0]!.x)).toBeLessThan(2);
  });

  it("reverses right-to-left paths for readable direction", () => {
    const normalized = normalizeReadingDirection([
      { x: 10, y: 0 },
      { x: 0, y: 0 }
    ]);
    expect(normalized[0]?.x).toBeLessThan(normalized[1]?.x ?? 0);
  });

  it("falls back safely for empty geometry", () => {
    const path = buildProvinceBaseline({ type: "Polygon", coordinates: [] }, { x: 3, y: 4 });
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path.some((point) => Math.abs(point.x - 3) < 2 && Math.abs(point.y - 4) < 2)).toBe(true);
  });

  it("grows glyph font size with longer screen paths", () => {
    const short = layoutGlyphsAlongPath(
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 }
      ],
      "CHILE",
      "country"
    );
    const long = layoutGlyphsAlongPath(
      [
        { x: 0, y: 0 },
        { x: 240, y: 0 }
      ],
      "CHILE",
      "country"
    );
    expect(long.fontSizePx).toBeGreaterThan(short.fontSizePx);
    expect(long.glyphs).toHaveLength(5);
    expect(long.glyphs[0]?.char).toBe("C");
    expect(Math.abs(long.glyphs[0]!.rotationDeg)).toBeLessThan(20);
  });

  it("assigns nonzero tangent rotation on diagonal paths", () => {
    const layout = layoutGlyphsAlongPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 }
      ],
      "AB",
      "province"
    );
    expect(Math.abs(layout.glyphs[0]!.rotationDeg)).toBeGreaterThan(20);
  });

  it("clamps letter tilt on sharply bent paths", () => {
    const layout = layoutGlyphsAlongPath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 80 },
        { x: 100, y: 80 }
      ],
      "ABCD",
      "country"
    );
    const overall = (Math.atan2(80, 100) * 180) / Math.PI;
    for (const glyph of layout.glyphs) {
      let delta = glyph.rotationDeg - overall;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      if (delta > 90) delta -= 180;
      if (delta < -90) delta += 180;
      expect(Math.abs(delta)).toBeLessThanOrEqual(18.01);
    }
  });

  it("does not spray letters across an oversized path", () => {
    const layout = layoutGlyphsAlongPath(
      [
        { x: 0, y: 0 },
        { x: 2000, y: 0 }
      ],
      "USA",
      "country-major"
    );
    const span = Math.abs(layout.glyphs[layout.glyphs.length - 1]!.x - layout.glyphs[0]!.x);
    expect(span).toBeLessThan(layout.fontSizePx * 2.1 * 2 + 1);
  });

  it("keeps glyph centers far enough apart on a short path with a long name", () => {
    const layout = layoutGlyphsAlongPath(
      [
        { x: 0, y: 0 },
        { x: 280, y: 0 }
      ],
      "UNITED STATES OF AMERICA",
      "country-major"
    );
    expect(layout.glyphs.length).toBeGreaterThan(1);
    // Path is too short for the kind min font without overlap — font shrinks below 14.
    expect(layout.fontSizePx).toBeLessThan(14);
    for (let index = 1; index < layout.glyphs.length; index += 1) {
      const previous = layout.glyphs[index - 1]!;
      const current = layout.glyphs[index]!;
      const gap = Math.hypot(current.x - previous.x, current.y - previous.y);
      expect(gap).toBeGreaterThanOrEqual(layout.fontSizePx * MIN_GLYPH_ADVANCE_EM - 0.01);
    }
  });

  it("hides glyphs when even the absolute min font cannot fit without overlap", () => {
    const layout = layoutGlyphsAlongPath(
      [
        { x: 0, y: 0 },
        { x: 12, y: 0 }
      ],
      "UNITED STATES OF AMERICA",
      "country-major"
    );
    expect(layout.glyphs).toHaveLength(0);
  });
});

describe("wrap label copies", () => {
  it("returns two visible copies when a label sits near both wrap tiles", () => {
    const path = [
      { x: 170, y: 10 },
      { x: 175, y: 10 },
      { x: 180, y: 10 }
    ];
    const copies = visibleLabelCopies(path, { x: 175, y: 10 }, 0, 10, 190, 40);
    expect(copies.length).toBeGreaterThanOrEqual(2);
    const xs = copies.map((copy) => copy.anchor.x).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(MAP_WRAP, 5);
  });

  it("returns a single copy when only one wrap is in view", () => {
    const path = [
      { x: 10, y: 20 },
      { x: 20, y: 20 }
    ];
    const copies = visibleLabelCopies(path, { x: 15, y: 20 }, 0, 20, 40, 30);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.offset).toBe(0);
  });
});

describe("homeland landmass selection", () => {
  it("keeps France-like labels on the largest landmass", () => {
    const labels = buildCountryLabelAnchors(
      [
        province("idf", "FRA", 2.4, 48.9, "Ile-de-France"),
        province("naq", "FRA", -0.6, 44.9, "Nouvelle-Aquitaine"),
        province("occ", "FRA", 1.4, 43.6, "Occitanie"),
        province("bre", "FRA", -1.7, 48.1, "Bretagne"),
        province("guy", "FRA", -52.3, 4.9, "Guyane"),
        province("reu", "FRA", 55.4, -20.9, "Reunion"),
        province("may", "FRA", 45.2, -12.8, "Mayotte")
      ],
      () => "FRA",
      { FRA: { nameEn: "France" } }
    );
    const france = labels.find((label) => label.id === "country:FRA");
    expect(france?.text).toBe("France");
    expect(france?.y).toBeGreaterThan(40);
    expect(france?.y).toBeLessThan(55);
    expect(france?.x).toBeGreaterThan(-5);
    expect(france?.x).toBeLessThan(12);
  });

  it("selects the cluster with the largest total area", () => {
    const primary = selectPrimaryLandmass([
      { point: { x: 0, y: 45 }, area: 10, bbox: [-1, 44, 1, 46] },
      { point: { x: 2, y: 46 }, area: 12, bbox: [1, 45, 3, 47] },
      { point: { x: 50, y: -15 }, area: 1, bbox: [49, -16, 51, -14] },
      { point: { x: -60, y: 15 }, area: 2, bbox: [-61, 14, -59, 16] }
    ]);
    expect(primary).toHaveLength(2);
    expect(primary.every((member) => member.point.y > 40)).toBe(true);
  });

  it("keeps Australia-like labels on the full mainland via bbox adjacency", () => {
    // Capitals of WA vs SA are ~23° apart (above LANDMASS_GAP), but state boxes touch.
    const aus = (id: string, lon: number, lat: number, bbox: [number, number, number, number]) =>
      ({
        id,
        properties: {
          nameEn: id,
          adm0A3: "AUS",
          capital: { coordinates: [lon, lat] }
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [bbox[0], bbox[1]],
              [bbox[2], bbox[1]],
              [bbox[2], bbox[3]],
              [bbox[0], bbox[3]],
              [bbox[0], bbox[1]]
            ]
          ]
        },
        bbox
      }) satisfies ProvinceFeature;

    const labels = buildCountryLabelAnchors(
      [
        aus("wa", 115.9, -31.9, [112, -35, 129, -13]),
        aus("nt", 130.8, -12.5, [129, -26, 138, -10]),
        aus("sa", 138.6, -34.9, [129, -38, 141, -26]),
        aus("qld", 153.0, -27.5, [138, -29, 154, -10]),
        aus("nsw", 151.2, -33.9, [141, -37, 154, -28]),
        aus("vic", 144.9, -37.8, [141, -39, 150, -34]),
        // Tasmania: separated by Bass Strait — should not dominate placement
        aus("tas", 147.3, -42.9, [144, -44, 149, -40])
      ],
      () => "AUS",
      { AUS: { nameEn: "Australia" } }
    );
    const australia = labels.find((label) => label.id === "country:AUS");
    expect(australia?.text).toBe("Australia");
    // Centered on the mainland, not pinned to the SE capital cluster
    expect(australia?.x).toBeGreaterThan(125);
    expect(australia?.x).toBeLessThan(145);
    expect(australia?.y).toBeGreaterThan(-35);
    expect(australia?.y).toBeLessThan(-18);
  });

  it("links distant capitals when province boxes nearly touch", () => {
    const primary = selectPrimaryLandmass([
      {
        point: { x: 116, y: -32 },
        area: 40,
        bbox: [112, -35, 129, -13] as [number, number, number, number]
      },
      {
        point: { x: 139, y: -35 },
        area: 20,
        bbox: [129, -38, 141, -26] as [number, number, number, number]
      },
      // Remote island: capital and bbox both far from the mainland chain
      {
        point: { x: 96, y: -12 },
        area: 3,
        bbox: [95, -13, 97, -11] as [number, number, number, number]
      }
    ]);
    expect(primary).toHaveLength(2);
    expect(primary.every((member) => member.point.x > 100)).toBe(true);
  });
});

describe("stable path wrapping", () => {
  it("translates a path rigidly when wrapping toward the camera", () => {
    const path = [
      { x: 170, y: 10 },
      { x: 175, y: 10 },
      { x: 180, y: 10 }
    ];
    const wrapped = wrapPathToCamera(path, -170);
    const dx0 = wrapped[0]!.x - path[0]!.x;
    const dx1 = wrapped[1]!.x - path[1]!.x;
    const dx2 = wrapped[2]!.x - path[2]!.x;
    expect(dx0).toBeCloseTo(dx1, 8);
    expect(dx1).toBeCloseTo(dx2, 8);
  });
});

describe("antimeridian-safe area and homeland", () => {
  it("does not inflate Alaska-like antimeridian polygons", () => {
    const alaskaLike = geometryAreaDegrees({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-168, 54],
            [-140, 54],
            [-140, 70],
            [-168, 70],
            [-168, 54]
          ]
        ],
        [
          [
            [172, 52],
            [179, 52],
            [179, 55],
            [172, 55],
            [172, 52]
          ]
        ]
      ]
    });
    const texasLike = geometryAreaDegrees({
      type: "Polygon",
      coordinates: [
        [
          [-106, 26],
          [-94, 26],
          [-94, 36],
          [-106, 36],
          [-106, 26]
        ]
      ]
    });
    expect(alaskaLike).toBeLessThan(800);
    expect(alaskaLike).toBeGreaterThan(texasLike);
  });

  it("places USA-like labels on contiguous mainland rather than Alaska", () => {
    const labels = buildCountryLabelAnchors(
      [
        province("tx", "USA", -97, 30, "Texas"),
        province("ca", "USA", -121, 38, "California"),
        province("ny", "USA", -75, 42, "New York"),
        province("il", "USA", -89, 40, "Illinois"),
        province("fl", "USA", -84, 28, "Florida"),
        province("ak", "USA", -150, 64, "Alaska"),
        province("hi", "USA", -157, 21, "Hawaii")
      ],
      () => "USA",
      { USA: { nameEn: "United States of America" } }
    );
    const usa = labels.find((label) => label.id === "country:USA");
    expect(usa?.y).toBeGreaterThan(25);
    expect(usa?.y).toBeLessThan(50);
    expect(usa?.x).toBeGreaterThan(-130);
    expect(usa?.x).toBeLessThan(-70);
  });

  it("centers large country baselines on the capital span midpoint", () => {
    const path = buildCountryBaseline([
      { x: 30, y: 55 },
      { x: 40, y: 55 },
      { x: 50, y: 56 },
      { x: 60, y: 55 },
      { x: 120, y: 60 },
      { x: 140, y: 62 },
      { x: 160, y: 60 }
    ]);
    const midX = (path[0]!.x + path[path.length - 1]!.x) / 2;
    expect(midX).toBeGreaterThan(80);
    expect(midX).toBeLessThan(120);
  });
});
