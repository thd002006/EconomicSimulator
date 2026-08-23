import { MapSchemaError } from "./schema.js";
import type { GlobeMeshData, GlobeMeshLod } from "./types.js";

const HEADER_BYTES = 20;
const MAGIC = 0x4d475345;
const VERSION = 1;

export interface GlobeMeshMetadata {
  readonly format: "economic-simulator.globe-mesh/v1";
  readonly provinceIds: readonly string[];
  readonly lods: readonly {
    readonly tolerance: number;
    readonly file: string;
    readonly vertexCount: number;
    readonly indexCount: number;
  }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGlobeMeshMetadata(value: unknown): GlobeMeshMetadata {
  if (!isRecord(value) || value.format !== "economic-simulator.globe-mesh/v1") {
    throw new MapSchemaError("Invalid globe mesh metadata format.", "globeMesh");
  }
  if (
    !Array.isArray(value.provinceIds) ||
    value.provinceIds.length === 0 ||
    value.provinceIds.length > 65_535 ||
    value.provinceIds.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(value.provinceIds).size !== value.provinceIds.length
  ) {
    throw new MapSchemaError("Invalid or duplicate globe mesh province IDs.", "globeMesh");
  }
  if (!Array.isArray(value.lods) || value.lods.length === 0) {
    throw new MapSchemaError("Globe mesh requires at least one LOD.", "globeMesh");
  }
  const lods = value.lods.map((lod, index) => {
    if (
      !isRecord(lod) ||
      typeof lod.file !== "string" ||
      !Number.isFinite(lod.tolerance) ||
      !Number.isInteger(lod.vertexCount) ||
      !Number.isInteger(lod.indexCount) ||
      (lod.vertexCount as number) <= 0 ||
      (lod.indexCount as number) <= 0 ||
      (lod.indexCount as number) % 3 !== 0
    ) {
      throw new MapSchemaError(`Invalid globe mesh LOD ${index}.`, "globeMesh");
    }
    return {
      tolerance: lod.tolerance as number,
      file: lod.file,
      vertexCount: lod.vertexCount as number,
      indexCount: lod.indexCount as number
    };
  });
  return {
    format: "economic-simulator.globe-mesh/v1",
    provinceIds: value.provinceIds as string[],
    lods
  };
}

export function parseGlobeMeshBuffer(
  buffer: ArrayBuffer,
  expected: GlobeMeshMetadata["lods"][number],
  provinceCount: number
): GlobeMeshLod {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new MapSchemaError("Globe mesh binary is truncated.", "globeMesh");
  }
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const vertexCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const reserved = view.getUint32(16, true);
  if (magic !== MAGIC || version !== VERSION || reserved !== 0) {
    throw new MapSchemaError("Unsupported globe mesh binary header.", "globeMesh");
  }
  if (vertexCount !== expected.vertexCount || indexCount !== expected.indexCount) {
    throw new MapSchemaError("Globe mesh counts do not match metadata.", "globeMesh");
  }
  const positionsBytes = vertexCount * 3 * 4;
  const slotsBytes = vertexCount * 2;
  const slotsPaddedBytes = (slotsBytes + 3) & ~3;
  const indicesBytes = indexCount * 4;
  const expectedBytes = HEADER_BYTES + positionsBytes + slotsPaddedBytes + indicesBytes;
  if (buffer.byteLength !== expectedBytes) {
    throw new MapSchemaError("Globe mesh binary length is invalid.", "globeMesh");
  }
  const positions = new Float32Array(buffer, HEADER_BYTES, vertexCount * 3);
  const provinceSlots = new Uint16Array(buffer, HEADER_BYTES + positionsBytes, vertexCount);
  const indices = new Uint32Array(
    buffer,
    HEADER_BYTES + positionsBytes + slotsPaddedBytes,
    indexCount
  );
  for (const value of positions) {
    if (!Number.isFinite(value)) {
      throw new MapSchemaError("Globe mesh contains non-finite positions.", "globeMesh");
    }
  }
  for (const slot of provinceSlots) {
    if (slot >= provinceCount) {
      throw new MapSchemaError("Globe mesh contains an invalid province slot.", "globeMesh");
    }
  }
  for (const index of indices) {
    if (index >= vertexCount) {
      throw new MapSchemaError("Globe mesh contains an out-of-range index.", "globeMesh");
    }
  }
  return { tolerance: expected.tolerance, positions, provinceSlots, indices };
}

export function createGlobeMeshData(
  metadata: GlobeMeshMetadata,
  buffers: readonly ArrayBuffer[],
  lodIndices: readonly number[] = metadata.lods.map((_, index) => index)
): GlobeMeshData {
  if (
    buffers.length !== lodIndices.length ||
    lodIndices.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= metadata.lods.length
    ) ||
    new Set(lodIndices).size !== lodIndices.length
  ) {
    throw new MapSchemaError("Globe mesh LOD buffer count is invalid.", "globeMesh");
  }
  return {
    provinceIds: metadata.provinceIds,
    lods: lodIndices.map((lodIndex, bufferIndex) =>
      parseGlobeMeshBuffer(
        buffers[bufferIndex]!,
        metadata.lods[lodIndex]!,
        metadata.provinceIds.length
      )
    )
  };
}

export const GLOBE_MESH_BINARY_MAGIC = MAGIC;
export const GLOBE_MESH_BINARY_VERSION = VERSION;
export const GLOBE_MESH_HEADER_BYTES = HEADER_BYTES;
