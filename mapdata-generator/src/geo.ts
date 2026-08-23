import area from "@turf/area";
import polylabel from "polylabel";
import type {
  AreaGeometry,
  GeoJsonFeature,
  LonLat,
  MultiPolygonGeometry,
  PolygonGeometry
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function prop(properties: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (properties === null) return undefined;
  for (const key of keys) {
    const candidates = [key, key.toUpperCase(), key.toLowerCase()];
    for (const candidate of candidates) {
      const value = properties[candidate];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : undefined;
}

export function validCode(value: string | undefined): value is string {
  return value !== undefined && value !== "-99" && value !== "-1" && value.toLowerCase() !== "null";
}

export function geometryAreaKm2(geometry: AreaGeometry): number {
  const feature = {
    type: "Feature",
    properties: {},
    geometry
  } as const;
  return area(feature as never) / 1_000_000;
}

function segmentLengthKm(a: LonLat, b: LonLat): number {
  const radians = Math.PI / 180;
  const lat1 = a[1] * radians;
  const lat2 = b[1] * radians;
  const deltaLat = (b[1] - a[1]) * radians;
  const deltaLon = (b[0] - a[0]) * radians;
  const value =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 12_742 * Math.asin(Math.min(1, Math.sqrt(value)));
}

function unwrapLongitude(longitude: number, reference: number): number {
  let result = longitude;
  while (result - reference > 180) result -= 360;
  while (result - reference < -180) result += 360;
  return result;
}

function boundarySegments(geometry: AreaGeometry): Array<readonly [LonLat, LonLat]> {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const result: Array<readonly [LonLat, LonLat]> = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let index = 0; index + 1 < ring.length; index += 1) {
        result.push([ring[index]!, ring[index + 1]!]);
      }
    }
  }
  return result;
}

function pointToSegmentKm(point: LonLat, start: LonLat, end: LonLat): number {
  const referenceLon = point[0];
  const referenceLat = point[1];
  const cosLat = Math.max(0.01, Math.cos((referenceLat * Math.PI) / 180));
  const x1 = (unwrapLongitude(start[0], referenceLon) - referenceLon) * cosLat * 111.195;
  const y1 = (start[1] - referenceLat) * 111.195;
  const x2 = (unwrapLongitude(end[0], referenceLon) - referenceLon) * cosLat * 111.195;
  const y2 = (end[1] - referenceLat) * 111.195;
  const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (lengthSquared === 0) return segmentLengthKm(point, start);
  const projection = Math.max(0, Math.min(1, -(x1 * (x2 - x1) + y1 * (y2 - y1)) / lengthSquared));
  return Math.hypot(x1 + projection * (x2 - x1), y1 + projection * (y2 - y1));
}

/** Approximate spherical edge-to-edge distance, including antimeridian-safe segment projections. */
export function geometryGapKm(a: AreaGeometry, b: AreaGeometry): number {
  const aSegments = boundarySegments(a);
  const bSegments = boundarySegments(b);
  if (aSegments.length === 0 || bSegments.length === 0) return Number.POSITIVE_INFINITY;
  let result = Number.POSITIVE_INFINITY;
  for (const [start] of aSegments) {
    for (const [otherStart, otherEnd] of bSegments) {
      result = Math.min(result, pointToSegmentKm(start, otherStart, otherEnd));
    }
  }
  for (const [start] of bSegments) {
    for (const [otherStart, otherEnd] of aSegments) {
      result = Math.min(result, pointToSegmentKm(start, otherStart, otherEnd));
    }
  }
  return result;
}

export function geometryPerimeterKm(geometry: AreaGeometry): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let result = 0;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let index = 0; index + 1 < ring.length; index += 1) {
        result += segmentLengthKm(ring[index]!, ring[index + 1]!);
      }
    }
  }
  return result;
}

function ringCentroid(ring: readonly LonLat[]): LonLat {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross;
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) return ring[0] ?? [0, 0];
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

export function geometryCenter(geometry: AreaGeometry): LonLat {
  if (geometry.type === "Polygon") return ringCentroid(geometry.coordinates[0] ?? []);
  let largest: PolygonGeometry | undefined;
  let largestArea = -1;
  for (const coordinates of geometry.coordinates) {
    const polygon: PolygonGeometry = { type: "Polygon", coordinates };
    const polygonArea = geometryAreaKm2(polygon);
    if (polygonArea > largestArea) {
      largest = polygon;
      largestArea = polygonArea;
    }
  }
  return largest === undefined ? [0, 0] : ringCentroid(largest.coordinates[0] ?? []);
}

function pointInRing(point: LonLat, ring: readonly LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnRing(point: LonLat, ring: readonly LonLat[]): boolean {
  const tolerance = 1e-9;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j]!;
    const b = ring[i]!;
    const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) > tolerance) continue;
    if (
      point[0] >= Math.min(a[0], b[0]) - tolerance &&
      point[0] <= Math.max(a[0], b[0]) + tolerance &&
      point[1] >= Math.min(a[1], b[1]) - tolerance &&
      point[1] <= Math.max(a[1], b[1]) + tolerance
    ) {
      return true;
    }
  }
  return false;
}

function pointInPolygon(point: LonLat, polygon: readonly (readonly LonLat[])[]): boolean {
  const outer = polygon[0];
  if (polygon.some((ring) => pointOnRing(point, ring))) return true;
  if (outer === undefined || !pointInRing(point, outer)) return false;
  return polygon.slice(1).every((hole) => !pointInRing(point, hole));
}

export function pointInGeometry(point: LonLat, geometry: AreaGeometry): boolean {
  return geometry.type === "Polygon"
    ? pointInPolygon(point, geometry.coordinates)
    : geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
}

function largestPolygonCoordinates(geometry: AreaGeometry): LonLat[][] {
  if (geometry.type === "Polygon") return geometry.coordinates;
  let result: LonLat[][] = geometry.coordinates[0] ?? [];
  let resultArea = -1;
  for (const coordinates of geometry.coordinates) {
    const candidate: PolygonGeometry = { type: "Polygon", coordinates };
    const candidateArea = geometryAreaKm2(candidate);
    if (candidateArea > resultArea) {
      result = coordinates;
      resultArea = candidateArea;
    }
  }
  return result;
}

export function interiorPoint(geometry: AreaGeometry): LonLat {
  const polygon = largestPolygonCoordinates(geometry);
  if (polygon.length === 0) return geometryCenter(geometry);
  // Some Natural Earth island polygons are only a few ten-thousandths of a
  // degree wide. A coarse fixed precision can make polylabel return a vertex,
  // which the runtime correctly treats as outside the polygon.
  const point = polylabel(
    polygon.map((ring) => ring.map(([x, y]) => [x, y])),
    0.0000001
  );
  return [point[0], point[1]];
}

export function countVertices(geometry: AreaGeometry): number {
  return geometry.type === "Polygon"
    ? geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0)
    : geometry.coordinates.reduce(
        (sum, polygon) => sum + polygon.reduce((polygonSum, ring) => polygonSum + ring.length, 0),
        0
      );
}

export function normalizeAreaGeometry(
  feature: GeoJsonFeature,
  label: string
): AreaGeometry | undefined {
  const geometry = feature.geometry;
  if (geometry === null) return undefined;
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    throw new Error(`${label} has unsupported geometry ${geometry.type}.`);
  }
  return geometry;
}

export function asMultiPolygon(geometry: AreaGeometry): MultiPolygonGeometry {
  return geometry.type === "MultiPolygon"
    ? geometry
    : { type: "MultiPolygon", coordinates: [geometry.coordinates] };
}
