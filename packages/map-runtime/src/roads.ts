import { lonLatToMapXY, wrapLongitude } from "./map-projection.js";
import { pointInGeometry } from "./geometry.js";
import { isKnownRoadTypeId, getRoadTypeDefinition, roadTypesSortedByDrawOrder } from "./road-types.js";
import { MapSchemaError, assertFiniteCoord } from "./schema.js";
import type {
  GeoJsonGeometry,
  LonLat,
  MapBoundary,
  RoadBendOverride,
  RoadCollection,
  RoadSegment,
  RoadTypeId
} from "./types.js";

export const EMPTY_ROAD_COLLECTION: RoadCollection = Object.freeze({
  schemaVersion: 1,
  segments: Object.freeze([])
});

export function roadSegmentKey(typeId: string, provinceIdA: string, provinceIdB: string): string {
  const a = provinceIdA < provinceIdB ? provinceIdA : provinceIdB;
  const b = provinceIdA < provinceIdB ? provinceIdB : provinceIdA;
  return `${typeId}|${a}|${b}`;
}

export function adjacencyPairKey(provinceIdA: string, provinceIdB: string): string {
  return provinceIdA < provinceIdB
    ? `${provinceIdA}|${provinceIdB}`
    : `${provinceIdB}|${provinceIdA}`;
}

export function buildAdjacencyPairSet(
  boundaries: readonly MapBoundary[]
): ReadonlySet<string> {
  const pairs = new Set<string>();
  for (const boundary of boundaries) {
    if (boundary.rightProvinceId === null) continue;
    pairs.add(adjacencyPairKey(boundary.leftProvinceId, boundary.rightProvinceId));
  }
  return pairs;
}

export function buildBoundaryMidpointIndex(
  boundaries: readonly MapBoundary[]
): ReadonlyMap<string, LonLat> {
  const midpoints = new Map<string, LonLat>();
  for (const boundary of boundaries) {
    if (boundary.rightProvinceId === null || boundary.coordinates.length === 0) continue;
    const key = adjacencyPairKey(boundary.leftProvinceId, boundary.rightProvinceId);
    if (midpoints.has(key)) continue;
    midpoints.set(key, lineMidpoint(boundary.coordinates));
  }
  return midpoints;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}

function parseBend(value: unknown, segmentId: string): RoadBendOverride | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || !Array.isArray(value.controlPoints)) {
    throw new MapSchemaError("ROAD_BEND_INVALID: bend must have controlPoints.", "roads", segmentId);
  }
  if (value.controlPoints.length !== 1 && value.controlPoints.length !== 2) {
    throw new MapSchemaError(
      "ROAD_BEND_INVALID: controlPoints length must be 1 or 2.",
      "roads",
      segmentId
    );
  }
  return {
    controlPoints: value.controlPoints.map((point, index) =>
      assertFiniteCoord(point, "roads", segmentId, `bend.controlPoints[${index}]`)
    )
  };
}

export interface RoadParseContext {
  readonly provinceIds?: ReadonlySet<string>;
  readonly adjacencyPairs?: ReadonlySet<string>;
  readonly capitals?: ReadonlyMap<string, LonLat>;
}

export function parseRoadCollection(
  input: unknown,
  context: RoadParseContext = {}
): RoadCollection {
  if (input === undefined || input === null) {
    return EMPTY_ROAD_COLLECTION;
  }
  if (!isRecord(input)) {
    throw new MapSchemaError("Expected RoadCollection object.", "roads");
  }
  if (input.schemaVersion !== 1) {
    throw new MapSchemaError(
      `Unsupported roads schemaVersion ${String(input.schemaVersion)}; expected 1.`,
      "roads"
    );
  }
  if (!Array.isArray(input.segments)) {
    throw new MapSchemaError("RoadCollection.segments must be an array.", "roads");
  }

  const segments: RoadSegment[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();

  for (const [index, raw] of input.segments.entries()) {
    if (!isRecord(raw)) {
      throw new MapSchemaError(`Segment ${index} is invalid.`, "roads");
    }
    const id = asString(raw.id);
    if (id === undefined) {
      throw new MapSchemaError(`Segment ${index} missing id.`, "roads");
    }
    if (ids.has(id)) {
      throw new MapSchemaError(`ROAD_ID_DUPLICATE: ${id}`, "roads", id);
    }
    ids.add(id);

    const typeId = asString(raw.typeId);
    if (typeId === undefined || !isKnownRoadTypeId(typeId)) {
      throw new MapSchemaError(`ROAD_TYPE_UNKNOWN: ${String(raw.typeId)}`, "roads", id);
    }

    const rawA = asString(raw.provinceIdA);
    const rawB = asString(raw.provinceIdB);
    if (rawA === undefined || rawB === undefined) {
      throw new MapSchemaError("provinceIdA and provinceIdB are required.", "roads", id);
    }
    if (rawA === rawB) {
      throw new MapSchemaError("Road endpoints must be distinct provinces.", "roads", id);
    }
    const provinceIdA = rawA < rawB ? rawA : rawB;
    const provinceIdB = rawA < rawB ? rawB : rawA;

    if (context.provinceIds !== undefined) {
      if (!context.provinceIds.has(provinceIdA) || !context.provinceIds.has(provinceIdB)) {
        throw new MapSchemaError("ROAD_PROVINCE_NOT_FOUND", "roads", id);
      }
    }
    if (context.capitals !== undefined) {
      if (!context.capitals.has(provinceIdA) || !context.capitals.has(provinceIdB)) {
        throw new MapSchemaError("ROAD_CAPITAL_MISSING", "roads", id);
      }
    }
    if (context.adjacencyPairs !== undefined) {
      if (!context.adjacencyPairs.has(adjacencyPairKey(provinceIdA, provinceIdB))) {
        throw new MapSchemaError("ROAD_NOT_ADJACENT", "roads", id);
      }
    }

    const key = roadSegmentKey(typeId, provinceIdA, provinceIdB);
    if (keys.has(key)) {
      throw new MapSchemaError(`ROAD_DUPLICATE_SEGMENT: ${key}`, "roads", id);
    }
    keys.add(key);

    const name = asString(raw.name);
    const nameEn = asString(raw.nameEn);
    const bend = parseBend(raw.bend, id);

    segments.push({
      id,
      typeId,
      provinceIdA,
      provinceIdB,
      ...(name === undefined ? {} : { name }),
      ...(nameEn === undefined ? {} : { nameEn }),
      ...(bend === undefined ? {} : { bend })
    });
  }

  return { schemaVersion: 1, segments };
}

function lineMidpoint(coordinates: readonly LonLat[]): LonLat {
  if (coordinates.length === 1) return coordinates[0]!;
  let total = 0;
  const lengths: number[] = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    const prev = coordinates[i - 1]!;
    const curr = coordinates[i]!;
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    total += Math.hypot(dx, dy);
    lengths.push(total);
  }
  if (total <= 1e-12) return coordinates[0]!;
  const half = total / 2;
  for (let i = 1; i < coordinates.length; i += 1) {
    if (lengths[i]! >= half) {
      const prev = coordinates[i - 1]!;
      const curr = coordinates[i]!;
      const segStart = lengths[i - 1]!;
      const segLen = lengths[i]! - segStart;
      const t = segLen <= 1e-12 ? 0 : (half - segStart) / segLen;
      return [prev[0] + (curr[0] - prev[0]) * t, prev[1] + (curr[1] - prev[1]) * t];
    }
  }
  return coordinates[coordinates.length - 1]!;
}

function unwrapLon(lon: number, ref: number): number {
  let x = lon;
  while (x - ref > 180) x -= 360;
  while (x - ref < -180) x += 360;
  return x;
}

function quadraticPoint(
  p0: LonLat,
  p1: LonLat,
  p2: LonLat,
  t: number
): LonLat {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
  ];
}

function cubicPoint(p0: LonLat, p1: LonLat, p2: LonLat, p3: LonLat, t: number): LonLat {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
  ];
}

function straightSampleCount(distance: number): number {
  return Math.max(4, Math.min(16, Math.ceil(distance / 2) + 4));
}

function closestPointOnSegment(point: LonLat, a: LonLat, b: LonLat): LonLat {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-18) return [a[0], a[1]];
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2));
  return [a[0] + dx * t, a[1] + dy * t];
}

function pointInEither(
  lon: number,
  lat: number,
  geomA: GeoJsonGeometry | undefined,
  geomB: GeoJsonGeometry | undefined
): boolean {
  if (geomA !== undefined && pointInGeometry(lon, lat, geomA)) return true;
  if (geomB !== undefined && pointInGeometry(lon, lat, geomB)) return true;
  return false;
}

function wrapPolyline(points: readonly LonLat[]): LonLat[] {
  return points.map((p) => [wrapLongitude(p[0]), p[1]] as const);
}

function unwrapPolyline(points: readonly LonLat[]): LonLat[] {
  if (points.length === 0) return [];
  const out: LonLat[] = [[points[0]![0], points[0]![1]]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = out[i - 1]!;
    const curr = points[i]!;
    out.push([unwrapLon(curr[0], prev[0]), curr[1]]);
  }
  return out;
}

function dedupeConsecutive(points: readonly LonLat[], eps = 1e-9): LonLat[] {
  const out: LonLat[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev !== undefined && Math.hypot(p[0] - prev[0], p[1] - prev[1]) <= eps) continue;
    out.push([p[0], p[1]]);
  }
  return out;
}

export function buildSharedBoundaryIndex(
  boundaries: readonly MapBoundary[]
): ReadonlyMap<string, readonly (readonly LonLat[])[]> {
  const byPair = new Map<string, LonLat[][]>();
  for (const boundary of boundaries) {
    if (boundary.rightProvinceId === null || boundary.coordinates.length === 0) continue;
    const key = adjacencyPairKey(boundary.leftProvinceId, boundary.rightProvinceId);
    const list = byPair.get(key) ?? [];
    list.push(boundary.coordinates.map((c) => [c[0], c[1]] as LonLat));
    byPair.set(key, list);
  }
  return byPair;
}

function polylineLength(coords: readonly LonLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += Math.hypot(coords[i]![0] - coords[i - 1]![0], coords[i]![1] - coords[i - 1]![1]);
  }
  return total;
}

function pickLongestBoundary(
  arcs: readonly (readonly LonLat[])[] | undefined
): LonLat[] | undefined {
  if (arcs === undefined || arcs.length === 0) return undefined;
  let best: LonLat[] | undefined;
  let bestLen = -1;
  for (const arc of arcs) {
    if (arc.length === 0) continue;
    const unwrapped = unwrapPolyline(arc);
    const len = polylineLength(unwrapped);
    if (len > bestLen) {
      bestLen = len;
      best = unwrapped;
    }
  }
  return best;
}

interface PolylineHit {
  readonly point: LonLat;
  readonly segmentIndex: number;
  readonly t: number;
  readonly dist: number;
}

function closestOnPolyline(point: LonLat, coords: readonly LonLat[]): PolylineHit | undefined {
  if (coords.length === 0) return undefined;
  if (coords.length === 1) {
    const only = coords[0]!;
    return {
      point: [only[0], only[1]],
      segmentIndex: 0,
      t: 0,
      dist: Math.hypot(point[0] - only[0], point[1] - only[1])
    };
  }
  let best: PolylineHit | undefined;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t =
      len2 <= 1e-18
        ? 0
        : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2));
    const candidate: LonLat = [a[0] + dx * t, a[1] + dy * t];
    const dist = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
    if (best === undefined || dist < best.dist) {
      best = { point: candidate, segmentIndex: i, t, dist };
    }
  }
  return best;
}

function perpendicularDistance(point: LonLat, a: LonLat, b: LonLat): number {
  const c = closestPointOnSegment(point, a, b);
  return Math.hypot(point[0] - c[0], point[1] - c[1]);
}

function douglasPeucker(points: readonly LonLat[], epsilon: number): LonLat[] {
  if (points.length <= 2) {
    return points.map((p) => [p[0], p[1]] as LonLat);
  }
  let maxDist = 0;
  let maxIndex = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i += 1) {
    const dist = perpendicularDistance(points[i]!, first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [
    [first[0], first[1]],
    [last[0], last[1]]
  ];
}

const RING_VERTEX_CAP = 48;
const RING_DP_EPSILON = 0.08;
const SHARED_SAMPLE_CAP = 16;
const UNION_PATH_INTERIOR_CAP = 8;

function sparsifyToMaxInterior(points: readonly LonLat[], maxInterior: number): LonLat[] {
  if (points.length <= maxInterior + 2) {
    return points.map((p) => [p[0], p[1]] as LonLat);
  }
  let epsilon = RING_DP_EPSILON;
  let result = douglasPeucker(points, epsilon);
  while (result.length - 2 > maxInterior && epsilon < 8) {
    epsilon *= 1.6;
    result = douglasPeucker(points, epsilon);
  }
  if (result.length - 2 > maxInterior) {
    const out: LonLat[] = [[result[0]![0], result[0]![1]]];
    for (let k = 1; k <= maxInterior; k += 1) {
      const idx = Math.round((k * (result.length - 1)) / (maxInterior + 1));
      out.push([result[idx]![0], result[idx]![1]]);
    }
    out.push([result[result.length - 1]![0], result[result.length - 1]![1]]);
    return dedupeConsecutive(out);
  }
  return result;
}

/** Dense samples along segment must lie in A∪B (boundary counts as inside). */
function segmentInsideUnion(
  a: LonLat,
  b: LonLat,
  geomA: GeoJsonGeometry | undefined,
  geomB: GeoJsonGeometry | undefined
): boolean {
  if (geomA === undefined && geomB === undefined) return true;
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(4, Math.min(32, Math.ceil(dist * 8) + 2));
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const lon = a[0] + (b[0] - a[0]) * t;
    const lat = a[1] + (b[1] - a[1]) * t;
    if (!pointInEither(wrapLongitude(lon), lat, geomA, geomB)) return false;
  }
  return true;
}

function listOuterRings(geom: GeoJsonGeometry): LonLat[][] {
  if (geom.type === "Polygon") {
    const outer = geom.coordinates[0];
    if (outer === undefined) return [];
    return [outer.map((c) => [c[0], c[1]] as LonLat)];
  }
  if (geom.type === "MultiPolygon") {
    const rings: LonLat[][] = [];
    for (const polygon of geom.coordinates) {
      const outer = polygon[0];
      if (outer === undefined) continue;
      rings.push(outer.map((c) => [c[0], c[1]] as LonLat));
    }
    return rings;
  }
  return [];
}

function pickOuterRing(geom: GeoJsonGeometry, point: LonLat): LonLat[] | undefined {
  const rings = listOuterRings(geom);
  if (rings.length === 0) return undefined;
  for (const ring of rings) {
    const asPoly: GeoJsonGeometry = { type: "Polygon", coordinates: [ring] };
    if (pointInGeometry(wrapLongitude(point[0]), point[1], asPoly)) {
      return unwrapPolyline(ring);
    }
  }
  let best: LonLat[] | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    const unwrapped = unwrapPolyline(ring);
    const hit = closestOnPolyline(point, unwrapped);
    if (hit !== undefined && hit.dist < bestDist) {
      bestDist = hit.dist;
      best = unwrapped;
    }
  }
  return best;
}

function openRingVertices(ring: readonly LonLat[]): LonLat[] {
  if (ring.length === 0) return [];
  let verts = ring.map((p) => [p[0], p[1]] as LonLat);
  if (
    verts.length >= 2 &&
    Math.hypot(
      verts[0]![0] - verts[verts.length - 1]![0],
      verts[0]![1] - verts[verts.length - 1]![1]
    ) <= 1e-9
  ) {
    verts = verts.slice(0, -1);
  }
  if (verts.length <= RING_VERTEX_CAP) return verts;
  const closed = [...verts, [verts[0]![0], verts[0]![1]] as LonLat];
  let epsilon = RING_DP_EPSILON;
  let sparse = douglasPeucker(closed, epsilon);
  while (sparse.length - 1 > RING_VERTEX_CAP && epsilon < 8) {
    epsilon *= 1.5;
    sparse = douglasPeucker(closed, epsilon);
  }
  if (
    sparse.length >= 2 &&
    Math.hypot(
      sparse[0]![0] - sparse[sparse.length - 1]![0],
      sparse[0]![1] - sparse[sparse.length - 1]![1]
    ) <= 1e-9
  ) {
    sparse = sparse.slice(0, -1);
  }
  if (sparse.length > RING_VERTEX_CAP) {
    const step = sparse.length / RING_VERTEX_CAP;
    const out: LonLat[] = [];
    for (let i = 0; i < RING_VERTEX_CAP; i += 1) {
      out.push(sparse[Math.min(sparse.length - 1, Math.floor(i * step))]!);
    }
    return dedupeConsecutive(out);
  }
  return sparse;
}

function appendUniqueNodes(
  nodes: LonLat[],
  candidates: readonly LonLat[],
  ref: LonLat
): void {
  for (const raw of candidates) {
    const p: LonLat = [unwrapLon(raw[0], ref[0]), raw[1]];
    let near = false;
    for (const existing of nodes) {
      if (Math.hypot(p[0] - existing[0], p[1] - existing[1]) <= 1e-7) {
        near = true;
        break;
      }
    }
    if (!near) nodes.push(p);
  }
}

function visibilityShortestPathInUnion(
  nodes: readonly LonLat[],
  geomA: GeoJsonGeometry | undefined,
  geomB: GeoJsonGeometry | undefined
): LonLat[] | undefined {
  const n = nodes.length;
  if (n < 2) return undefined;
  const dist = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(n).fill(-1);
  const used = new Array<boolean>(n).fill(false);
  dist[0] = 0;

  for (let iter = 0; iter < n; iter += 1) {
    let u = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i += 1) {
      if (!used[i] && dist[i]! < best) {
        best = dist[i]!;
        u = i;
      }
    }
    if (u < 0 || best === Number.POSITIVE_INFINITY) break;
    used[u] = true;
    if (u === n - 1) break;
    const from = nodes[u]!;
    for (let v = 0; v < n; v += 1) {
      if (used[v] || u === v) continue;
      const to = nodes[v]!;
      if (!segmentInsideUnion(from, to, geomA, geomB)) continue;
      const w = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const next = dist[u]! + w;
      if (next < dist[v]!) {
        dist[v] = next;
        prev[v] = u;
      }
    }
  }

  if (dist[n - 1] === Number.POSITIVE_INFINITY) return undefined;

  const pathIdx: number[] = [];
  for (let cur = n - 1; ; cur = prev[cur]!) {
    pathIdx.push(cur);
    if (cur === 0) break;
    if (prev[cur]! < 0) return undefined;
  }
  pathIdx.reverse();
  return pathIdx.map((i) => [nodes[i]![0], nodes[i]![1]] as LonLat);
}

/**
 * Shortest visibility path in A∪B (union-domain geodesic approximation).
 * Shared-boundary samples strengthen connectivity; they are not forced waypoints.
 */
function shortestPathInUnion(
  start: LonLat,
  end: LonLat,
  geomA: GeoJsonGeometry | undefined,
  geomB: GeoJsonGeometry | undefined,
  sharedBoundary?: readonly LonLat[]
): LonLat[] {
  const s: LonLat = [start[0], start[1]];
  const t: LonLat = [unwrapLon(end[0], start[0]), end[1]];
  if (segmentInsideUnion(s, t, geomA, geomB)) {
    return [s, t];
  }
  if (geomA === undefined && geomB === undefined) {
    return [s, t];
  }

  const mid: LonLat[] = [];
  if (geomA !== undefined) {
    const ringA = pickOuterRing(geomA, s);
    if (ringA !== undefined) {
      appendUniqueNodes(mid, openRingVertices(ringA), s);
    }
  }
  if (geomB !== undefined) {
    const ringB = pickOuterRing(geomB, t);
    if (ringB !== undefined) {
      appendUniqueNodes(mid, openRingVertices(ringB), s);
    }
  }
  if (sharedBoundary !== undefined && sharedBoundary.length > 0) {
    const shared = unwrapPolyline(sharedBoundary);
    const sparseShared = sparsifyToMaxInterior(shared, Math.max(1, SHARED_SAMPLE_CAP - 2));
    appendUniqueNodes(mid, sparseShared, s);
  }

  const filteredMid: LonLat[] = [];
  for (const p of mid) {
    if (Math.hypot(p[0] - s[0], p[1] - s[1]) <= 1e-7) continue;
    if (Math.hypot(p[0] - t[0], p[1] - t[1]) <= 1e-7) continue;
    filteredMid.push(p);
  }

  const graphNodes = [s, ...filteredMid, t];
  const path = visibilityShortestPathInUnion(graphNodes, geomA, geomB);
  if (path === undefined || path.length < 2) {
    return [s, t];
  }
  return sparsifyToMaxInterior(dedupeConsecutive(path), UNION_PATH_INTERIOR_CAP);
}

export interface SampleRoadCurveOptions {
  readonly geometryA?: GeoJsonGeometry;
  readonly geometryB?: GeoJsonGeometry;
  /** Optional shared-boundary samples to strengthen A∪B connectivity. */
  readonly sharedBoundary?: readonly LonLat[];
}

/**
 * Sample a road segment as LonLat polyline.
 * Default: straight if inside A∪B; else visibility shortest path in A∪B.
 */
export function sampleRoadSegmentCurve(
  segment: RoadSegment,
  capitalA: LonLat,
  capitalB: LonLat,
  _boundaryMid: LonLat | undefined,
  options: SampleRoadCurveOptions = {}
): LonLat[] {
  const aMap = lonLatToMapXY(capitalA[0], capitalA[1]);
  const bLon = unwrapLon(capitalB[0], aMap[0]);
  const bMap: LonLat = [bLon, capitalB[1]];
  const p0: LonLat = [aMap[0], aMap[1]];
  const pEnd: LonLat = bMap;

  if (segment.bend?.controlPoints.length === 2) {
    const c0 = segment.bend.controlPoints[0]!;
    const c1 = segment.bend.controlPoints[1]!;
    const p1: LonLat = [unwrapLon(c0[0], p0[0]), c0[1]];
    const p2: LonLat = [unwrapLon(c1[0], p0[0]), c1[1]];
    const dist = Math.hypot(pEnd[0] - p0[0], pEnd[1] - p0[1]);
    const n = straightSampleCount(dist);
    const samples: LonLat[] = [];
    for (let i = 0; i <= n; i += 1) {
      samples.push(cubicPoint(p0, p1, p2, pEnd, i / n));
    }
    return wrapPolyline(samples);
  }
  if (segment.bend?.controlPoints.length === 1) {
    const ctrl: LonLat = [
      unwrapLon(segment.bend.controlPoints[0]![0], p0[0]),
      segment.bend.controlPoints[0]![1]
    ];
    const dist = Math.hypot(pEnd[0] - p0[0], pEnd[1] - p0[1]);
    const n = straightSampleCount(dist);
    const samples: LonLat[] = [];
    for (let i = 0; i <= n; i += 1) {
      samples.push(quadraticPoint(p0, ctrl, pEnd, i / n));
    }
    return wrapPolyline(samples);
  }

  if (segmentInsideUnion(p0, pEnd, options.geometryA, options.geometryB)) {
    return wrapPolyline([p0, pEnd]);
  }

  if (options.geometryA !== undefined || options.geometryB !== undefined) {
    return wrapPolyline(
      shortestPathInUnion(
        p0,
        pEnd,
        options.geometryA,
        options.geometryB,
        options.sharedBoundary
      )
    );
  }

  return wrapPolyline([p0, pEnd]);
}

const BASE_LANE_SPACING = 0.35;
const PCB_JOG_MAX = 0.5;
const PCB_JOG_FRACTION = 0.12;

function segmentNormal(a: LonLat, b: LonLat): LonLat {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

function vertexNormal(points: readonly LonLat[], index: number): LonLat {
  if (points.length < 2) return [0, 1];
  if (index <= 0) return segmentNormal(points[0]!, points[1]!);
  if (index >= points.length - 1) {
    return segmentNormal(points[points.length - 2]!, points[points.length - 1]!);
  }
  const n0 = segmentNormal(points[index - 1]!, points[index]!);
  const n1 = segmentNormal(points[index]!, points[index + 1]!);
  const nx = n0[0] + n1[0];
  const ny = n0[1] + n1[1];
  const len = Math.hypot(nx, ny);
  if (len < 1e-12) return n0;
  return [nx / len, ny / len];
}

/**
 * PCB-style lane offset: short jogs near capitals, constant-offset parallel mid polyline.
 * Preserves interior waypoints of multi-bend land corridors.
 */
function offsetPolylineKeepEnds(points: readonly LonLat[], distance: number): LonLat[] {
  if (points.length < 2 || Math.abs(distance) < 1e-9) {
    return points.map((p) => [p[0], p[1]] as const);
  }
  const unwrapped = unwrapPolyline(points);
  const a = unwrapped[0]!;
  const b = unwrapped[unwrapped.length - 1]!;
  const totalLen = polylineLength(unwrapped);
  if (totalLen < 1e-12) {
    return wrapPolyline([a, b]);
  }

  let jog = Math.min(PCB_JOG_MAX, PCB_JOG_FRACTION * totalLen);
  if (2 * jog >= totalLen) {
    jog = totalLen * 0.25;
  }

  const firstSeg = segmentNormal(unwrapped[0]!, unwrapped[1]!);
  const lastSeg = segmentNormal(
    unwrapped[unwrapped.length - 2]!,
    unwrapped[unwrapped.length - 1]!
  );
  const t0x = unwrapped[1]![0] - unwrapped[0]![0];
  const t0y = unwrapped[1]![1] - unwrapped[0]![1];
  const t0len = Math.hypot(t0x, t0y) || 1;
  const tNx = unwrapped[unwrapped.length - 1]![0] - unwrapped[unwrapped.length - 2]![0];
  const tNy = unwrapped[unwrapped.length - 1]![1] - unwrapped[unwrapped.length - 2]![1];
  const tNlen = Math.hypot(tNx, tNy) || 1;

  const out: LonLat[] = [[a[0], a[1]]];
  if (jog >= 1e-9) {
    out.push([
      a[0] + (t0x / t0len) * jog + firstSeg[0] * distance,
      a[1] + (t0y / t0len) * jog + firstSeg[1] * distance
    ]);
  }

  for (let i = 1; i < unwrapped.length - 1; i += 1) {
    const n = vertexNormal(unwrapped, i);
    const p = unwrapped[i]!;
    out.push([p[0] + n[0] * distance, p[1] + n[1] * distance]);
  }

  if (jog >= 1e-9) {
    out.push([
      b[0] - (tNx / tNlen) * jog + lastSeg[0] * distance,
      b[1] - (tNy / tNlen) * jog + lastSeg[1] * distance
    ]);
  }
  out.push([b[0], b[1]]);
  return wrapPolyline(dedupeConsecutive(out));
}

function mainCurveTypeId(typeIds: readonly RoadTypeId[]): RoadTypeId {
  let best: RoadTypeId | undefined;
  let bestLane = Number.POSITIVE_INFINITY;
  let bestOrder = Number.POSITIVE_INFINITY;
  for (const typeId of typeIds) {
    const def = getRoadTypeDefinition(typeId);
    if (def === undefined) continue;
    if (def.laneIndex === 0) return typeId;
    if (
      Math.abs(def.laneIndex) < Math.abs(bestLane) ||
      (Math.abs(def.laneIndex) === Math.abs(bestLane) && def.drawOrder < bestOrder)
    ) {
      best = typeId;
      bestLane = def.laneIndex;
      bestOrder = def.drawOrder;
    }
  }
  return best ?? typeIds[0]!;
}

interface SegmentCurve {
  readonly segment: RoadSegment;
  readonly points: LonLat[];
}

function chainPolylines(
  segments: readonly SegmentCurve[]
): LonLat[][] {
  if (segments.length === 0) return [];

  const adj = new Map<string, { other: string; curve: SegmentCurve }[]>();
  const addEdge = (a: string, b: string, curve: SegmentCurve): void => {
    const list = adj.get(a) ?? [];
    list.push({ other: b, curve });
    adj.set(a, list);
  };
  for (const curve of segments) {
    addEdge(curve.segment.provinceIdA, curve.segment.provinceIdB, curve);
    addEdge(curve.segment.provinceIdB, curve.segment.provinceIdA, curve);
  }

  const used = new Set<string>();
  const paths: LonLat[][] = [];

  const startNodes = [...adj.keys()].filter((id) => (adj.get(id)?.length ?? 0) === 1);
  const seeds = startNodes.length > 0 ? startNodes : [...adj.keys()];

  for (const seed of seeds) {
    for (const edge of adj.get(seed) ?? []) {
      if (used.has(edge.curve.segment.id)) continue;
      const points: LonLat[] = [];
      let current = seed;
      let nextEdge = edge;
      while (nextEdge !== undefined && !used.has(nextEdge.curve.segment.id)) {
        used.add(nextEdge.curve.segment.id);
        const curve = nextEdge.curve;
        const forward = curve.segment.provinceIdA === current;
        const pts = forward ? curve.points : [...curve.points].reverse();
        if (points.length === 0) {
          points.push(...pts);
        } else {
          points.push(...pts.slice(1));
        }
        current = nextEdge.other;
        const candidates = (adj.get(current) ?? []).filter((e) => !used.has(e.curve.segment.id));
        nextEdge = candidates[0]!;
      }
      if (points.length >= 2) paths.push(points);
    }
  }

  for (const curve of segments) {
    if (used.has(curve.segment.id)) continue;
    paths.push(curve.points);
  }

  return paths;
}

export interface RoadDrawBatch {
  readonly typeId: RoadTypeId;
  readonly polylines: readonly (readonly LonLat[])[];
}

export interface BuildRoadDrawBatchesOptions {
  readonly capitals: ReadonlyMap<string, LonLat>;
  readonly boundaries: readonly MapBoundary[];
  /** When set, skip types whose maxVisibleHalfHeight is below this. */
  readonly halfHeight?: number;
  readonly baseLaneSpacing?: number;
  /** Province polygons for land-aware path selection (A∪B). */
  readonly provinceGeometryById?: ReadonlyMap<string, GeoJsonGeometry>;
}

export function buildRoadDrawBatches(
  segments: readonly RoadSegment[],
  options: BuildRoadDrawBatchesOptions
): RoadDrawBatch[] {
  const midpoints = buildBoundaryMidpointIndex(options.boundaries);
  const sharedBorders = buildSharedBoundaryIndex(options.boundaries);
  const spacing = options.baseLaneSpacing ?? BASE_LANE_SPACING;

  const byPair = new Map<string, RoadSegment[]>();
  for (const segment of segments) {
    const def = getRoadTypeDefinition(segment.typeId);
    if (def === undefined) continue;
    if (
      options.halfHeight !== undefined &&
      options.halfHeight > def.maxVisibleHalfHeight
    ) {
      continue;
    }
    const pair = adjacencyPairKey(segment.provinceIdA, segment.provinceIdB);
    const list = byPair.get(pair) ?? [];
    list.push(segment);
    byPair.set(pair, list);
  }

  const offsetCurves = new Map<RoadTypeId, SegmentCurve[]>();

  for (const [pair, pairSegments] of byPair) {
    const typeIds = pairSegments.map((s) => s.typeId);
    const mainType = mainCurveTypeId(typeIds);
    const mainSegment = pairSegments.find((s) => s.typeId === mainType)!;
    const capitalA = options.capitals.get(mainSegment.provinceIdA);
    const capitalB = options.capitals.get(mainSegment.provinceIdB);
    if (capitalA === undefined || capitalB === undefined) continue;

    const mid = midpoints.get(pair);
    const geomA = options.provinceGeometryById?.get(mainSegment.provinceIdA);
    const geomB = options.provinceGeometryById?.get(mainSegment.provinceIdB);
    const sharedBoundary = pickLongestBoundary(sharedBorders.get(pair));
    const mainPoints = sampleRoadSegmentCurve(mainSegment, capitalA, capitalB, mid, {
      ...(geomA === undefined ? {} : { geometryA: geomA }),
      ...(geomB === undefined ? {} : { geometryB: geomB }),
      ...(sharedBoundary === undefined ? {} : { sharedBoundary })
    });

    for (const segment of pairSegments) {
      const def = getRoadTypeDefinition(segment.typeId)!;
      const offset = def.laneIndex * spacing * def.laneSpacingScale;
      const points = offsetPolylineKeepEnds(mainPoints, offset);
      const list = offsetCurves.get(segment.typeId) ?? [];
      list.push({ segment, points });
      offsetCurves.set(segment.typeId, list);
    }
  }

  const batches: RoadDrawBatch[] = [];
  for (const typeDef of roadTypesSortedByDrawOrder()) {
    const curves = offsetCurves.get(typeDef.id);
    if (curves === undefined || curves.length === 0) continue;
    batches.push({
      typeId: typeDef.id,
      polylines: chainPolylines(curves)
    });
  }
  return batches;
}
