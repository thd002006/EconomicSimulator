import { afterEach, describe, expect, it, vi } from "vitest";
import { GLOBE_MESH_BINARY_MAGIC, GLOBE_MESH_BINARY_VERSION, loadMapPack } from "../src/index.js";

function makeTriangleMeshBuffer(): ArrayBuffer {
  const vertexCount = 3;
  const indexCount = 3;
  const positionsBytes = vertexCount * 3 * 4;
  const slotsBytes = vertexCount * 2;
  const slotsPaddedBytes = (slotsBytes + 3) & ~3;
  const buffer = new ArrayBuffer(20 + positionsBytes + slotsPaddedBytes + indexCount * 4);
  const header = new DataView(buffer);
  header.setUint32(0, GLOBE_MESH_BINARY_MAGIC, true);
  header.setUint32(4, GLOBE_MESH_BINARY_VERSION, true);
  header.setUint32(8, vertexCount, true);
  header.setUint32(12, indexCount, true);
  new Float32Array(buffer, 20, vertexCount * 3).set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  new Uint16Array(buffer, 20 + positionsBytes, vertexCount).fill(0);
  new Uint32Array(buffer, 20 + positionsBytes + slotsPaddedBytes, indexCount).set([0, 1, 2]);
  return buffer;
}

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 0]
    ]
  ]
};

describe("loadMapPack", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests only the globe mesh LOD currently used by the renderer", async () => {
    const root = "/maps/test";
    const jsonByUrl = new Map<string, unknown>([
      [
        `${root}/map.json`,
        {
          schemaVersion: 4,
          format: "economic-simulator.map-runtime/v3",
          id: "test",
          version: "0.0.1",
          assets: {
            provinces: "provinces.json",
            boundaries: "boundaries.json",
            spatialIndex: "spatial-index.json",
            globeMesh: "globe-mesh.json"
          },
          lodTolerances: [0.25, 0.08, 0],
          provenance: {
            toolVersion: "test",
            naturalEarthCommit: null,
            sourceHashes: {},
            assetHashes: {},
            outputHash: "sha256:test"
          }
        }
      ],
      [
        `${root}/provinces.json`,
        {
          type: "ProvinceCollection",
          features: [
            {
              id: "A",
              properties: { capital: { coordinates: [0, 0] } },
              bbox: [0, 0, 1, 1],
              lod: [polygon, polygon, polygon]
            }
          ]
        }
      ],
      [`${root}/boundaries.json`, { type: "BoundaryCollection", features: [] }],
      [`${root}/spatial-index.json`, { cellSizeDegrees: 5, cells: { "0:0": ["A"] } }],
      [
        `${root}/globe-mesh.json`,
        {
          format: "economic-simulator.globe-mesh/v1",
          provinceIds: ["A"],
          lods: [0.25, 0.08, 0].map((tolerance, index) => ({
            tolerance,
            file: `globe-lod-${index}.bin`,
            vertexCount: 3,
            indexCount: 3
          }))
        }
      ]
    ]);
    const meshBuffer = makeTriangleMeshBuffer();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${root}/globe-lod-2.bin`) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => meshBuffer
        } as Response;
      }
      const json = jsonByUrl.get(url);
      if (json === undefined) throw new Error(`Unexpected request: ${url}`);
      return {
        ok: true,
        status: 200,
        json: async () => json
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const pack = await loadMapPack(root);
    const requestedMeshFiles = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.endsWith(".bin"));

    expect(requestedMeshFiles).toEqual([`${root}/globe-lod-2.bin`]);
    expect(pack.globeMesh.lods).toHaveLength(1);
    expect(pack.globeMesh.lods[0]?.tolerance).toBe(0);
  });
});
