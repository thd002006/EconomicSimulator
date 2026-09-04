import { lonLatToMapXY, wrapLongitude } from "./map-projection.js";
import polygonClipping from "polygon-clipping";
import {
  isKnownRoadTypeId,
  getRoadTypeDefinition,
  roadTypesSortedByDrawOrder
} from "./road-types.js";
import { MapSchemaError, assertFiniteCoord } from "./schema.js";
import type {
  GeoJsonGeometry,
  LonLat,
  MapBoundary,
  RoadBendOverride,
  RoadCollection,
  RoadPairRoute,
  RoadPairRouteMode,
  RoadSegment,
  RoadTypeId,
  RuntimeRoadCollection
} from "./types.js";

export const EMPTY_ROAD_COLLECTION: RoadCollection = Object.freeze({
  schemaVersion: 1,
  segments: Object.freeze([])
});

export const EMPTY_RUNTIME_ROAD_COLLECTION: RuntimeRoadCollection = Object.freeze({
  schemaVersion: 2,
  routeInputHash: "empty",
  segments: Object.freeze([]),
  pairRoutes: Object.freeze([])
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

export function buildAdjacencyPairSet(boundaries: readonly MapBoundary[]): ReadonlySet<string> {
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
    throw new MapSchemaError(
      "ROAD_BEND_INVALID: bend must have controlPoints.",
      "roads",
      segmentId
    );
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

const ROAD_ROUTE_MODES = new Set<RoadPairRouteMode>([
  "union-shortest",
  "bend",
  "straight-fallback"
]);

function sameWrappedCoord(left: LonLat, right: LonLat, tolerance = 1e-7): boolean {
  return (
    Math.abs(unwrapLon(left[0], right[0]) - right[0]) <= tolerance &&
    Math.abs(left[1] - right[1]) <= tolerance
  );
}

export function parseRuntimeRoadCollection(
  input: unknown,
  context: RoadParseContext = {}
): RuntimeRoadCollection {
  if (!isRecord(input) || input.schemaVersion !== 2) {
    throw new MapSchemaError(
      "Compiled roads must use schemaVersion 2; run map:publish to rebuild the map pack.",
      "roads"
    );
  }
  const routeInputHash = asString(input.routeInputHash);
  if (
    routeInputHash === undefined ||
    !Array.isArray(input.segments) ||
    !Array.isArray(input.pairRoutes)
  ) {
    throw new MapSchemaError(
      "Compiled roads require routeInputHash, segments, and pairRoutes.",
      "roads"
    );
  }

  const definitions = parseRoadCollection({ schemaVersion: 1, segments: input.segments }, context);
  const referencedPairs = new Set(
    definitions.segments.map((segment) =>
      adjacencyPairKey(segment.provinceIdA, segment.provinceIdB)
    )
  );
  const seenPairs = new Set<string>();
  const pairRoutes: RoadPairRoute[] = [];

  for (const [index, raw] of input.pairRoutes.entries()) {
    if (!isRecord(raw)) {
      throw new MapSchemaError(`pairRoutes[${index}] is invalid.`, "roads");
    }
    const rawA = asString(raw.provinceIdA);
    const rawB = asString(raw.provinceIdB);
    if (rawA === undefined || rawB === undefined || rawA === rawB) {
      throw new MapSchemaError(`pairRoutes[${index}] requires distinct provinceIdA/B.`, "roads");
    }
    const provinceIdA = rawA < rawB ? rawA : rawB;
    const provinceIdB = rawA < rawB ? rawB : rawA;
    const pair = adjacencyPairKey(provinceIdA, provinceIdB);
    if (!referencedPairs.has(pair)) {
      throw new MapSchemaError(`ROAD_ROUTE_PAIR_UNUSED: ${pair}`, "roads");
    }
    if (seenPairs.has(pair)) {
      throw new MapSchemaError(`ROAD_ROUTE_PAIR_DUPLICATE: ${pair}`, "roads");
    }
    seenPairs.add(pair);

    if (typeof raw.mode !== "string" || !ROAD_ROUTE_MODES.has(raw.mode as RoadPairRouteMode)) {
      throw new MapSchemaError(`ROAD_ROUTE_MODE_INVALID: ${String(raw.mode)}`, "roads", pair);
    }
    if (!Array.isArray(raw.coordinates) || raw.coordinates.length < 2) {
      throw new MapSchemaError("ROAD_ROUTE_COORDINATES_INVALID", "roads", pair);
    }
    let coordinates = raw.coordinates.map((point, pointIndex) =>
      assertFiniteCoord(point, "roads", pair, `pairRoutes[${index}].coordinates[${pointIndex}]`)
    );

    if (rawA !== provinceIdA) coordinates = [...coordinates].reverse();
    const capitalA = context.capitals?.get(provinceIdA);
    const capitalB = context.capitals?.get(provinceIdB);
    if (
      capitalA !== undefined &&
      capitalB !== undefined &&
      (!sameWrappedCoord(coordinates[0]!, capitalA) ||
        !sameWrappedCoord(coordinates[coordinates.length - 1]!, capitalB))
    ) {
      throw new MapSchemaError("ROAD_ROUTE_ENDPOINT_MISMATCH", "roads", pair);
    }

    pairRoutes.push({
      provinceIdA,
      provinceIdB,
      mode: raw.mode as RoadPairRouteMode,
      coordinates
    });
  }

  for (const pair of referencedPairs) {
    if (!seenPairs.has(pair)) {
      throw new MapSchemaError(`ROAD_ROUTE_MISSING: ${pair}`, "roads");
    }
  }

  pairRoutes.sort((left, right) =>
    adjacencyPairKey(left.provinceIdA, left.provinceIdB).localeCompare(
      adjacencyPairKey(right.provinceIdA, right.provinceIdB)
    )
  );
  return {
    schemaVersion: 2,
    routeInputHash,
    segments: definitions.segments,
    pairRoutes
  };
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

function quadraticPoint(p0: LonLat, p1: LonLat, p2: LonLat, t: number): LonLat {
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

function wrapPolyline(points: readonly LonLat[]): LonLat[] {
  return points.map((p) => [wrapLongitude(p[0]), p[1]] as const);
}

function wrapRoadPolyline(points: readonly LonLat[], capitalA: LonLat, capitalB: LonLat): LonLat[] {
  const wrapped = wrapPolyline(points);
  if (wrapped.length >= 2) {
    wrapped[0] = [capitalA[0], capitalA[1]];
    wrapped[wrapped.length - 1] = [capitalB[0], capitalB[1]];
  }
  return wrapped;
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

type PolygonRing = LonLat[];
type PolygonDomain = PolygonRing[];
type MultiPolygonDomain = PolygonDomain[];

const GEOMETRY_EPSILON = 1e-9;

function closeRing(points: readonly LonLat[], referenceLon: number): PolygonRing {
  if (points.length === 0) return [];
  const result: LonLat[] = [[unwrapLon(points[0]![0], referenceLon), points[0]![1]]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = result[index - 1]!;
    const point = points[index]!;
    result.push([unwrapLon(point[0], previous[0]), point[1]]);
  }
  const first = result[0]!;
  const last = result[result.length - 1]!;
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > GEOMETRY_EPSILON) {
    result.push([first[0], first[1]]);
  }
  return result;
}

function geometryToMultiPolygon(
  geometry: GeoJsonGeometry,
  referenceLon: number
): MultiPolygonDomain {
  if (geometry.type === "Polygon") {
    const outer = closeRing(geometry.coordinates[0] ?? [], referenceLon);
    return [
      [
        outer,
        ...geometry.coordinates
          .slice(1)
          .map((ring) => closeRing(ring, outer[0]?.[0] ?? referenceLon))
      ]
    ];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((polygon) => {
      const outer = closeRing(polygon[0] ?? [], referenceLon);
      return [
        outer,
        ...polygon.slice(1).map((ring) => closeRing(ring, outer[0]?.[0] ?? referenceLon))
      ];
    });
  }
  throw new MapSchemaError("Road routing requires Polygon or MultiPolygon geometry.", "roads");
}

function pointOnSegment(point: LonLat, a: LonLat, b: LonLat): boolean {
  const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > GEOMETRY_EPSILON) return false;
  return (
    point[0] >= Math.min(a[0], b[0]) - GEOMETRY_EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + GEOMETRY_EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - GEOMETRY_EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + GEOMETRY_EPSILON
  );
}

function pointInDomain(point: LonLat, domain: PolygonDomain): boolean {
  let inside = false;
  for (const ring of domain) {
    for (
      let index = 0, previous = ring.length - 1;
      index < ring.length;
      previous = index, index += 1
    ) {
      const a = ring[previous]!;
      const b = ring[index]!;
      if (pointOnSegment(point, a, b)) return true;
      if (
        a[1] > point[1] !== b[1] > point[1] &&
        point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function cross(a: LonLat, b: LonLat): number {
  return a[0] * b[1] - a[1] * b[0];
}

function addBoundaryIntersectionParameters(
  values: number[],
  start: LonLat,
  end: LonLat,
  edgeStart: LonLat,
  edgeEnd: LonLat
): void {
  const direction: LonLat = [end[0] - start[0], end[1] - start[1]];
  const edgeDirection: LonLat = [edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]];
  const offset: LonLat = [edgeStart[0] - start[0], edgeStart[1] - start[1]];
  const denominator = cross(direction, edgeDirection);
  if (Math.abs(denominator) > GEOMETRY_EPSILON) {
    const t = cross(offset, edgeDirection) / denominator;
    const u = cross(offset, direction) / denominator;
    if (
      t >= -GEOMETRY_EPSILON &&
      t <= 1 + GEOMETRY_EPSILON &&
      u >= -GEOMETRY_EPSILON &&
      u <= 1 + GEOMETRY_EPSILON
    ) {
      values.push(Math.max(0, Math.min(1, t)));
    }
    return;
  }
  if (Math.abs(cross(offset, direction)) > GEOMETRY_EPSILON) return;
  const lengthSquared = direction[0] * direction[0] + direction[1] * direction[1];
  if (lengthSquared <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) return;
  for (const point of [edgeStart, edgeEnd]) {
    const t =
      ((point[0] - start[0]) * direction[0] + (point[1] - start[1]) * direction[1]) / lengthSquared;
    if (t >= -GEOMETRY_EPSILON && t <= 1 + GEOMETRY_EPSILON) {
      values.push(Math.max(0, Math.min(1, t)));
    }
  }
}

function segmentInsideDomain(
  start: LonLat,
  end: LonLat,
  domain: PolygonDomain,
  endpointsKnownInside = false
): boolean {
  if (!endpointsKnownInside && (!pointInDomain(start, domain) || !pointInDomain(end, domain))) {
    return false;
  }
  const parameters = [0, 1];
  for (const ring of domain) {
    for (let index = 1; index < ring.length; index += 1) {
      addBoundaryIntersectionParameters(parameters, start, end, ring[index - 1]!, ring[index]!);
    }
  }
  parameters.sort((left, right) => left - right);
  const unique = parameters.filter(
    (value, index) => index === 0 || Math.abs(value - parameters[index - 1]!) > GEOMETRY_EPSILON
  );
  for (let index = 1; index < unique.length; index += 1) {
    const from = unique[index - 1]!;
    const to = unique[index]!;
    if (to - from <= GEOMETRY_EPSILON) continue;
    const t = (from + to) / 2;
    if (
      !pointInDomain(
        [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t],
        domain
      )
    ) {
      return false;
    }
  }
  return true;
}

function ringArea(ring: readonly LonLat[]): number {
  let area = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const previous = ring[index - 1]!;
    const current = ring[index]!;
    area += previous[0] * current[1] - current[0] * previous[1];
  }
  return area / 2;
}

function reflexVertices(domain: PolygonDomain): LonLat[] {
  const result: LonLat[] = [];
  const seen = new Set<string>();
  for (const [ringIndex, closed] of domain.entries()) {
    const ring = closed.slice(0, -1);
    const area = ringArea(closed);
    if (ring.length < 3 || Math.abs(area) <= GEOMETRY_EPSILON) continue;
    for (let index = 0; index < ring.length; index += 1) {
      const previous = ring[(index + ring.length - 1) % ring.length]!;
      const current = ring[index]!;
      const next = ring[(index + 1) % ring.length]!;
      const turn = cross(
        [current[0] - previous[0], current[1] - previous[1]],
        [next[0] - current[0], next[1] - current[1]]
      );
      const needed =
        ringIndex === 0 ? turn * area < -GEOMETRY_EPSILON : turn * area > GEOMETRY_EPSILON;
      if (!needed) continue;
      const key = `${current[0].toFixed(10)},${current[1].toFixed(10)}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push([current[0], current[1]]);
      }
    }
  }
  return result;
}

function shortestVisibilityPath(
  start: LonLat,
  end: LonLat,
  domain: PolygonDomain
): LonLat[] | undefined {
  if (segmentInsideDomain(start, end, domain, true)) return [start, end];
  const candidates = reflexVertices(domain).filter(
    (point) =>
      Math.hypot(point[0] - start[0], point[1] - start[1]) > GEOMETRY_EPSILON &&
      Math.hypot(point[0] - end[0], point[1] - end[1]) > GEOMETRY_EPSILON
  );
  const nodes = [start, ...candidates, end];
  const target = nodes.length - 1;
  const distances = new Array<number>(nodes.length).fill(Number.POSITIVE_INFINITY);
  const previous = new Array<number>(nodes.length).fill(-1);
  const used = new Array<boolean>(nodes.length).fill(false);
  distances[0] = 0;

  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let current = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < nodes.length; index += 1) {
      const score =
        distances[index]! +
        Math.hypot(nodes[target]![0] - nodes[index]![0], nodes[target]![1] - nodes[index]![1]);
      if (!used[index] && score < bestScore) {
        current = index;
        bestScore = score;
      }
    }
    if (current < 0) break;
    if (current === target) break;
    used[current] = true;
    if (segmentInsideDomain(nodes[current]!, nodes[target]!, domain, true)) {
      const direct =
        distances[current]! +
        Math.hypot(nodes[target]![0] - nodes[current]![0], nodes[target]![1] - nodes[current]![1]);
      if (direct + GEOMETRY_EPSILON < distances[target]!) {
        distances[target] = direct;
        previous[target] = current;
      }
    }
    for (let next = 0; next < nodes.length; next += 1) {
      if (next === current || next === target || used[next]) continue;
      const edgeLength = Math.hypot(
        nodes[next]![0] - nodes[current]![0],
        nodes[next]![1] - nodes[current]![1]
      );
      const candidate = distances[current]! + edgeLength;
      const lowerBound =
        candidate +
        Math.hypot(nodes[target]![0] - nodes[next]![0], nodes[target]![1] - nodes[next]![1]);
      if (lowerBound + GEOMETRY_EPSILON >= distances[target]!) continue;
      if (!segmentInsideDomain(nodes[current]!, nodes[next]!, domain, true)) continue;
      const nextDistance = distances[current]! + edgeLength;
      if (nextDistance + GEOMETRY_EPSILON < distances[next]!) {
        distances[next] = nextDistance;
        previous[next] = current;
      }
    }
  }
  if (!Number.isFinite(distances[target])) return undefined;
  const indices: number[] = [];
  for (let current = target; current >= 0; current = previous[current]!) {
    indices.push(current);
    if (current === 0) break;
  }
  if (indices[indices.length - 1] !== 0) return undefined;
  indices.reverse();
  return indices.map((index) => nodes[index]!);
}

interface UnionRouteResult {
  readonly connected: boolean;
  readonly domain?: PolygonDomain;
  readonly points: LonLat[];
}

function buildUnionDomain(
  start: LonLat,
  end: LonLat,
  geometryA: GeoJsonGeometry,
  geometryB: GeoJsonGeometry
): { readonly start: LonLat; readonly end: LonLat; readonly domain?: PolygonDomain } {
  const normalizedStart: LonLat = [start[0], start[1]];
  const normalizedEnd: LonLat = [unwrapLon(end[0], start[0]), end[1]];
  let union: MultiPolygonDomain;
  try {
    union = polygonClipping.union(
      geometryToMultiPolygon(geometryA, normalizedStart[0]) as unknown as Parameters<
        typeof polygonClipping.union
      >[0],
      geometryToMultiPolygon(geometryB, normalizedStart[0]) as unknown as Parameters<
        typeof polygonClipping.union
      >[0]
    ) as MultiPolygonDomain;
  } catch (error) {
    throw new MapSchemaError(
      `ROAD_ROUTE_UNION_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      "roads"
    );
  }
  const domain = union.find(
    (candidate) =>
      pointInDomain(normalizedStart, candidate) && pointInDomain(normalizedEnd, candidate)
  );
  return {
    start: normalizedStart,
    end: normalizedEnd,
    ...(domain === undefined ? {} : { domain })
  };
}

function shortestPathInUnion(
  start: LonLat,
  end: LonLat,
  geometryA: GeoJsonGeometry,
  geometryB: GeoJsonGeometry
): UnionRouteResult {
  const built = buildUnionDomain(start, end, geometryA, geometryB);
  const normalizedStart = built.start;
  const normalizedEnd = built.end;
  const domain = built.domain;
  if (domain === undefined) {
    return { connected: false, points: [normalizedStart, normalizedEnd] };
  }
  const path = shortestVisibilityPath(normalizedStart, normalizedEnd, domain);
  if (path === undefined) {
    throw new MapSchemaError("ROAD_ROUTE_PATHFIND_FAILED", "roads");
  }
  return { connected: true, domain, points: dedupeConsecutive(path) };
}

export interface SampleRoadCurveOptions {
  readonly geometryA?: GeoJsonGeometry;
  readonly geometryB?: GeoJsonGeometry;
  /** Retained for source compatibility; the exact polygon union is authoritative. */
  readonly sharedBoundary?: readonly LonLat[];
}

function resolveRoadSegmentCurve(
  segment: RoadSegment,
  capitalA: LonLat,
  capitalB: LonLat,
  options: SampleRoadCurveOptions = {}
): { readonly mode: RoadPairRouteMode; readonly points: LonLat[] } {
  const aMap = lonLatToMapXY(capitalA[0], capitalA[1]);
  const bLon = unwrapLon(capitalB[0], aMap[0]);
  const bMap: LonLat = [bLon, capitalB[1]];
  const p0: LonLat = [aMap[0], aMap[1]];
  const pEnd: LonLat = bMap;

  let bendPoints: LonLat[] | undefined;
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
    bendPoints = samples;
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
    bendPoints = samples;
  }

  if (bendPoints !== undefined) {
    if (options.geometryA !== undefined && options.geometryB !== undefined) {
      const built = buildUnionDomain(p0, pEnd, options.geometryA, options.geometryB);
      if (
        built.domain === undefined ||
        bendPoints.some(
          (_, index) =>
            index > 0 &&
            !segmentInsideDomain(bendPoints[index - 1]!, bendPoints[index]!, built.domain!)
        )
      ) {
        throw new MapSchemaError("ROAD_BEND_OUTSIDE_UNION", "roads", segment.id);
      }
    }
    return { mode: "bend", points: wrapRoadPolyline(bendPoints, capitalA, capitalB) };
  }

  if (options.geometryA !== undefined && options.geometryB !== undefined) {
    const result = shortestPathInUnion(p0, pEnd, options.geometryA, options.geometryB);
    return {
      mode: result.connected ? "union-shortest" : "straight-fallback",
      points: wrapRoadPolyline(result.points, capitalA, capitalB)
    };
  }

  return {
    mode: "union-shortest",
    points: wrapRoadPolyline([p0, pEnd], capitalA, capitalB)
  };
}

export function sampleRoadSegmentCurve(
  segment: RoadSegment,
  capitalA: LonLat,
  capitalB: LonLat,
  _boundaryMid: LonLat | undefined,
  options: SampleRoadCurveOptions = {}
): LonLat[] {
  return resolveRoadSegmentCurve(segment, capitalA, capitalB, options).points;
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
  const lastSeg = segmentNormal(unwrapped[unwrapped.length - 2]!, unwrapped[unwrapped.length - 1]!);
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

interface SegmentCurve {
  readonly segment: RoadSegment;
  readonly points: LonLat[];
}

function chainPolylines(segments: readonly SegmentCurve[]): LonLat[][] {
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

export interface BuildRoadPairRoutesOptions {
  readonly capitals: ReadonlyMap<string, LonLat>;
  readonly provinceGeometryById?: ReadonlyMap<string, GeoJsonGeometry>;
  readonly onWarning?: (message: string) => void;
}

function bendSignature(bend: RoadBendOverride): string {
  return JSON.stringify(bend.controlPoints);
}

export function buildRoadPairRoutes(
  segments: readonly RoadSegment[],
  options: BuildRoadPairRoutesOptions
): RoadPairRoute[] {
  const byPair = new Map<string, RoadSegment[]>();
  for (const segment of segments) {
    const pair = adjacencyPairKey(segment.provinceIdA, segment.provinceIdB);
    const list = byPair.get(pair) ?? [];
    list.push(segment);
    byPair.set(pair, list);
  }

  const routes: RoadPairRoute[] = [];
  for (const pair of [...byPair.keys()].sort()) {
    const pairSegments = byPair.get(pair)!;
    const first = pairSegments[0]!;
    const capitalA = options.capitals.get(first.provinceIdA);
    const capitalB = options.capitals.get(first.provinceIdB);
    if (capitalA === undefined || capitalB === undefined) {
      throw new MapSchemaError("ROAD_CAPITAL_MISSING", "roads", pair);
    }

    const bends = pairSegments.flatMap((segment) =>
      segment.bend === undefined ? [] : [segment.bend]
    );
    const distinctBends = new Map(bends.map((bend) => [bendSignature(bend), bend]));
    if (distinctBends.size > 1) {
      throw new MapSchemaError("ROAD_BEND_CONFLICT", "roads", pair);
    }
    const bend = distinctBends.values().next().value as RoadBendOverride | undefined;
    const representative: RoadSegment = {
      ...first,
      ...(bend === undefined ? {} : { bend })
    };
    const geometryA = options.provinceGeometryById?.get(first.provinceIdA);
    const geometryB = options.provinceGeometryById?.get(first.provinceIdB);
    const resolved = resolveRoadSegmentCurve(representative, capitalA, capitalB, {
      ...(geometryA === undefined ? {} : { geometryA }),
      ...(geometryB === undefined ? {} : { geometryB })
    });
    if (resolved.mode === "straight-fallback") {
      options.onWarning?.(
        `ROAD_ROUTE_UNREACHABLE_FALLBACK: ${first.provinceIdA}|${first.provinceIdB}`
      );
    }
    routes.push({
      provinceIdA: first.provinceIdA,
      provinceIdB: first.provinceIdB,
      mode: resolved.mode,
      coordinates: resolved.points
    });
  }
  return routes;
}

export interface BuildRoadDrawBatchesOptions {
  readonly pairRoutes?: readonly RoadPairRoute[];
  readonly capitals?: ReadonlyMap<string, LonLat>;
  readonly boundaries?: readonly MapBoundary[];
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
  const spacing = options.baseLaneSpacing ?? BASE_LANE_SPACING;

  const byPair = new Map<string, RoadSegment[]>();
  for (const segment of segments) {
    const def = getRoadTypeDefinition(segment.typeId);
    if (def === undefined) continue;
    if (options.halfHeight !== undefined && options.halfHeight > def.maxVisibleHalfHeight) {
      continue;
    }
    const pair = adjacencyPairKey(segment.provinceIdA, segment.provinceIdB);
    const list = byPair.get(pair) ?? [];
    list.push(segment);
    byPair.set(pair, list);
  }

  const offsetCurves = new Map<RoadTypeId, SegmentCurve[]>();

  let pairRoutes = options.pairRoutes;
  if (pairRoutes === undefined) {
    if (options.capitals === undefined) {
      throw new MapSchemaError("Road drawing requires pairRoutes or capitals.", "roads");
    }
    pairRoutes = buildRoadPairRoutes(segments, {
      capitals: options.capitals,
      ...(options.provinceGeometryById === undefined
        ? {}
        : { provinceGeometryById: options.provinceGeometryById })
    });
  }
  const routeByPair = new Map(
    pairRoutes.map(
      (route) => [adjacencyPairKey(route.provinceIdA, route.provinceIdB), route] as const
    )
  );

  for (const [pair, pairSegments] of byPair) {
    const route = routeByPair.get(pair);
    if (route === undefined) {
      throw new MapSchemaError(`ROAD_ROUTE_MISSING: ${pair}`, "roads");
    }

    for (const segment of pairSegments) {
      const def = getRoadTypeDefinition(segment.typeId)!;
      const offset = pairSegments.length === 1 ? 0 : def.laneIndex * spacing * def.laneSpacingScale;
      const points = offsetPolylineKeepEnds(route.coordinates, offset);
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
