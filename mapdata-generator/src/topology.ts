import { createHash } from "node:crypto";
import type * as GeoJSON from "geojson";
import { feature, merge } from "topojson-client";
import { topology as createTopology } from "topojson-server";
import { presimplify, quantile, simplify } from "topojson-simplify";
import type {
  GeometryCollection,
  GeometryObject,
  MultiPolygon,
  Polygon,
  Topology
} from "topojson-specification";
import { geometryAreaKm2 } from "./geo.js";
import type {
  AreaGeometry,
  AuthoredProvinceProperties,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  LineGeometry,
  LonLat
} from "./types.js";

type TopologyProperties = Record<string, unknown>;
type PolygonObject = Polygon<TopologyProperties> | MultiPolygon<TopologyProperties>;
type WorkingTopology = Topology<Record<string, GeometryObject<TopologyProperties>>>;

function collectionObject(
  topology: Topology,
  name: string
): GeometryCollection<TopologyProperties> {
  const object = topology.objects[name];
  if (object?.type !== "GeometryCollection") {
    throw new Error(`Topology object ${name} is not a GeometryCollection.`);
  }
  return object as unknown as GeometryCollection<TopologyProperties>;
}

export function buildTopology(
  name: string,
  collection: GeoJsonFeatureCollection<AreaGeometry>,
  quantization = 100_000
): Topology {
  return createTopology(
    { [name]: collection as unknown as GeoJSON.FeatureCollection },
    quantization
  );
}

export function topologyGeometries(topology: Topology, name: string): PolygonObject[] {
  return collectionObject(topology, name).geometries.map((geometry, index) => {
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
      throw new Error(`${name}[${index}] is not polygonal.`);
    }
    return geometry;
  });
}

export function mergeGeometry(topology: Topology, members: readonly PolygonObject[]): AreaGeometry {
  return merge(
    topology,
    members as unknown as Array<Polygon | MultiPolygon>
  ) as unknown as AreaGeometry;
}

function topologyFeatureCollection(
  topology: Topology,
  name: string
): GeoJsonFeatureCollection<AreaGeometry> {
  const converted = feature(topology, collectionObject(topology, name));
  if (converted.type !== "FeatureCollection")
    throw new Error(`${name} did not convert to features.`);
  return converted as unknown as GeoJsonFeatureCollection<AreaGeometry>;
}

function validSimplifiedFeature(
  before: GeoJsonFeature<AreaGeometry>,
  after: GeoJsonFeature<AreaGeometry>
): boolean {
  if (before.geometry === null || after.geometry === null) return false;
  const beforeArea = geometryAreaKm2(before.geometry);
  const afterArea = geometryAreaKm2(after.geometry);
  const areaError = beforeArea === 0 ? 0 : Math.abs(afterArea - beforeArea) / beforeArea;
  if (areaError > 0.05) return false;

  const rings = (geometry: AreaGeometry): readonly (readonly LonLat[])[] =>
    geometry.type === "Polygon"
      ? geometry.coordinates
      : geometry.coordinates.flatMap((polygon) => polygon);
  const signedArea = (ring: readonly LonLat[]): number => {
    let result = 0;
    for (let index = 0; index + 1 < ring.length; index += 1) {
      const current = ring[index]!;
      const next = ring[index + 1]!;
      result += current[0] * next[1] - next[0] * current[1];
    }
    return result / 2;
  };
  const beforeRings = rings(before.geometry);
  const afterRings = rings(after.geometry);
  if (beforeRings.length !== afterRings.length) return false;
  for (let index = 0; index < afterRings.length; index += 1) {
    const beforeRing = beforeRings[index]!;
    const afterRing = afterRings[index]!;
    if (afterRing.length < Math.min(4, beforeRing.length)) return false;
    const first = afterRing[0]!;
    const last = afterRing[afterRing.length - 1]!;
    const beforeFirst = beforeRing[0]!;
    const beforeLast = beforeRing[beforeRing.length - 1]!;
    const beforeClosed = beforeFirst[0] === beforeLast[0] && beforeFirst[1] === beforeLast[1];
    if (beforeClosed && (first[0] !== last[0] || first[1] !== last[1])) return false;
    if (!afterRing.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)))
      return false;
    const beforeSignedArea = signedArea(beforeRing);
    const afterSignedArea = signedArea(afterRing);
    if (
      Math.abs(beforeSignedArea) > 1e-10 &&
      Math.abs(afterSignedArea) > 1e-10 &&
      Math.sign(beforeSignedArea) !== Math.sign(afterSignedArea)
    ) {
      return false;
    }
  }

  return true;
}

function simplifiedFeatureIssue(
  before: GeoJsonFeature<AreaGeometry>,
  after: GeoJsonFeature<AreaGeometry>
): string {
  if (before.geometry === null || after.geometry === null) return "null-geometry";
  const beforeArea = geometryAreaKm2(before.geometry);
  const afterArea = geometryAreaKm2(after.geometry);
  const areaError = beforeArea === 0 ? 0 : Math.abs(afterArea - beforeArea) / beforeArea;
  const ringCount = (geometry: AreaGeometry): number =>
    geometry.type === "Polygon"
      ? geometry.coordinates.length
      : geometry.coordinates.reduce((sum, polygon) => sum + polygon.length, 0);
  return `area=${(areaError * 100).toFixed(2)}%,rings=${ringCount(before.geometry)}/${ringCount(after.geometry)}`;
}

/** Topology-preserving weighted simplification with a global safety fallback. */
export function simplifyAuthoredTopology(
  topology: Topology,
  name: string,
  requestedRetainedFraction = 0.5
): { topology: Topology; retainedFraction: number } {
  if (
    !Number.isFinite(requestedRetainedFraction) ||
    requestedRetainedFraction <= 0 ||
    requestedRetainedFraction > 1
  ) {
    throw new Error("Retained arc fraction must be greater than 0 and no greater than 1.");
  }
  const original = topologyFeatureCollection(topology, name);
  const prepared = presimplify(topology as unknown as WorkingTopology);
  const remaining = 1 - requestedRetainedFraction;
  const candidates = [
    requestedRetainedFraction,
    requestedRetainedFraction + remaining * 0.3,
    requestedRetainedFraction + remaining * 0.6
  ].map((value) => Math.round(value * 1_000_000) / 1_000_000);
  for (const retainedFraction of [...new Set(candidates)]) {
    const threshold = quantile(prepared, retainedFraction);
    const candidate = simplify(prepared, threshold) as unknown as Topology;
    const converted = topologyFeatureCollection(candidate, name);
    const invalidIndices = converted.features.flatMap((after, index) =>
      validSimplifiedFeature(original.features[index]!, after) ? [] : [index]
    );
    const candidatePoints = candidate.arcs.reduce((sum, arc) => sum + arc.length, 0);
    console.log(
      `Simplification ${Math.round(retainedFraction * 100)}% kept ${candidatePoints} arc points and was rejected by ${invalidIndices.length} features: ${invalidIndices
        .slice(0, 8)
        .map((index) => String(original.features[index]?.id ?? index))
        .join(", ")}`
    );
    if (converted.features.length === original.features.length && invalidIndices.length === 0) {
      return { topology: candidate, retainedFraction };
    }
    if (converted.features.length === original.features.length) {
      const protectedTopology = structuredClone(prepared);
      const protectedGeometries = collectionObject(protectedTopology, name).geometries;
      const protectedIndices = new Set(invalidIndices);
      let pending = invalidIndices;
      let protectedCandidate: WorkingTopology | undefined;
      let protectedFeatures: GeoJsonFeatureCollection<AreaGeometry> | undefined;
      let stillInvalid = invalidIndices;
      for (let iteration = 0; iteration < 5 && pending.length > 0; iteration += 1) {
        for (const invalidIndex of pending) {
          const geometry = protectedGeometries[invalidIndex];
          if (geometry === undefined) continue;
          visitGeometryArcs(geometry, (arcIndex) => {
            for (const point of protectedTopology.arcs[arcIndex] ?? []) point[2] = Infinity;
          });
        }
        protectedCandidate = simplify(protectedTopology, threshold);
        protectedFeatures = topologyFeatureCollection(
          protectedCandidate as unknown as Topology,
          name
        );
        stillInvalid = protectedFeatures.features.flatMap((after, index) =>
          validSimplifiedFeature(original.features[index]!, after) ? [] : [index]
        );
        if (stillInvalid.length === 0) {
          console.log(`Protected ${protectedIndices.size} sensitive features at full detail.`);
          return { topology: protectedCandidate as unknown as Topology, retainedFraction };
        }
        pending = stillInvalid.filter((index) => !protectedIndices.has(index));
        pending.forEach((index) => protectedIndices.add(index));
      }
      console.log(
        `Protected candidate still invalid: ${stillInvalid
          .slice(0, 10)
          .map(
            (index) =>
              `${String(original.features[index]?.id ?? index)}(${simplifiedFeatureIssue(
                original.features[index]!,
                protectedFeatures!.features[index]!
              )})`
          )
          .join(", ")}`
      );
    }
  }
  return { topology, retainedFraction: 1 };
}

function visitGeometryArcs(
  geometry: GeometryObject<TopologyProperties>,
  callback: (arcIndex: number, outer: boolean) => void
): void {
  if (geometry.type === "Polygon") {
    geometry.arcs.forEach((ring, ringIndex) =>
      ring.forEach((arc) => callback(arc < 0 ? ~arc : arc, ringIndex === 0))
    );
  } else if (geometry.type === "MultiPolygon") {
    geometry.arcs.forEach((polygon) =>
      polygon.forEach((ring, ringIndex) =>
        ring.forEach((arc) => callback(arc < 0 ? ~arc : arc, ringIndex === 0))
      )
    );
  }
}

export function decodeArc(topology: Topology, arcIndex: number): LonLat[] {
  const arc = topology.arcs[arcIndex];
  if (arc === undefined) throw new Error(`Unknown topology arc ${arcIndex}.`);
  if (topology.transform === undefined) {
    return arc.map((point) => [roundCoordinate(point[0]!), roundCoordinate(point[1]!)] as const);
  }
  const result: LonLat[] = [];
  let x = 0;
  let y = 0;
  for (const point of arc) {
    x += point[0]!;
    y += point[1]!;
    result.push([
      roundCoordinate(x * topology.transform.scale[0] + topology.transform.translate[0]),
      roundCoordinate(y * topology.transform.scale[1] + topology.transform.translate[1])
    ]);
  }
  return result;
}

function lineLength(points: readonly LonLat[]): number {
  let result = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const radians = Math.PI / 180;
    const lat1 = a[1] * radians;
    const lat2 = b[1] * radians;
    const deltaLat = (b[1] - a[1]) * radians;
    const deltaLon = (b[0] - a[0]) * radians;
    const value =
      Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    result += 12_742 * Math.asin(Math.min(1, Math.sqrt(value)));
  }
  return result;
}

export interface AdjacencyData {
  readonly neighbors: readonly ReadonlySet<number>[];
  readonly sharedBorder: ReadonlyMap<string, number>;
  readonly exposedBoundary: readonly boolean[];
}

export function buildAdjacency(topology: Topology, name: string): AdjacencyData {
  const geometries = collectionObject(topology, name).geometries;
  const arcOwners = new Map<number, number[]>();
  geometries.forEach((geometry, owner) => {
    visitGeometryArcs(geometry, (arc) => {
      const owners = arcOwners.get(arc) ?? [];
      if (!owners.includes(owner)) owners.push(owner);
      arcOwners.set(arc, owners);
    });
  });
  const neighbors = geometries.map(() => new Set<number>());
  const exposedBoundary = geometries.map(() => false);
  const sharedBorder = new Map<string, number>();
  for (const [arc, owners] of arcOwners) {
    if (owners.length !== 2) {
      owners.forEach((owner) => (exposedBoundary[owner] = true));
      continue;
    }
    const [a, b] = owners.sort((left, right) => left - right) as [number, number];
    neighbors[a]!.add(b);
    neighbors[b]!.add(a);
    const key = `${a}:${b}`;
    sharedBorder.set(key, (sharedBorder.get(key) ?? 0) + lineLength(decodeArc(topology, arc)));
  }
  return { neighbors, sharedBorder, exposedBoundary };
}

function stableLineId(
  prefix: string,
  owners: readonly string[],
  coordinates: readonly LonLat[]
): string {
  const hash = createHash("sha1")
    .update(JSON.stringify([owners, coordinates]))
    .digest("hex")
    .slice(0, 12);
  return `${prefix}-${hash}`;
}

export function extractTopologyLines(
  topology: Topology,
  name: string
): {
  boundaries: Array<{
    id: string;
    leftProvinceId: string;
    rightProvinceId: string;
    coordinates: LonLat[];
  }>;
  coastlines: GeoJsonFeatureCollection<LineGeometry>;
} {
  const geometries = collectionObject(topology, name).geometries;
  const arcUsage = new Map<number, { owners: Set<string>; outer: boolean }>();
  geometries.forEach((geometry, index) => {
    const id = String(geometry.id ?? `province-${index}`);
    visitGeometryArcs(geometry, (arc, outer) => {
      const usage = arcUsage.get(arc) ?? { owners: new Set<string>(), outer: false };
      usage.owners.add(id);
      usage.outer ||= outer;
      arcUsage.set(arc, usage);
    });
  });
  const boundaries: Array<{
    id: string;
    leftProvinceId: string;
    rightProvinceId: string;
    coordinates: LonLat[];
  }> = [];
  const coastlines: GeoJsonFeature<LineGeometry>[] = [];
  const boundaryIds = new Set<string>();
  const coastlineIds = new Set<string>();
  for (const [arc, usage] of arcUsage) {
    const owners = [...usage.owners].sort();
    const coordinates = decodeArc(topology, arc);
    if (coordinates.length < 2) continue;
    if (owners.length === 2) {
      const id = stableLineId("boundary", owners, coordinates);
      if (boundaryIds.has(id)) continue;
      boundaryIds.add(id);
      boundaries.push({
        id,
        leftProvinceId: owners[0]!,
        rightProvinceId: owners[1]!,
        coordinates
      });
    } else if (owners.length === 1 && usage.outer) {
      const id = stableLineId("coast", owners, coordinates);
      if (coastlineIds.has(id)) continue;
      coastlineIds.add(id);
      coastlines.push({
        type: "Feature",
        id,
        properties: {},
        geometry: { type: "LineString", coordinates }
      });
    } else if (owners.length > 2) {
      throw new Error(`Arc ${arc} belongs to more than two provinces.`);
    }
  }
  boundaries.sort((a, b) => a.id.localeCompare(b.id));
  coastlines.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { boundaries, coastlines: { type: "FeatureCollection", features: coastlines } };
}

export function authoredFeaturesFromTopology(
  topology: Topology,
  name: string
): GeoJsonFeatureCollection<AreaGeometry> {
  const collection = topologyFeatureCollection(topology, name);
  for (const feature of collection.features) {
    if (feature.geometry === null) continue;
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let index = 0; index < ring.length; index += 1) {
          const point = ring[index]!;
          ring[index] = [roundCoordinate(point[0]), roundCoordinate(point[1])];
        }
        if (ring.length > 0) ring[ring.length - 1] = [...ring[0]!] as LonLat;
      }
    }
  }
  return collection;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

export function makeAuthoredFeature(
  id: string,
  properties: AuthoredProvinceProperties,
  geometry: AreaGeometry
): GeoJsonFeature<AreaGeometry> {
  return { type: "Feature", id, properties, geometry };
}
