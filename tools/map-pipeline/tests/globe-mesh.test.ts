import { describe, expect, it } from "vitest";
import { parseGlobeMeshBuffer } from "@economic-simulator/map-runtime";
import { compileGlobeMesh, serializeGlobeMesh } from "../src/globe-mesh.js";

describe("globe mesh compiler", () => {
  const pointInTriangle = (
    point: readonly [number, number],
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number]
  ): boolean => {
    const sign = (
      p1: readonly [number, number],
      p2: readonly [number, number],
      p3: readonly [number, number]
    ) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
    const d1 = sign(point, a, b);
    const d2 = sign(point, b, c);
    const d3 = sign(point, c, a);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  it("triangulates holes, the antimeridian, and a polar cap into +Z planar meshes", () => {
    const mesh = compileGlobeMesh([
      {
        id: "hole",
        provinceSlot: 0,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [8, 0],
              [8, 8],
              [0, 8],
              [0, 0]
            ],
            [
              [2, 2],
              [2, 4],
              [4, 4],
              [4, 2],
              [2, 2]
            ]
          ]
        }
      },
      {
        id: "date-line",
        provinceSlot: 1,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [179, 10],
              [-179, 10],
              [-179, 20],
              [179, 20],
              [179, 10]
            ]
          ]
        }
      },
      {
        id: "south-pole",
        provinceSlot: 2,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-180, -80],
              [-90, -80],
              [0, -80],
              [90, -80],
              [180, -80],
              [-180, -80]
            ]
          ]
        }
      }
    ]);

    expect(mesh.indices.length).toBeGreaterThan(0);
    expect([...mesh.positions].every(Number.isFinite)).toBe(true);
    expect(new Set(mesh.provinceSlots)).toEqual(new Set([0, 1, 2]));
    for (let index = 0; index < mesh.positions.length; index += 9) {
      const a = mesh.positions.slice(index, index + 3);
      const b = mesh.positions.slice(index + 3, index + 6);
      const c = mesh.positions.slice(index + 6, index + 9);
      const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const normal = [
        ab[1]! * ac[2]! - ab[2]! * ac[1]!,
        ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!
      ];
      expect(normal[2]).toBeGreaterThan(0);
    }
  });

  it("serializes a versioned binary and rejects damaged headers", () => {
    const mesh = compileGlobeMesh([
      {
        id: "triangle",
        provinceSlot: 0,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [0, 1],
              [0, 0]
            ]
          ]
        }
      }
    ]);
    const bytes = serializeGlobeMesh(mesh);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const parsed = parseGlobeMeshBuffer(
      buffer,
      {
        tolerance: 0,
        file: "test.bin",
        vertexCount: mesh.provinceSlots.length,
        indexCount: mesh.indices.length
      },
      1
    );
    expect(parsed.indices).toEqual(mesh.indices);

    const damaged = buffer.slice(0);
    new DataView(damaged).setUint32(0, 0, true);
    expect(() =>
      parseGlobeMeshBuffer(
        damaged,
        {
          tolerance: 0,
          file: "test.bin",
          vertexCount: mesh.provinceSlots.length,
          indexCount: mesh.indices.length
        },
        1
      )
    ).toThrow(/header/);
  });

  it("keeps a shallow concave arc instead of flattening it into a chord", () => {
    const arc = Array.from({ length: 21 }, (_, index) => {
      const t = index / 20;
      return [t, 0.02 * Math.sin(Math.PI * t)] as const;
    });
    const mesh = compileGlobeMesh([
      {
        id: "arc",
        provinceSlot: 0,
        geometry: {
          type: "Polygon",
          coordinates: [[...arc, [1, -1], [0, -1], arc[0]!]]
        }
      }
    ]);
    let peakY = -Infinity;
    for (let index = 0; index < mesh.positions.length; index += 3) {
      peakY = Math.max(peakY, mesh.positions[index + 1]!);
    }
    expect(peakY).toBeGreaterThan(0.015);
  });

  it("keeps antimeridian holes when outer and hole unwrap to different cycles", () => {
    const mesh = compileGlobeMesh([
      {
        id: "antimeridian-hole",
        provinceSlot: 0,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [170, 10],
              [-170, 10],
              [-170, 20],
              [170, 20],
              [170, 10]
            ],
            [
              [175, 12],
              [-175, 12],
              [-175, 18],
              [175, 18],
              [175, 12]
            ]
          ]
        }
      }
    ]);

    const holeCenter: readonly [number, number] = [180, 15];
    let covered = false;
    for (let index = 0; index < mesh.positions.length; index += 9) {
      const a: readonly [number, number] = [mesh.positions[index]!, mesh.positions[index + 1]!];
      const b: readonly [number, number] = [mesh.positions[index + 3]!, mesh.positions[index + 4]!];
      const c: readonly [number, number] = [mesh.positions[index + 6]!, mesh.positions[index + 7]!];
      if (pointInTriangle(holeCenter, a, b, c)) {
        covered = true;
        break;
      }
    }
    expect(covered).toBe(false);
  });

  it("skips tiny invalid polygons and throws on large triangulation deviation", () => {
    expect(() =>
      compileGlobeMesh([
        {
          id: "tiny-bowtie",
          provinceSlot: 0,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [0.001, 0.001],
                [0.001, 0],
                [0, 0.001],
                [0, 0]
              ]
            ]
          }
        }
      ])
    ).not.toThrow();

    expect(() =>
      compileGlobeMesh([
        {
          id: "outside-hole",
          provinceSlot: 0,
          geometry: {
            type: "Polygon",
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
          }
        }
      ])
    ).toThrow(/deviation/);
  });
});
