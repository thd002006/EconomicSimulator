import type { GeoJsonGeometry, LonLat } from "./types.js";

export class MapSchemaError extends Error {
  readonly layer: string;
  readonly featureId: string | undefined;

  constructor(message: string, layer: string, featureId?: string) {
    super(featureId === undefined ? `[${layer}] ${message}` : `[${layer}:${featureId}] ${message}`);
    this.name = "MapSchemaError";
    this.layer = layer;
    this.featureId = featureId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertFiniteCoord(
  point: unknown,
  layer: string,
  featureId: string,
  path: string
): LonLat {
  if (!Array.isArray(point) || point.length < 2) {
    throw new MapSchemaError(`Invalid coordinate at ${path}.`, layer, featureId);
  }
  const lon = Number(point[0]);
  const lat = Number(point[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new MapSchemaError(`Non-finite coordinate at ${path}.`, layer, featureId);
  }
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new MapSchemaError(`Out-of-range coordinate at ${path}.`, layer, featureId);
  }
  return [lon, lat];
}

function parseRing(
  ring: unknown,
  layer: string,
  featureId: string,
  path: string,
  options?: { readonly minPoints?: number; readonly closed?: boolean }
): LonLat[] {
  const minPoints = options?.minPoints ?? 2;
  if (!Array.isArray(ring) || ring.length < minPoints) {
    throw new MapSchemaError(`Ring too short at ${path}.`, layer, featureId);
  }
  const coords = ring.map((point, index) =>
    assertFiniteCoord(point, layer, featureId, `${path}[${index}]`)
  );
  if (options?.closed === true) {
    const first = coords[0]!;
    const last = coords[coords.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw new MapSchemaError(`Polygon ring is not closed at ${path}.`, layer, featureId);
    }
  }
  return coords;
}

export function parsePolygonGeometry(
  value: unknown,
  layer: string,
  featureId: string
): Extract<GeoJsonGeometry, { type: "Polygon" | "MultiPolygon" }> {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new MapSchemaError("Geometry must be an object with type.", layer, featureId);
  }
  if (value.type === "Polygon") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
      throw new MapSchemaError("Polygon coordinates missing.", layer, featureId);
    }
    return {
      type: "Polygon",
      coordinates: value.coordinates.map((ring, index) =>
        parseRing(ring, layer, featureId, `coordinates[${index}]`, {
          minPoints: 4,
          closed: true
        })
      )
    };
  }
  if (value.type === "MultiPolygon") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
      throw new MapSchemaError("MultiPolygon coordinates missing.", layer, featureId);
    }
    return {
      type: "MultiPolygon",
      coordinates: value.coordinates.map((polygon, polygonIndex) => {
        if (!Array.isArray(polygon) || polygon.length === 0) {
          throw new MapSchemaError(
            `MultiPolygon part empty at coordinates[${polygonIndex}].`,
            layer,
            featureId
          );
        }
        return polygon.map((ring, ringIndex) =>
          parseRing(ring, layer, featureId, `coordinates[${polygonIndex}][${ringIndex}]`, {
            minPoints: 4,
            closed: true
          })
        );
      })
    };
  }
  throw new MapSchemaError(`Unsupported geometry type ${value.type}.`, layer, featureId);
}

export function parseLineGeometry(
  value: unknown,
  layer: string,
  featureId: string
): Extract<GeoJsonGeometry, { type: "LineString" | "MultiLineString" }> {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new MapSchemaError("Geometry must be an object with type.", layer, featureId);
  }
  if (value.type === "LineString") {
    return {
      type: "LineString",
      coordinates: parseRing(value.coordinates, layer, featureId, "coordinates", { minPoints: 2 })
    };
  }
  if (value.type === "MultiLineString") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
      throw new MapSchemaError("MultiLineString coordinates missing.", layer, featureId);
    }
    return {
      type: "MultiLineString",
      coordinates: value.coordinates.map((line, index) =>
        parseRing(line, layer, featureId, `coordinates[${index}]`, { minPoints: 2 })
      )
    };
  }
  throw new MapSchemaError(`Unsupported line geometry type ${value.type}.`, layer, featureId);
}

export function parsePointGeometry(
  value: unknown,
  layer: string,
  featureId: string
): Extract<GeoJsonGeometry, { type: "Point" }> {
  if (!isRecord(value) || value.type !== "Point") {
    throw new MapSchemaError("Expected Point geometry.", layer, featureId);
  }
  return {
    type: "Point",
    coordinates: assertFiniteCoord(value.coordinates, layer, featureId, "coordinates")
  };
}

export function parseBBox(
  value: unknown,
  layer: string,
  featureId: string
): readonly [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new MapSchemaError("bbox must be [minLon, minLat, maxLon, maxLat].", layer, featureId);
  }
  const bbox = value.map((entry, index) => {
    const number = Number(entry);
    if (!Number.isFinite(number)) {
      throw new MapSchemaError(`bbox[${index}] is not finite.`, layer, featureId);
    }
    return number;
  }) as [number, number, number, number];
  if (bbox[0] > bbox[2] || bbox[1] > bbox[3]) {
    throw new MapSchemaError("bbox min exceeds max.", layer, featureId);
  }
  return bbox;
}
