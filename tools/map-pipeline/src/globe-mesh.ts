import earcut, { deviation } from "earcut";
import {
  GLOBE_MESH_BINARY_MAGIC,
  GLOBE_MESH_BINARY_VERSION,
  GLOBE_MESH_HEADER_BYTES,
  type GeoJsonGeometry,
  type LonLat
} from "@economic-simulator/map-runtime";

const MAX_DEVIATION = 0.02;
const MIN_AREA = 1e-8;
const MAX_SKIPPABLE_INVALID_AREA = 0.002;
const DATELINE_JUMP = 180;

type PolygonGeometry = Extract<GeoJsonGeometry, { type: "Polygon" | "MultiPolygon" }>;

export interface CompiledGlobeMesh {
  readonly positions: Float32Array;
  readonly provinceSlots: Uint16Array;
  readonly indices: Uint32Array;
}

function withoutClosingPoint(ring: readonly LonLat[]): LonLat[] {
  if (ring.length < 2) return [...ring];
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : [...ring];
}

function cleanRing(ring: readonly LonLat[]): LonLat[] {
  const cleaned: LonLat[] = [];
  for (const point of withoutClosingPoint(ring)) {
    const previous = cleaned[cleaned.length - 1];
    if (previous === undefined || previous[0] !== point[0] || previous[1] !== point[1]) {
      cleaned.push(point);
    }
  }
  return cleaned;
}

function closeRing(ring: readonly LonLat[]): LonLat[] {
  if (ring.length === 0) return [];
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? [...ring] : [...ring, first];
}

function unwrapRing(ring: readonly LonLat[]): LonLat[] {
  const cleaned = cleanRing(ring);
  if (cleaned.length === 0) return [];
  const unwrapped: LonLat[] = [cleaned[0]!];
  for (let index = 1; index < cleaned.length; index += 1) {
    const previous = unwrapped[index - 1]!;
    const current = cleaned[index]!;
    let lon = current[0];
    const bothOnDateline =
      Math.abs(Math.abs(previous[0]) - 180) < 1e-9 && Math.abs(Math.abs(current[0]) - 180) < 1e-9;
    if (!bothOnDateline) {
      while (lon - previous[0] > DATELINE_JUMP) lon -= 360;
      while (previous[0] - lon > DATELINE_JUMP) lon += 360;
    }
    unwrapped.push([lon, current[1]]);
  }
  return unwrapped;
}

function ringCentroid(ring: readonly LonLat[]): LonLat {
  const closed = closeRing(ring);
  let x = 0;
  let y = 0;
  let count = 0;
  for (const point of closed.slice(0, -1)) {
    x += point[0];
    y += point[1];
    count += 1;
  }
  return count === 0 ? [0, 0] : [x / count, y / count];
}

function shiftRing(ring: readonly LonLat[], deltaLon: number): LonLat[] {
  return ring.map(([lon, lat]) => [lon + deltaLon, lat]);
}

function alignRingCycle(ring: readonly LonLat[], referenceLon: number): LonLat[] {
  const centroidLon = ringCentroid(ring)[0];
  const cycleOffset = Math.round((referenceLon - centroidLon) / 360) * 360;
  return shiftRing(ring, cycleOffset);
}

function splitPolygonAtDateline(rings: readonly (readonly LonLat[])[]): LonLat[][][] {
  // Planar mesh 使用 earcut 进行三角化时，真正的关键是让每个 ring 的经度在局部
  // 保持连续（unwrap）。比起对 ±180 做“切块+裁剪”（容易引入环/洞归属错误），
  // 我们这里先不拆成多份，只返回原始 rings，交由 flattenPolygon 里统一 unwrap。
  return rings.length === 0 ? [] : [rings as unknown as LonLat[][]];
}

function flattenPolygon(rings: readonly (readonly LonLat[])[]): {
  vertices: number[];
  holes: number[];
} {
  const vertices: number[] = [];
  const holeIndices: number[] = [];
  let referenceLon: number | undefined;
  for (const [ringIndex, ring] of rings.entries()) {
    const unwrapped = unwrapRing(ring);
    const aligned =
      ringIndex === 0 || referenceLon === undefined
        ? unwrapped
        : alignRingCycle(unwrapped, referenceLon);
    if (ringIndex === 0) referenceLon = ringCentroid(aligned)[0];
    // Polar caps (rings that cover almost the whole longitude range) can become
    // degenerate for planar earcut when we avoid dateline splitting.
    // If the unwrapped longitude span is near 360°, augment the ring with two
    // pole points so earcut has a stable triangulation.
    if (aligned.length >= 3) {
      const lons = aligned.map((point) => point[0]!);
      const span = Math.max(...lons) - Math.min(...lons);
      if (span >= 359) {
        const avgLat = aligned.reduce((sum, point) => sum + point[1]!, 0) / aligned.length;
        const poleLat = avgLat < 0 ? -90 : 90;
        aligned.push([180, poleLat], [-180, poleLat]);
      }
    }
    if (aligned.length < 3) continue;
    if (ringIndex > 0) holeIndices.push(vertices.length / 2);
    for (const [lon, lat] of aligned) {
      vertices.push(lon, lat);
    }
  }
  return { vertices, holes: holeIndices };
}

function polygonArea(vertices: readonly number[], holes: readonly number[]): number {
  const starts = [0, ...holes];
  let area = 0;
  for (const [ringIndex, startVertex] of starts.entries()) {
    const endVertex = starts[ringIndex + 1] ?? vertices.length / 2;
    let ringArea = 0;
    for (let index = startVertex; index < endVertex; index += 1) {
      const next = index + 1 === endVertex ? startVertex : index + 1;
      ringArea +=
        vertices[index * 2]! * vertices[next * 2 + 1]! -
        vertices[next * 2]! * vertices[index * 2 + 1]!;
    }
    area += ringIndex === 0 ? Math.abs(ringArea / 2) : -Math.abs(ringArea / 2);
  }
  return Math.max(0, area);
}

function appendPolygon(
  positions: number[],
  slots: number[],
  indices: number[],
  provinceSlot: number,
  rings: readonly (readonly LonLat[])[],
  featureId: string
): void {
  for (const polygon of splitPolygonAtDateline(rings)) {
    const flattened = flattenPolygon(polygon);
    if (flattened.vertices.length < 6) continue;
    const area = polygonArea(flattened.vertices, flattened.holes);
    if (area < MIN_AREA) continue;
    const triangles = earcut(flattened.vertices, flattened.holes, 2);
    const areaDeviation = deviation(flattened.vertices, flattened.holes, 2, triangles);
    const invalid = !Number.isFinite(areaDeviation) || areaDeviation > MAX_DEVIATION;
    if (invalid) {
      // Degenerate islets (a few thousandths of a square degree) can be dropped.
      // Larger polygons must throw so compile-maps can fall back to a finer LOD.
      if (area < MAX_SKIPPABLE_INVALID_AREA) continue;
      throw new Error(
        `Planar triangulation deviation ${String(areaDeviation)} exceeds ${MAX_DEVIATION} for ${featureId}.`
      );
    }
    for (let index = 0; index < triangles.length; index += 3) {
      const ia = triangles[index];
      const ib = triangles[index + 1];
      const ic = triangles[index + 2];
      if (ia === undefined || ib === undefined || ic === undefined) {
        throw new Error(`Planar triangulation emitted an invalid index for ${featureId}.`);
      }
      const ax = flattened.vertices[ia * 2]!;
      const ay = flattened.vertices[ia * 2 + 1]!;
      const bx = flattened.vertices[ib * 2]!;
      const by = flattened.vertices[ib * 2 + 1]!;
      const cx = flattened.vertices[ic * 2]!;
      const cy = flattened.vertices[ic * 2 + 1]!;
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const ordered: readonly (readonly [number, number])[] =
        cross >= 0
          ? [
              [ax, ay],
              [bx, by],
              [cx, cy]
            ]
          : [
              [ax, ay],
              [cx, cy],
              [bx, by]
            ];
      const base = slots.length;
      for (const [x, y] of ordered) {
        positions.push(x, y, 0);
        slots.push(provinceSlot);
      }
      indices.push(base, base + 1, base + 2);
    }
  }
}

export function compileGlobeMesh(
  features: readonly {
    readonly id: string;
    readonly provinceSlot: number;
    readonly geometry: PolygonGeometry;
  }[]
): CompiledGlobeMesh {
  const positions: number[] = [];
  const slots: number[] = [];
  const indices: number[] = [];
  for (const feature of features) {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const [polygonIndex, polygon] of polygons.entries()) {
      appendPolygon(
        positions,
        slots,
        indices,
        feature.provinceSlot,
        polygon,
        `${feature.id}#${polygonIndex}`
      );
    }
  }
  return {
    positions: Float32Array.from(positions),
    provinceSlots: Uint16Array.from(slots),
    indices: Uint32Array.from(indices)
  };
}

export function serializeGlobeMesh(mesh: CompiledGlobeMesh): Uint8Array {
  const vertexCount = mesh.provinceSlots.length;
  if (mesh.positions.length !== vertexCount * 3 || mesh.indices.length % 3 !== 0) {
    throw new Error("Invalid compiled globe mesh arrays.");
  }
  const positionBytes = mesh.positions.byteLength;
  const slotBytes = mesh.provinceSlots.byteLength;
  const paddedSlotBytes = (slotBytes + 3) & ~3;
  const output = new Uint8Array(
    GLOBE_MESH_HEADER_BYTES + positionBytes + paddedSlotBytes + mesh.indices.byteLength
  );
  const view = new DataView(output.buffer);
  view.setUint32(0, GLOBE_MESH_BINARY_MAGIC, true);
  view.setUint32(4, GLOBE_MESH_BINARY_VERSION, true);
  view.setUint32(8, vertexCount, true);
  view.setUint32(12, mesh.indices.length, true);
  view.setUint32(16, 0, true);
  output.set(new Uint8Array(mesh.positions.buffer), GLOBE_MESH_HEADER_BYTES);
  output.set(new Uint8Array(mesh.provinceSlots.buffer), GLOBE_MESH_HEADER_BYTES + positionBytes);
  output.set(
    new Uint8Array(mesh.indices.buffer),
    GLOBE_MESH_HEADER_BYTES + positionBytes + paddedSlotBytes
  );
  return output;
}
