import type { GeoJsonGeometry, LonLat, MapFeature } from "./types.js";

function expandBBox(
  bbox: [number, number, number, number] | undefined,
  lon: number,
  lat: number
): [number, number, number, number] {
  if (bbox === undefined) {
    return [lon, lat, lon, lat];
  }
  return [
    Math.min(bbox[0], lon),
    Math.min(bbox[1], lat),
    Math.max(bbox[2], lon),
    Math.max(bbox[3], lat)
  ];
}

function walkCoordinates(
  geometry: GeoJsonGeometry,
  visit: (lon: number, lat: number) => void
): void {
  switch (geometry.type) {
    case "Point":
      visit(geometry.coordinates[0], geometry.coordinates[1]);
      break;
    case "MultiPoint":
    case "LineString":
      for (const point of geometry.coordinates) {
        visit(point[0], point[1]);
      }
      break;
    case "MultiLineString":
    case "Polygon":
      for (const ring of geometry.coordinates) {
        for (const point of ring) {
          visit(point[0], point[1]);
        }
      }
      break;
    case "MultiPolygon":
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          for (const point of ring) {
            visit(point[0], point[1]);
          }
        }
      }
      break;
  }
}

export function computeBBox(geometry: GeoJsonGeometry): readonly [number, number, number, number] {
  let bbox: [number, number, number, number] | undefined;
  walkCoordinates(geometry, (lon, lat) => {
    bbox = expandBBox(bbox, lon, lat);
  });
  return bbox ?? [0, 0, 0, 0];
}

export function pointInRing(lon: number, lat: number, ring: readonly LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function pointOnRing(lon: number, lat: number, ring: readonly LonLat[]): boolean {
  const tolerance = 1e-9;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, ay] = ring[j]!;
    const [bx, by] = ring[i]!;
    const cross = (lon - ax) * (by - ay) - (lat - ay) * (bx - ax);
    if (Math.abs(cross) > tolerance) continue;
    if (
      lon >= Math.min(ax, bx) - tolerance &&
      lon <= Math.max(ax, bx) + tolerance &&
      lat >= Math.min(ay, by) - tolerance &&
      lat <= Math.max(ay, by) + tolerance
    ) {
      return true;
    }
  }
  return false;
}

export function pointInPolygon(lon: number, lat: number, rings: readonly LonLat[][]): boolean {
  const outer = rings[0];
  // Treat the polygon boundary as part of the province. This matters for tiny
  // islands whose quantized geometry may have no numerically stable interior.
  if (rings.some((ring) => pointOnRing(lon, lat, ring))) {
    return true;
  }
  if (outer === undefined || !pointInRing(lon, lat, outer)) {
    return false;
  }
  for (let i = 1; i < rings.length; i += 1) {
    const hole = rings[i];
    if (hole !== undefined && pointInRing(lon, lat, hole)) {
      return false;
    }
  }
  return true;
}

export function pointInGeometry(lon: number, lat: number, geometry: GeoJsonGeometry): boolean {
  if (geometry.type === "Polygon") {
    return pointInPolygon(lon, lat, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => pointInPolygon(lon, lat, polygon));
  }
  return false;
}

export function pointInFeatureBBox(lon: number, lat: number, feature: MapFeature): boolean {
  const [minLon, minLat, maxLon, maxLat] = feature.bbox;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}
