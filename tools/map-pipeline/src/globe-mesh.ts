import earcut, { deviation } from "earcut";
import {
  GLOBE_MESH_BINARY_MAGIC,
  GLOBE_MESH_BINARY_VERSION,
  GLOBE_MESH_HEADER_BYTES,
  lonLatToUnitVector,
  type GeoJsonGeometry,
  type LonLat
} from "@economic-simulator/map-runtime";

const LAND_RADIUS = 1.006;
const MAX_TRIANGLE_EDGE_RADIANS = (6 * Math.PI) / 180;
const MAX_SUBDIVISION_DEPTH = 8;
const MAX_DEVIATION = 0.02;
const MIN_PROJECTED_AREA = 1e-8;
const MAX_SKIPPABLE_INVALID_AREA = 2e-6;

type PolygonGeometry = Extract<GeoJsonGeometry, { type: "Polygon" | "MultiPolygon" }>;
type Vec3 = [number, number, number];

export interface CompiledGlobeMesh {
  readonly positions: Float32Array;
  readonly provinceSlots: Uint16Array;
  readonly indices: Uint32Array;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(vector: Vec3, radius = 1): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-12) {
    throw new Error("Cannot normalize a zero-length globe mesh vector.");
  }
  const scale = radius / length;
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

function withoutClosingPoint(ring: readonly LonLat[]): readonly LonLat[] {
  if (ring.length < 2) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

function cleanRing(ring: readonly LonLat[]): readonly LonLat[] {
  const cleaned: LonLat[] = [];
  for (const point of withoutClosingPoint(ring)) {
    const previous = cleaned[cleaned.length - 1];
    if (previous === undefined || previous[0] !== point[0] || previous[1] !== point[1]) {
      cleaned.push(point);
    }
  }
  if (cleaned.length > 1) {
    const first = cleaned[0]!;
    const last = cleaned[cleaned.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) cleaned.pop();
  }
  return cleaned;
}

function polygonCenter(rings: readonly (readonly LonLat[])[]): Vec3 {
  const outer = cleanRing(rings[0] ?? []);
  const sum: Vec3 = [0, 0, 0];
  for (const [lon, lat] of outer) {
    const point = lonLatToUnitVector(lon, lat) as Vec3;
    sum[0] += point[0];
    sum[1] += point[1];
    sum[2] += point[2];
  }
  if (Math.hypot(...sum) < 1e-8 && outer[0] !== undefined) {
    return lonLatToUnitVector(outer[0][0], outer[0][1]) as Vec3;
  }
  return normalize(sum);
}

function projectPolygon(rings: readonly (readonly LonLat[])[]): {
  vertices2d: number[];
  vertices3d: Vec3[];
  holes: number[];
} {
  const center = polygonCenter(rings);
  const reference: Vec3 = Math.abs(center[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const east = normalize(cross(reference, center));
  const north = normalize(cross(center, east));
  const vertices2d: number[] = [];
  const vertices3d: Vec3[] = [];
  const holes: number[] = [];

  for (const [ringIndex, rawRing] of rings.entries()) {
    const ring = cleanRing(rawRing);
    if (ring.length < 3) continue;
    if (ringIndex > 0) holes.push(vertices3d.length);
    for (const [lon, lat] of ring) {
      const point = lonLatToUnitVector(lon, lat) as Vec3;
      const cosine = Math.max(-1, Math.min(1, dot(center, point)));
      const angle = Math.acos(cosine);
      const sine = Math.sin(angle);
      const scale = Math.abs(sine) < 1e-12 ? 1 : angle / sine;
      vertices2d.push(dot(point, east) * scale, dot(point, north) * scale);
      vertices3d.push(normalize(point, LAND_RADIUS));
    }
  }
  return { vertices2d, vertices3d, holes };
}

function projectedArea(vertices: readonly number[], holes: readonly number[]): number {
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

function angularDistance(a: Vec3, b: Vec3): number {
  const normalizedDot = dot(a, b) / (LAND_RADIUS * LAND_RADIUS);
  return Math.acos(Math.max(-1, Math.min(1, normalizedDot)));
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return normalize([a[0] + b[0], a[1] + b[1], a[2] + b[2]], LAND_RADIUS);
}

function appendTriangle(
  positions: number[],
  slots: number[],
  indices: number[],
  provinceSlot: number,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  depth = 0
): void {
  const edges = [angularDistance(a, b), angularDistance(b, c), angularDistance(c, a)];
  const longest = Math.max(...edges);
  if (longest > MAX_TRIANGLE_EDGE_RADIANS && depth < MAX_SUBDIVISION_DEPTH) {
    if (longest === edges[0]) {
      const mid = midpoint(a, b);
      appendTriangle(positions, slots, indices, provinceSlot, a, mid, c, depth + 1);
      appendTriangle(positions, slots, indices, provinceSlot, mid, b, c, depth + 1);
    } else if (longest === edges[1]) {
      const mid = midpoint(b, c);
      appendTriangle(positions, slots, indices, provinceSlot, a, b, mid, depth + 1);
      appendTriangle(positions, slots, indices, provinceSlot, a, mid, c, depth + 1);
    } else {
      const mid = midpoint(c, a);
      appendTriangle(positions, slots, indices, provinceSlot, a, b, mid, depth + 1);
      appendTriangle(positions, slots, indices, provinceSlot, mid, b, c, depth + 1);
    }
    return;
  }

  const normal = cross(
    [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  );
  if (Math.hypot(normal[0], normal[1], normal[2]) < 1e-12) return;
  const center: Vec3 = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
  const ordered = dot(normal, center) >= 0 ? [a, b, c] : [a, c, b];
  const base = slots.length;
  for (const point of ordered) positions.push(point[0], point[1], point[2]);
  slots.push(provinceSlot, provinceSlot, provinceSlot);
  indices.push(base, base + 1, base + 2);
}

function appendPolygon(
  positions: number[],
  slots: number[],
  indices: number[],
  provinceSlot: number,
  rings: readonly (readonly LonLat[])[],
  featureId: string
): void {
  const projected = projectPolygon(rings);
  if (projected.vertices3d.length < 3) return;
  const area = projectedArea(projected.vertices2d, projected.holes);
  if (area < MIN_PROJECTED_AREA) return;
  const triangles = earcut(projected.vertices2d, projected.holes, 2);
  const areaDeviation = deviation(projected.vertices2d, projected.holes, 2, triangles);
  if (!Number.isFinite(areaDeviation) || areaDeviation > MAX_DEVIATION) {
    if (area < MAX_SKIPPABLE_INVALID_AREA) return;
    throw new Error(`Globe triangulation deviation ${areaDeviation} for ${featureId}.`);
  }
  for (let index = 0; index < triangles.length; index += 3) {
    const a = projected.vertices3d[triangles[index] ?? -1];
    const b = projected.vertices3d[triangles[index + 1] ?? -1];
    const c = projected.vertices3d[triangles[index + 2] ?? -1];
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error(`Globe triangulation emitted an invalid index for ${featureId}.`);
    }
    appendTriangle(positions, slots, indices, provinceSlot, a, b, c);
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
