import { describe, expect, it } from "vitest";
import { parseGlobeMeshBuffer } from "@economic-simulator/map-runtime";
import { compileGlobeMesh, serializeGlobeMesh } from "../src/globe-mesh.js";

describe("globe mesh compiler", () => {
  it("triangulates holes, the antimeridian, and a polar cap into outward finite meshes", () => {
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
      expect(normal[0]! * a[0]! + normal[1]! * a[1]! + normal[2]! * a[2]!).toBeGreaterThan(0);
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
});
