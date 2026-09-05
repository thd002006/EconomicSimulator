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

export const ROAD_STYLE_MAP_SCALE = 0.015;

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
  readonly provinceGeometryById?: ReadonlyMap<string, GeoJsonGeometry>;
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
      const pair = adjacencyPairKey(provinceIdA, provinceIdB);
      const geometryA = context.provinceGeometryById?.get(provinceIdA);
      const geometryB = context.provinceGeometryById?.get(provinceIdB);
      const capitalA = context.capitals?.get(provinceIdA);
      const capitalB = context.capitals?.get(provinceIdB);
      if (
        !context.adjacencyPairs.has(pair) &&
        (geometryA === undefined ||
          geometryB === undefined ||
          capitalA === undefined ||
          capitalB === undefined ||
          !provincePairHasRoutableBridge(
            provinceIdA,
            provinceIdB,
            geometryA,
            geometryB,
            context.provinceGeometryById!,
            capitalA,
            capitalB
          ))
      ) {
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
  "bridge-shortest",
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
  const bridgeAuthorizedPairs = new Set(
    context.adjacencyPairs === undefined
      ? []
      : definitions.segments
          .map((segment) => adjacencyPairKey(segment.provinceIdA, segment.provinceIdB))
          .filter((pair) => !context.adjacencyPairs!.has(pair))
  );
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
    if (
      raw.bridgeSegments !== undefined &&
      (!Array.isArray(raw.bridgeSegments) ||
        raw.bridgeSegments.some(
          (edge) =>
            !Number.isInteger(edge) ||
            (edge as number) < 0 ||
            (edge as number) >= coordinates.length - 1
        ))
    ) {
      throw new MapSchemaError("ROAD_ROUTE_BRIDGE_SEGMENTS_INVALID", "roads", pair);
    }
    let bridgeSegments =
      raw.bridgeSegments === undefined
        ? undefined
        : [...new Set(raw.bridgeSegments as number[])].sort((left, right) => left - right);
    if (raw.mode === "bridge-shortest" && (bridgeSegments?.length ?? 0) === 0) {
      throw new MapSchemaError("ROAD_ROUTE_BRIDGE_SEGMENTS_MISSING", "roads", pair);
    }
    if (
      raw.mode !== "bridge-shortest" &&
      raw.mode !== "bend" &&
      (bridgeSegments?.length ?? 0) > 0
    ) {
      throw new MapSchemaError("ROAD_ROUTE_BRIDGE_SEGMENTS_UNEXPECTED", "roads", pair);
    }

    if (rawA !== provinceIdA) {
      coordinates = [...coordinates].reverse();
      bridgeSegments = bridgeSegments
        ?.map((edge) => coordinates.length - 2 - edge)
        .sort((a, b) => a - b);
    }
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
    if (bridgeAuthorizedPairs.has(pair) && raw.mode === "straight-fallback") {
      throw new MapSchemaError("ROAD_ROUTE_GEOMETRY_INVALID", "roads", pair);
    }
    const geometryA = context.provinceGeometryById?.get(provinceIdA);
    const geometryB = context.provinceGeometryById?.get(provinceIdB);
    if (geometryA !== undefined && geometryB !== undefined && raw.mode !== "straight-fallback") {
      const routePoints = unwrapPolyline(coordinates);
      const built = buildUnionDomains(routePoints[0]!, routePoints.at(-1)!, geometryA, geometryB);
      const actualBridgeSegments = validPolylineBridgeSegments(
        routePoints,
        built.domains,
        context.provinceGeometryById,
        new Set([provinceIdA, provinceIdB]),
        DEFAULT_MAX_BRIDGE_SPAN_KM
      );
      if (
        actualBridgeSegments === undefined ||
        actualBridgeSegments.length !== (bridgeSegments?.length ?? 0) ||
        actualBridgeSegments.some((edge, edgeIndex) => edge !== bridgeSegments?.[edgeIndex])
      ) {
        throw new MapSchemaError("ROAD_ROUTE_GEOMETRY_INVALID", "roads", pair);
      }
    }

    pairRoutes.push({
      provinceIdA,
      provinceIdB,
      mode: raw.mode as RoadPairRouteMode,
      coordinates,
      ...(bridgeSegments === undefined || bridgeSegments.length === 0 ? {} : { bridgeSegments })
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
export const DEFAULT_MAX_BRIDGE_SPAN_KM = 20;

interface BridgeCandidate {
  readonly start: LonLat;
  readonly end: LonLat;
  readonly spanKm: number;
}

interface BridgeRouteResult {
  readonly connected: boolean;
  readonly points: LonLat[];
  readonly bridgeSegments: number[];
}

interface IndexedProvinceGeometry {
  readonly provinceId: string;
  readonly geometry: GeoJsonGeometry;
  readonly bounds: readonly [number, number, number, number];
}

interface IndexedBoundaryEdge {
  readonly start: LonLat;
  readonly end: LonLat;
  readonly minLon: number;
  readonly maxLon: number;
  readonly minLat: number;
  readonly maxLat: number;
}

const provinceGeometryIndexCache = new WeakMap<object, readonly IndexedProvinceGeometry[]>();
const domainBoundaryEdgeCache = new WeakMap<object, readonly IndexedBoundaryEdge[]>();

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

function indexedBoundaryEdges(domain: PolygonDomain): readonly IndexedBoundaryEdge[] {
  const cached = domainBoundaryEdgeCache.get(domain);
  if (cached !== undefined) return cached;
  const edges: IndexedBoundaryEdge[] = [];
  for (const ring of domain) {
    for (let index = 1; index < ring.length; index += 1) {
      const start = ring[index - 1]!;
      const end = ring[index]!;
      edges.push({
        start,
        end,
        minLon: Math.min(start[0], end[0]),
        maxLon: Math.max(start[0], end[0]),
        minLat: Math.min(start[1], end[1]),
        maxLat: Math.max(start[1], end[1])
      });
    }
  }
  edges.sort((left, right) => left.minLon - right.minLon);
  domainBoundaryEdgeCache.set(domain, edges);
  return edges;
}

function addDomainIntersectionParameters(
  values: number[],
  start: LonLat,
  end: LonLat,
  domain: PolygonDomain
): void {
  const minLon = Math.min(start[0], end[0]) - GEOMETRY_EPSILON;
  const maxLon = Math.max(start[0], end[0]) + GEOMETRY_EPSILON;
  const minLat = Math.min(start[1], end[1]) - GEOMETRY_EPSILON;
  const maxLat = Math.max(start[1], end[1]) + GEOMETRY_EPSILON;
  for (const edge of indexedBoundaryEdges(domain)) {
    if (edge.minLon > maxLon) break;
    if (edge.maxLon < minLon || edge.maxLat < minLat || edge.minLat > maxLat) {
      continue;
    }
    addBoundaryIntersectionParameters(values, start, end, edge.start, edge.end);
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
  addDomainIntersectionParameters(parameters, start, end, domain);
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

function pointInAnyDomain(point: LonLat, domains: MultiPolygonDomain): boolean {
  return domains.some((domain) => pointInDomain(point, domain));
}

function segmentInsideDomains(start: LonLat, end: LonLat, domains: MultiPolygonDomain): boolean {
  return domains.some(
    (domain) =>
      pointInDomain(start, domain) &&
      pointInDomain(end, domain) &&
      segmentInsideDomain(start, end, domain, true)
  );
}

function segmentIntervals(
  start: LonLat,
  end: LonLat,
  domains: MultiPolygonDomain
): Array<{ readonly from: number; readonly to: number; readonly inside: boolean }> {
  const parameters = [0, 1];
  for (const domain of domains) {
    addDomainIntersectionParameters(parameters, start, end, domain);
  }
  parameters.sort((left, right) => left - right);
  const unique = parameters.filter(
    (value, index) => index === 0 || Math.abs(value - parameters[index - 1]!) > GEOMETRY_EPSILON
  );
  const intervals: Array<{ from: number; to: number; inside: boolean }> = [];
  for (let index = 1; index < unique.length; index += 1) {
    const from = unique[index - 1]!;
    const to = unique[index]!;
    if (to - from <= GEOMETRY_EPSILON) continue;
    const middle = (from + to) / 2;
    intervals.push({
      from,
      to,
      inside: pointInAnyDomain(
        [start[0] + (end[0] - start[0]) * middle, start[1] + (end[1] - start[1]) * middle],
        domains
      )
    });
  }
  return intervals;
}

function interpolate(start: LonLat, end: LonLat, amount: number): LonLat {
  return [start[0] + (end[0] - start[0]) * amount, start[1] + (end[1] - start[1]) * amount];
}

function haversineKm(start: LonLat, end: LonLat): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (end[1] - start[1]) * radians;
  const longitudeDelta = (end[0] - start[0]) * radians;
  const latitudeA = start[1] * radians;
  const latitudeB = end[1] * radians;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 12_742 * Math.asin(Math.min(1, Math.sqrt(value)));
}

function segmentPassesThroughDomainInterior(
  start: LonLat,
  end: LonLat,
  domains: MultiPolygonDomain
): boolean {
  return segmentIntervals(start, end, domains).some((interval) => interval.inside);
}

function segmentCrossesThirdProvince(
  start: LonLat,
  end: LonLat,
  provinceGeometryById: ReadonlyMap<string, GeoJsonGeometry> | undefined,
  excludedProvinceIds: ReadonlySet<string>
): boolean {
  if (provinceGeometryById === undefined) return false;
  const minLon = Math.min(start[0], end[0]) - GEOMETRY_EPSILON;
  const maxLon = Math.max(start[0], end[0]) + GEOMETRY_EPSILON;
  const minLat = Math.min(start[1], end[1]) - GEOMETRY_EPSILON;
  const maxLat = Math.max(start[1], end[1]) + GEOMETRY_EPSILON;
  const cacheKey = provinceGeometryById as object;
  let geometryIndex = provinceGeometryIndexCache.get(cacheKey);
  if (geometryIndex === undefined) {
    geometryIndex = [...provinceGeometryById].map(([provinceId, geometry]) => {
      let geometryMinLon = Number.POSITIVE_INFINITY;
      let geometryMaxLon = Number.NEGATIVE_INFINITY;
      let geometryMinLat = Number.POSITIVE_INFINITY;
      let geometryMaxLat = Number.NEGATIVE_INFINITY;
      for (const domain of geometryToMultiPolygon(geometry, 0)) {
        for (const point of domain.flat()) {
          geometryMinLon = Math.min(geometryMinLon, point[0]);
          geometryMaxLon = Math.max(geometryMaxLon, point[0]);
          geometryMinLat = Math.min(geometryMinLat, point[1]);
          geometryMaxLat = Math.max(geometryMaxLat, point[1]);
        }
      }
      return {
        provinceId,
        geometry,
        bounds: [geometryMinLon, geometryMinLat, geometryMaxLon, geometryMaxLat]
      };
    });
    provinceGeometryIndexCache.set(cacheKey, geometryIndex);
  }
  for (const { provinceId, geometry, bounds } of geometryIndex) {
    if (excludedProvinceIds.has(provinceId)) continue;
    let boundsOverlap = false;
    for (const longitudeOffset of [-360, 0, 360]) {
      if (
        bounds[2] + longitudeOffset >= minLon &&
        bounds[0] + longitudeOffset <= maxLon &&
        bounds[3] >= minLat &&
        bounds[1] <= maxLat
      ) {
        boundsOverlap = true;
        break;
      }
    }
    if (!boundsOverlap) continue;
    const domains = geometryToMultiPolygon(geometry, start[0]);
    if (segmentPassesThroughDomainInterior(start, end, domains)) return true;
  }
  return false;
}

function validBridgeIntervals(
  start: LonLat,
  end: LonLat,
  domains: MultiPolygonDomain,
  provinceGeometryById: ReadonlyMap<string, GeoJsonGeometry> | undefined,
  excludedProvinceIds: ReadonlySet<string>,
  maxBridgeSpanKm: number,
  requireEntireInteriorWater = false
): boolean {
  const intervals = segmentIntervals(start, end, domains);
  const water = intervals.filter((interval) => !interval.inside);
  if (
    water.length === 0 ||
    (requireEntireInteriorWater && intervals.some((interval) => interval.inside))
  ) {
    return false;
  }
  for (const interval of water) {
    const waterStart = interpolate(start, end, interval.from);
    const waterEnd = interpolate(start, end, interval.to);
    if (
      haversineKm(waterStart, waterEnd) > maxBridgeSpanKm + 1e-6 ||
      segmentCrossesThirdProvince(waterStart, waterEnd, provinceGeometryById, excludedProvinceIds)
    ) {
      return false;
    }
  }
  return true;
}

function validPolylineBridgeSegments(
  points: readonly LonLat[],
  domains: MultiPolygonDomain,
  provinceGeometryById: ReadonlyMap<string, GeoJsonGeometry> | undefined,
  excludedProvinceIds: ReadonlySet<string>,
  maxBridgeSpanKm: number
): number[] | undefined {
  const bridgeSegments: number[] = [];
  let continuousBridgeKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    let usesBridge = false;
    for (const interval of segmentIntervals(start, end, domains)) {
      if (interval.inside) {
        continuousBridgeKm = 0;
        continue;
      }
      usesBridge = true;
      const waterStart = interpolate(start, end, interval.from);
      const waterEnd = interpolate(start, end, interval.to);
      continuousBridgeKm += haversineKm(waterStart, waterEnd);
      if (
        continuousBridgeKm > maxBridgeSpanKm + 1e-6 ||
        segmentCrossesThirdProvince(waterStart, waterEnd, provinceGeometryById, excludedProvinceIds)
      ) {
        return undefined;
      }
    }
    if (usesBridge) bridgeSegments.push(index - 1);
  }
  return bridgeSegments;
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

interface BoundaryEdge {
  readonly start: LonLat;
  readonly end: LonLat;
  readonly domainIndex: number;
  readonly ringIndex: number;
  readonly edgeIndex: number;
  readonly ringEdgeCount: number;
}

function boundaryEdges(domains: MultiPolygonDomain): BoundaryEdge[] {
  const edges: BoundaryEdge[] = [];
  for (const [domainIndex, domain] of domains.entries()) {
    for (const [ringIndex, ring] of domain.entries()) {
      const ringEdgeCount = Math.max(0, ring.length - 1);
      for (let edgeIndex = 0; edgeIndex < ringEdgeCount; edgeIndex += 1) {
        edges.push({
          start: ring[edgeIndex]!,
          end: ring[edgeIndex + 1]!,
          domainIndex,
          ringIndex,
          edgeIndex,
          ringEdgeCount
        });
      }
    }
  }
  return edges;
}

function closestPointOnSegmentProjected(
  point: LonLat,
  start: LonLat,
  end: LonLat,
  longitudeScale: number
): { readonly point: LonLat; readonly distanceKm: number } {
  const dx = (end[0] - start[0]) * longitudeScale;
  const dy = (end[1] - start[1]) * 110.57;
  const px = (point[0] - start[0]) * longitudeScale;
  const py = (point[1] - start[1]) * 110.57;
  const denominator = dx * dx + dy * dy;
  const amount =
    denominator <= 1e-12 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / denominator));
  const projected = interpolate(start, end, amount);
  return {
    point: projected,
    distanceKm: Math.hypot(
      (point[0] - projected[0]) * longitudeScale,
      (point[1] - projected[1]) * 110.57
    )
  };
}

function closestPointsBetweenEdges(left: BoundaryEdge, right: BoundaryEdge): BridgeCandidate {
  const latitude = (left.start[1] + left.end[1] + right.start[1] + right.end[1]) / 4;
  const longitudeScale = Math.max(1e-6, 111.32 * Math.cos((latitude * Math.PI) / 180));
  const candidates: BridgeCandidate[] = [];
  for (const point of [left.start, left.end]) {
    const projected = closestPointOnSegmentProjected(point, right.start, right.end, longitudeScale);
    candidates.push({ start: point, end: projected.point, spanKm: projected.distanceKm });
  }
  for (const point of [right.start, right.end]) {
    const projected = closestPointOnSegmentProjected(point, left.start, left.end, longitudeScale);
    candidates.push({ start: projected.point, end: point, spanKm: projected.distanceKm });
  }
  candidates.sort((a, b) => a.spanKm - b.spanKm);
  return candidates[0]!;
}

function edgesAreAdjacent(left: BoundaryEdge, right: BoundaryEdge): boolean {
  if (left.domainIndex !== right.domainIndex || left.ringIndex !== right.ringIndex) return false;
  const difference = Math.abs(left.edgeIndex - right.edgeIndex);
  return difference <= 1 || difference === left.ringEdgeCount - 1;
}

function bridgeCandidates(
  domains: MultiPolygonDomain,
  provinceGeometryById: ReadonlyMap<string, GeoJsonGeometry> | undefined,
  excludedProvinceIds: ReadonlySet<string>,
  maxBridgeSpanKm: number,
  stopAfterFirst = false,
  domainPair?: readonly [number, number],
  acceptCandidate?: (candidate: BridgeCandidate) => boolean
): BridgeCandidate[] {
  const edges = boundaryEdges(domains);
  const maxAbsoluteLatitude = edges.reduce(
    (maximum, edge) => Math.max(maximum, Math.abs(edge.start[1]), Math.abs(edge.end[1])),
    0
  );
  const latitudeTolerance = maxBridgeSpanKm / 110.57;
  const longitudeTolerance =
    maxBridgeSpanKm / (111.32 * Math.max(0.01, Math.cos((maxAbsoluteLatitude * Math.PI) / 180)));
  const indexedEdges = edges
    .map((edge, originalIndex) => ({
      edge,
      originalIndex,
      minLon: Math.min(edge.start[0], edge.end[0]),
      maxLon: Math.max(edge.start[0], edge.end[0]),
      minLat: Math.min(edge.start[1], edge.end[1]),
      maxLat: Math.max(edge.start[1], edge.end[1])
    }))
    .sort((left, right) => left.minLon - right.minLon);
  const nearby: Array<{
    readonly leftEdgeIndex: number;
    readonly rightEdgeIndex: number;
    readonly candidate: BridgeCandidate;
  }> = [];
  for (let leftIndex = 0; leftIndex < indexedEdges.length; leftIndex += 1) {
    const left = indexedEdges[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < indexedEdges.length; rightIndex += 1) {
      const right = indexedEdges[rightIndex]!;
      if (right.minLon > left.maxLon + longitudeTolerance) break;
      if (
        right.maxLon < left.minLon - longitudeTolerance ||
        right.minLat > left.maxLat + latitudeTolerance ||
        right.maxLat < left.minLat - latitudeTolerance ||
        (domainPair !== undefined &&
          !(
            (left.edge.domainIndex === domainPair[0] && right.edge.domainIndex === domainPair[1]) ||
            (left.edge.domainIndex === domainPair[1] && right.edge.domainIndex === domainPair[0])
          )) ||
        edgesAreAdjacent(left.edge, right.edge)
      ) {
        continue;
      }
      const candidate = closestPointsBetweenEdges(left.edge, right.edge);
      if (
        candidate.spanKm > 1e-6 &&
        candidate.spanKm <= maxBridgeSpanKm + 1e-6 &&
        (acceptCandidate === undefined || acceptCandidate(candidate))
      ) {
        nearby.push({
          leftEdgeIndex: left.originalIndex,
          rightEdgeIndex: right.originalIndex,
          candidate
        });
      }
    }
  }
  nearby.sort((left, right) => left.candidate.spanKm - right.candidate.spanKm);
  const bestByEdge = new Map<number, BridgeCandidate>();
  for (const { leftEdgeIndex, rightEdgeIndex, candidate } of nearby) {
    if (bestByEdge.has(leftEdgeIndex) && bestByEdge.has(rightEdgeIndex)) continue;
    if (
      !validBridgeIntervals(
        candidate.start,
        candidate.end,
        domains,
        provinceGeometryById,
        excludedProvinceIds,
        maxBridgeSpanKm,
        true
      )
    ) {
      continue;
    }
    if (stopAfterFirst) return [candidate];
    for (const edgeIndex of [leftEdgeIndex, rightEdgeIndex]) {
      if (!bestByEdge.has(edgeIndex)) bestByEdge.set(edgeIndex, candidate);
    }
  }
  const unique = new Map<string, BridgeCandidate>();
  for (const candidate of bestByEdge.values()) {
    const forward = `${candidate.start[0].toFixed(9)},${candidate.start[1].toFixed(9)}|${candidate.end[0].toFixed(9)},${candidate.end[1].toFixed(9)}`;
    const reverse = `${candidate.end[0].toFixed(9)},${candidate.end[1].toFixed(9)}|${candidate.start[0].toFixed(9)},${candidate.start[1].toFixed(9)}`;
    unique.set(forward < reverse ? forward : reverse, candidate);
  }
  return [...unique.values()].sort((left, right) => left.spanKm - right.spanKm);
}

function nodeKey(point: LonLat): string {
  return `${point[0].toFixed(10)},${point[1].toFixed(10)}`;
}

function shortestVisibilityPath(
  start: LonLat,
  end: LonLat,
  domains: MultiPolygonDomain,
  bridges: readonly BridgeCandidate[]
): { readonly points: LonLat[]; readonly bridgeSegments: number[] } | undefined {
  if (segmentInsideDomains(start, end, domains))
    return { points: [start, end], bridgeSegments: [] };
  const candidates = domains
    .flatMap((domain) => reflexVertices(domain))
    .filter(
      (point) =>
        Math.hypot(point[0] - start[0], point[1] - start[1]) > GEOMETRY_EPSILON &&
        Math.hypot(point[0] - end[0], point[1] - end[1]) > GEOMETRY_EPSILON
    );
  const nodes: LonLat[] = [];
  const nodeIndexByKey = new Map<string, number>();
  const addNode = (point: LonLat): number => {
    const key = nodeKey(point);
    const existing = nodeIndexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push(point);
    nodeIndexByKey.set(key, index);
    return index;
  };
  addNode(start);
  for (const candidate of candidates) addNode(candidate);
  const bridgeEdges = new Set<string>();
  for (const bridge of bridges) {
    const from = addNode(bridge.start);
    const to = addNode(bridge.end);
    bridgeEdges.add(from < to ? `${from}|${to}` : `${to}|${from}`);
  }
  const target = addNode(end);
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
    const directKey = current < target ? `${current}|${target}` : `${target}|${current}`;
    if (
      bridgeEdges.has(directKey) ||
      segmentInsideDomains(nodes[current]!, nodes[target]!, domains)
    ) {
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
      const edgeKey = current < next ? `${current}|${next}` : `${next}|${current}`;
      if (
        !bridgeEdges.has(edgeKey) &&
        !segmentInsideDomains(nodes[current]!, nodes[next]!, domains)
      ) {
        continue;
      }
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
  const bridgeSegments: number[] = [];
  for (let index = 1; index < indices.length; index += 1) {
    const from = indices[index - 1]!;
    const to = indices[index]!;
    const edgeKey = from < to ? `${from}|${to}` : `${to}|${from}`;
    if (bridgeEdges.has(edgeKey)) bridgeSegments.push(index - 1);
  }
  return { points: indices.map((index) => nodes[index]!), bridgeSegments };
}

function buildUnionDomains(
  start: LonLat,
  end: LonLat,
  geometryA: GeoJsonGeometry,
  geometryB: GeoJsonGeometry
): { readonly start: LonLat; readonly end: LonLat; readonly domains: MultiPolygonDomain } {
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
  return { start: normalizedStart, end: normalizedEnd, domains: union };
}

function shortestPathWithBridges(
  start: LonLat,
  end: LonLat,
  geometryA: GeoJsonGeometry,
  geometryB: GeoJsonGeometry,
  provinceGeometryById: ReadonlyMap<string, GeoJsonGeometry> | undefined,
  excludedProvinceIds: ReadonlySet<string>,
  maxBridgeSpanKm: number
): BridgeRouteResult {
  const built = buildUnionDomains(start, end, geometryA, geometryB);
  const normalizedStart = built.start;
  const normalizedEnd = built.end;
  if (
    validBridgeIntervals(
      normalizedStart,
      normalizedEnd,
      built.domains,
      provinceGeometryById,
      excludedProvinceIds,
      maxBridgeSpanKm
    )
  ) {
    return { connected: true, points: [normalizedStart, normalizedEnd], bridgeSegments: [0] };
  }
  const startDomainIndex = built.domains.findIndex((domain) =>
    pointInDomain(normalizedStart, domain)
  );
  const endDomainIndex = built.domains.findIndex((domain) => pointInDomain(normalizedEnd, domain));
  const connectedDomain = built.domains.find(
    (domain) => pointInDomain(normalizedStart, domain) && pointInDomain(normalizedEnd, domain)
  );
  if (connectedDomain !== undefined) {
    const landPath = shortestVisibilityPath(normalizedStart, normalizedEnd, [connectedDomain], []);
    if (landPath === undefined) throw new MapSchemaError("ROAD_ROUTE_PATHFIND_FAILED", "roads");
    return { connected: true, points: landPath.points, bridgeSegments: [] };
  }
  const bridges = bridgeCandidates(
    built.domains,
    provinceGeometryById,
    excludedProvinceIds,
    maxBridgeSpanKm,
    false,
    [startDomainIndex, endDomainIndex]
  );
  const routeDomains = [built.domains[startDomainIndex], built.domains[endDomainIndex]].filter(
    (domain): domain is PolygonDomain => domain !== undefined
  );
  const path = shortestVisibilityPath(normalizedStart, normalizedEnd, routeDomains, bridges);
  if (path === undefined) {
    return {
      connected: false,
      points: [normalizedStart, normalizedEnd],
      bridgeSegments: []
    };
  }
  return {
    connected: true,
    points: path.points,
    bridgeSegments: path.bridgeSegments
  };
}

export function provincePairHasRoutableBridge(
  provinceIdA: string,
  provinceIdB: string,
  geometryA: GeoJsonGeometry,
  geometryB: GeoJsonGeometry,
  provinceGeometryById: ReadonlyMap<string, GeoJsonGeometry>,
  capitalA: LonLat,
  capitalB: LonLat,
  maxBridgeSpanKm = DEFAULT_MAX_BRIDGE_SPAN_KM
): boolean {
  const result = shortestPathWithBridges(
    capitalA,
    capitalB,
    geometryA,
    geometryB,
    provinceGeometryById,
    new Set([provinceIdA, provinceIdB]),
    maxBridgeSpanKm
  );
  return result.connected && result.bridgeSegments.length > 0;
}

export function segmentUsesValidBridgeSpan(
  start: LonLat,
  end: LonLat,
  provinceIdA: string,
  provinceIdB: string,
  provinceGeometryById: ReadonlyMap<string, GeoJsonGeometry>,
  maxBridgeSpanKm = DEFAULT_MAX_BRIDGE_SPAN_KM
): boolean {
  const geometryA = provinceGeometryById.get(provinceIdA);
  const geometryB = provinceGeometryById.get(provinceIdB);
  if (geometryA === undefined || geometryB === undefined) return false;
  const built = buildUnionDomains(start, end, geometryA, geometryB);
  return validBridgeIntervals(
    built.start,
    built.end,
    built.domains,
    provinceGeometryById,
    new Set([provinceIdA, provinceIdB]),
    maxBridgeSpanKm
  );
}

export interface SampleRoadCurveOptions {
  readonly geometryA?: GeoJsonGeometry;
  readonly geometryB?: GeoJsonGeometry;
  readonly provinceGeometryById?: ReadonlyMap<string, GeoJsonGeometry>;
  readonly excludedProvinceIds?: ReadonlySet<string>;
  readonly maxBridgeSpanKm?: number;
}

function resolveRoadSegmentCurve(
  segment: RoadSegment,
  capitalA: LonLat,
  capitalB: LonLat,
  options: SampleRoadCurveOptions = {}
): {
  readonly mode: RoadPairRouteMode;
  readonly points: LonLat[];
  readonly bridgeSegments: number[];
} {
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
      const built = buildUnionDomains(p0, pEnd, options.geometryA, options.geometryB);
      const bridgeSegments = validPolylineBridgeSegments(
        bendPoints,
        built.domains,
        options.provinceGeometryById,
        options.excludedProvinceIds ?? new Set(),
        options.maxBridgeSpanKm ?? DEFAULT_MAX_BRIDGE_SPAN_KM
      );
      if (bridgeSegments === undefined) {
        throw new MapSchemaError("ROAD_BEND_OUTSIDE_UNION", "roads", segment.id);
      }
      return {
        mode: "bend",
        points: wrapRoadPolyline(bendPoints, capitalA, capitalB),
        bridgeSegments
      };
    }
    return {
      mode: "bend",
      points: wrapRoadPolyline(bendPoints, capitalA, capitalB),
      bridgeSegments: []
    };
  }

  if (options.geometryA !== undefined && options.geometryB !== undefined) {
    const result = shortestPathWithBridges(
      p0,
      pEnd,
      options.geometryA,
      options.geometryB,
      options.provinceGeometryById,
      options.excludedProvinceIds ?? new Set(),
      options.maxBridgeSpanKm ?? DEFAULT_MAX_BRIDGE_SPAN_KM
    );
    return {
      mode: result.connected
        ? result.bridgeSegments.length > 0
          ? "bridge-shortest"
          : "union-shortest"
        : "straight-fallback",
      points: wrapRoadPolyline(result.points, capitalA, capitalB),
      bridgeSegments: result.bridgeSegments
    };
  }

  return {
    mode: "union-shortest",
    points: wrapRoadPolyline([p0, pEnd], capitalA, capitalB),
    bridgeSegments: []
  };
}

export function sampleRoadSegmentCurve(
  segment: RoadSegment,
  capitalA: LonLat,
  capitalB: LonLat,
  options: SampleRoadCurveOptions = {}
): LonLat[] {
  return resolveRoadSegmentCurve(segment, capitalA, capitalB, options).points;
}

const PCB_JOG_MAX = 0.5;
const PCB_JOG_FRACTION = 0.12;
const LANE_GAP_WIDTH_RATIO = 0.5;

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

export interface RoadRibbonMesh {
  readonly vertices: readonly LonLat[];
  readonly indices: readonly number[];
}

export interface BuildRoadRibbonMeshOptions {
  readonly width: number;
  readonly dashSize?: number;
  readonly gapSize?: number;
}

export function buildRoadRibbonMesh(
  polylines: readonly (readonly LonLat[])[],
  options: BuildRoadRibbonMeshOptions
): RoadRibbonMesh {
  const vertices: LonLat[] = [];
  const indices: number[] = [];
  const halfWidth = options.width / 2;

  const appendRibbon = (source: readonly LonLat[]): void => {
    const points = dedupeConsecutive(unwrapPolyline(source));
    if (points.length < 2) return;
    const normals: LonLat[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1]!;
      const end = points[index]!;
      const normal = segmentNormal(start, end);
      normals.push(normal);
      const vertexOffset = vertices.length;
      vertices.push(
        [start[0] + normal[0] * halfWidth, start[1] + normal[1] * halfWidth],
        [start[0] - normal[0] * halfWidth, start[1] - normal[1] * halfWidth],
        [end[0] + normal[0] * halfWidth, end[1] + normal[1] * halfWidth],
        [end[0] - normal[0] * halfWidth, end[1] - normal[1] * halfWidth]
      );
      indices.push(
        vertexOffset,
        vertexOffset + 1,
        vertexOffset + 2,
        vertexOffset + 1,
        vertexOffset + 3,
        vertexOffset + 2
      );
    }

    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = points[index - 1]!;
      const point = points[index]!;
      const next = points[index + 1]!;
      const turn =
        (point[0] - previous[0]) * (next[1] - point[1]) -
        (point[1] - previous[1]) * (next[0] - point[0]);
      if (Math.abs(turn) <= 1e-12) continue;
      const previousNormal = normals[index - 1]!;
      const nextNormal = normals[index]!;
      const side = turn > 0 ? -1 : 1;
      const previousOuter: LonLat = [
        point[0] + previousNormal[0] * halfWidth * side,
        point[1] + previousNormal[1] * halfWidth * side
      ];
      const nextOuter: LonLat = [
        point[0] + nextNormal[0] * halfWidth * side,
        point[1] + nextNormal[1] * halfWidth * side
      ];
      const vertexOffset = vertices.length;
      vertices.push([point[0], point[1]], previousOuter, nextOuter);
      if (turn > 0) {
        indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
      } else {
        indices.push(vertexOffset, vertexOffset + 2, vertexOffset + 1);
      }
    }
  };

  const dashed =
    options.dashSize !== undefined &&
    options.gapSize !== undefined &&
    options.dashSize > 0 &&
    options.gapSize > 0;
  for (const source of polylines) {
    if (!dashed) {
      appendRibbon(source);
      continue;
    }
    const points = dedupeConsecutive(unwrapPolyline(source));
    let drawing = true;
    let intervalDistance = 0;
    let dash: LonLat[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1]!;
      const end = points[index]!;
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const segmentLength = Math.hypot(dx, dy);
      let segmentDistance = 0;
      while (segmentDistance < segmentLength - 1e-12) {
        const intervalLength = drawing ? options.dashSize! : options.gapSize!;
        const step = Math.min(segmentLength - segmentDistance, intervalLength - intervalDistance);
        const from: LonLat = [
          start[0] + (dx * segmentDistance) / segmentLength,
          start[1] + (dy * segmentDistance) / segmentLength
        ];
        segmentDistance += step;
        const to: LonLat = [
          start[0] + (dx * segmentDistance) / segmentLength,
          start[1] + (dy * segmentDistance) / segmentLength
        ];
        if (drawing) {
          if (dash.length === 0) dash.push(from);
          dash.push(to);
        }
        intervalDistance += step;
        if (intervalDistance >= intervalLength - 1e-12) {
          if (drawing) appendRibbon(dash);
          dash = [];
          drawing = !drawing;
          intervalDistance = 0;
        }
      }
    }
    if (drawing && dash.length >= 2) appendRibbon(dash);
  }

  return { vertices, indices };
}

export interface BuildRoadPairRoutesOptions {
  readonly capitals: ReadonlyMap<string, LonLat>;
  readonly provinceGeometryById?: ReadonlyMap<string, GeoJsonGeometry>;
  readonly maxBridgeSpanKm?: number;
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
      ...(geometryB === undefined ? {} : { geometryB }),
      ...(options.provinceGeometryById === undefined
        ? {}
        : { provinceGeometryById: options.provinceGeometryById }),
      excludedProvinceIds: new Set([first.provinceIdA, first.provinceIdB]),
      maxBridgeSpanKm: options.maxBridgeSpanKm ?? DEFAULT_MAX_BRIDGE_SPAN_KM
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
      coordinates: resolved.points,
      ...(resolved.bridgeSegments.length === 0 ? {} : { bridgeSegments: resolved.bridgeSegments })
    });
  }
  return routes;
}

export interface BuildRoadDrawBatchesOptions {
  readonly pairRoutes?: readonly RoadPairRoute[];
  readonly capitals?: ReadonlyMap<string, LonLat>;
  /** When set, skip types whose maxVisibleHalfHeight is below this. */
  readonly halfHeight?: number;
  /** Province polygons for land-aware path selection (A∪B). */
  readonly provinceGeometryById?: ReadonlyMap<string, GeoJsonGeometry>;
}

export function buildRoadDrawBatches(
  segments: readonly RoadSegment[],
  options: BuildRoadDrawBatchesOptions
): RoadDrawBatch[] {
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

    const orderedSegments = [...pairSegments].sort((a, b) => {
      const aLane = getRoadTypeDefinition(a.typeId)?.laneIndex ?? 0;
      const bLane = getRoadTypeDefinition(b.typeId)?.laneIndex ?? 0;
      return aLane - bLane;
    });
    const centersStyleUnits = new Map<RoadTypeId, number>();
    if (orderedSegments.length > 1) {
      let cursor = 0;
      for (const [index, segment] of orderedSegments.entries()) {
        const def = getRoadTypeDefinition(segment.typeId)!;
        const width = def.casingWidth ?? def.lineWidth;
        if (index > 0) {
          const previousDef = getRoadTypeDefinition(orderedSegments[index - 1]!.typeId)!;
          const previousWidth = previousDef.casingWidth ?? previousDef.lineWidth;
          cursor += Math.min(previousWidth, width) * LANE_GAP_WIDTH_RATIO;
        }
        centersStyleUnits.set(segment.typeId, cursor + width / 2);
        cursor += width;
      }
      for (const [typeId, center] of centersStyleUnits) {
        centersStyleUnits.set(typeId, center - cursor / 2);
      }
    }

    for (const segment of pairSegments) {
      const def = getRoadTypeDefinition(segment.typeId)!;
      const offset = (centersStyleUnits.get(def.id) ?? 0) * ROAD_STYLE_MAP_SCALE;
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
