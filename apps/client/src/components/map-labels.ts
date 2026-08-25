import {
  computeBBox,
  lonLatToMapXY,
  pointInGeometry,
  wrapLongitude,
  type CountryNameTable,
  type GeoJsonGeometry,
  type ProvinceFeature
} from "@economic-simulator/map-runtime";
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { MAP_WRAP } from "./map-controls.js";

/**
 * Tunable zoom LOD for map labels (`halfHeight`, smaller = more zoomed in).
 * Country and province names share one switch: never both visible at once.
 */
export const mapLabelLod = {
  /**
   * Shared country/province switch.
   * - halfHeight > detailHalfHeight → all country names, no provinces
   * - halfHeight ≤ detailHalfHeight → province names only, no countries
   */
  detailHalfHeight: 10
};

/** @deprecated Prefer mapLabelLod.detailHalfHeight */
export const COUNTRY_LABEL_HALF_HEIGHT = mapLabelLod.detailHalfHeight;
/** @deprecated Prefer mapLabelLod.detailHalfHeight */
export const PROVINCE_LABEL_HALF_HEIGHT = mapLabelLod.detailHalfHeight;
export const MAJOR_COUNTRY_MIN_PROVINCES = 12;
/** Capitals farther apart than this (degrees) can still form one landmass if bboxes are near. */
export const LANDMASS_GAP_DEGREES = 12;
/** Provinces whose bboxes are within this gap are treated as contiguous (e.g. WA–SA). */
export const LANDMASS_BBOX_GAP_DEGREES = 4;
type LonLatBBox = readonly [number, number, number, number];
const GEOMETRY_SAMPLE_LIMIT = 96;
const BASELINE_SAMPLES = 18;
/** Fraction of path length available for text before spacing caps. */
const PATH_FILL_RATIO = 0.55;
/** How much of the sampled curve to keep vs a straight chord (0 = straight). */
const PATH_BEND_STRENGTH = 0.22;
/** Max letter tilt relative to the overall path direction. */
const MAX_GLYPH_TILT_DEG = 18;
/** Minimum center-to-center glyph spacing in em (uppercase serif advance). */
export const MIN_GLYPH_ADVANCE_EM = 0.72;
/** Absolute floor when shrinking to avoid overlap on short paths. */
const ABSOLUTE_MIN_FONT_PX = 8;
/** Match land tile offsets so labels appear on every visible wrap copy. */
export const LABEL_WRAP_OFFSETS = [-MAP_WRAP, 0, MAP_WRAP] as const;

export type MapLabelKind = "country-major" | "country" | "province";

export interface LabelPoint {
  readonly x: number;
  readonly y: number;
}

export interface MapLabelSpec {
  readonly id: string;
  readonly kind: MapLabelKind;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly provinceCount: number;
  /** Map-space centerline used for curved glyph layout. */
  readonly path: readonly LabelPoint[];
  /** Static fallbacks used when path projection is unavailable. */
  readonly rotationDeg: number;
  readonly fontSizePx: number;
}

export interface GlyphLayout {
  readonly fontSizePx: number;
  readonly glyphs: readonly {
    readonly char: string;
    readonly x: number;
    readonly y: number;
    readonly rotationDeg: number;
  }[];
}

export function labelVisibility(halfHeight: number, kind: MapLabelKind): boolean {
  const showProvinces = halfHeight <= mapLabelLod.detailHalfHeight;
  if (kind === "province") return showProvinces;
  // country + country-major: visible whenever provinces are hidden
  return !showProvinces;
}

export function wrapLabelX(baseX: number, cameraX: number): number {
  let x = baseX;
  while (x - cameraX > MAP_WRAP / 2) x -= MAP_WRAP;
  while (cameraX - x > MAP_WRAP / 2) x += MAP_WRAP;
  return x;
}

/** Translate a path rigidly so its midpoint wraps toward the camera (avoids per-point jumps). */
export function wrapPathToCamera(path: readonly LabelPoint[], cameraX: number): LabelPoint[] {
  if (path.length === 0) return [];
  const anchor = pathAnchor(path, path[0]!);
  const dx = wrapLabelX(anchor.x, cameraX) - anchor.x;
  if (Math.abs(dx) < 1e-9) return [...path];
  return path.map((point) => ({ x: point.x + dx, y: point.y }));
}

function unwrapLon(lon: number, reference: number): number {
  let value = lon;
  if (value - reference > 180) value -= 360;
  if (reference - value > 180) value += 360;
  return value;
}

function capitalDistanceDegrees(a: LabelPoint, b: LabelPoint): number {
  const dx = unwrapLon(b.x, a.x) - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function signedRingArea(ring: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const [x0, y0] = ring[previous]!;
    const [x1, y1] = ring[index]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

/** Area in deg² with per-polygon longitude unwrapping (avoids Alaska antimeridian blow-up). */
export function geometryAreaDegrees(geometry: GeoJsonGeometry): number {
  const polygonArea = (rings: readonly (readonly (readonly [number, number])[])[]): number => {
    const outer = rings[0];
    if (outer === undefined || outer.length < 3) return 0;
    const origin = outer[0]![0];
    const unwrapRing = (ring: readonly (readonly [number, number])[]) =>
      ring.map(([lon, lat]) => [unwrapLon(lon, origin), lat] as const);
    let area = Math.abs(signedRingArea(unwrapRing(outer)));
    for (let index = 1; index < rings.length; index += 1) {
      const hole = rings[index];
      if (hole !== undefined && hole.length >= 3) {
        area -= Math.abs(signedRingArea(unwrapRing(hole)));
      }
    }
    return Math.max(0, area);
  };
  if (geometry.type === "Polygon") return polygonArea(geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
  }
  return 0;
}

function provinceAreaDegrees(feature: ProvinceFeature): number {
  const fromGeometry = geometryAreaDegrees(feature.geometry);
  if (fromGeometry > 0) return fromGeometry;
  const bbox =
    feature.bbox !== undefined && feature.bbox.length === 4
      ? feature.bbox
      : computeBBox(feature.geometry);
  let width = bbox[2] - bbox[0];
  if (width > 180) width = 360 - width;
  return Math.max(0, width) * Math.max(0, bbox[3] - bbox[1]);
}

function featureBBox(feature: ProvinceFeature): LonLatBBox {
  if (feature.bbox !== undefined && feature.bbox.length === 4) {
    return feature.bbox;
  }
  return computeBBox(feature.geometry);
}

function bboxGapDegrees(a: LonLatBBox, b: LonLatBBox): number {
  // Antimeridian-wide boxes are unreliable for proximity (Alaska Aleutians).
  if (a[2] - a[0] > 180 || b[2] - b[0] > 180) return Number.POSITIVE_INFINITY;
  const anchor = (a[0] + a[2]) / 2;
  const normalize = (box: LonLatBBox): LonLatBBox => {
    const x0 = unwrapLon(box[0], anchor);
    const x1 = unwrapLon(box[2], anchor);
    return [Math.min(x0, x1), box[1], Math.max(x0, x1), box[3]];
  };
  const left = normalize(a);
  const right = normalize(b);
  const dx = left[2] < right[0] ? right[0] - left[2] : right[2] < left[0] ? left[0] - right[2] : 0;
  const dy = left[3] < right[1] ? right[1] - left[3] : right[3] < left[1] ? left[1] - right[3] : 0;
  return Math.hypot(dx, dy);
}

function landmassLinked(
  a: { point: LabelPoint; bbox: LonLatBBox },
  b: { point: LabelPoint; bbox: LonLatBBox },
  capitalGap = LANDMASS_GAP_DEGREES,
  bboxGap = LANDMASS_BBOX_GAP_DEGREES
): boolean {
  if (capitalDistanceDegrees(a.point, b.point) <= capitalGap) return true;
  return bboxGapDegrees(a.bbox, b.bbox) <= bboxGap;
}

/**
 * Keep only the largest contiguous landmass (by area) so overseas territories
 * do not pull country labels off the homeland. Contiguity uses capital proximity
 * or near/touching bboxes so large states like Western Australia stay attached.
 */
export function selectPrimaryLandmass<
  T extends { point: LabelPoint; area: number; bbox: LonLatBBox }
>(members: readonly T[]): T[] {
  if (members.length <= 1) return [...members];
  const parent = members.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]!]!;
      current = parent[current]!;
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft !== rootRight) parent[rootRight] = rootLeft;
  };
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      if (landmassLinked(members[i]!, members[j]!)) union(i, j);
    }
  }
  const clusters = new Map<number, T[]>();
  for (let index = 0; index < members.length; index += 1) {
    const root = find(index);
    const bucket = clusters.get(root) ?? [];
    bucket.push(members[index]!);
    clusters.set(root, bucket);
  }
  let best: T[] = [];
  let bestArea = -1;
  for (const cluster of clusters.values()) {
    const area = cluster.reduce((sum, member) => sum + member.area, 0);
    if (area > bestArea) {
      best = cluster;
      bestArea = area;
    }
  }
  return best;
}

function fontSizeRange(kind: MapLabelKind): { min: number; max: number } {
  if (kind === "country-major") return { min: 14, max: 40 };
  if (kind === "country") return { min: 11, max: 22 };
  return { min: 9, max: 16 };
}

function maxGlyphGapEm(kind: MapLabelKind): number {
  if (kind === "country-major") return 2.1;
  if (kind === "country") return 1.5;
  return 1.2;
}

function meanPoint(points: readonly LabelPoint[]): LabelPoint {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

export function principalAxis(points: readonly LabelPoint[]): {
  mean: LabelPoint;
  axisX: number;
  axisY: number;
  normalX: number;
  normalY: number;
  minProj: number;
  maxProj: number;
  extent: number;
} {
  const mean = points.length === 0 ? { x: 0, y: 0 } : meanPoint(points);
  if (points.length < 2) {
    return {
      mean,
      axisX: 1,
      axisY: 0,
      normalX: 0,
      normalY: 1,
      minProj: 0,
      maxProj: 0,
      extent: 0
    };
  }

  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const dx = point.x - mean.x;
    const dy = point.y - mean.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }

  const trace = xx + yy;
  const det = xx * yy - xy * xy;
  const discriminant = Math.max(0, (trace * trace) / 4 - det);
  const eigen = trace / 2 + Math.sqrt(discriminant);
  let axisX = 1;
  let axisY = 0;
  if (Math.abs(xy) > 1e-12 || Math.abs(eigen - yy) > 1e-12) {
    axisX = eigen - yy;
    axisY = xy;
  } else if (yy > xx) {
    axisX = 0;
    axisY = 1;
  }
  const axisLength = Math.hypot(axisX, axisY) || 1;
  axisX /= axisLength;
  axisY /= axisLength;
  const normalX = -axisY;
  const normalY = axisX;

  let minProj = Number.POSITIVE_INFINITY;
  let maxProj = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const proj = (point.x - mean.x) * axisX + (point.y - mean.y) * axisY;
    minProj = Math.min(minProj, proj);
    maxProj = Math.max(maxProj, proj);
  }
  return {
    mean,
    axisX,
    axisY,
    normalX,
    normalY,
    minProj,
    maxProj,
    extent: Math.max(0, maxProj - minProj)
  };
}

/** Prefer overall left-to-right / upright reading by reversing the path when needed. */
export function normalizeReadingDirection(path: readonly LabelPoint[]): LabelPoint[] {
  if (path.length < 2) return [...path];
  const first = path[0]!;
  const last = path[path.length - 1]!;
  const angle = (Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI;
  if (angle > 90 || angle < -90) return [...path].reverse();
  return [...path];
}

function polylineLength(path: readonly LabelPoint[]): number {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]!;
    const point = path[index]!;
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  return length;
}

function pointAtArcLength(
  path: readonly LabelPoint[],
  target: number
): { point: LabelPoint; tangentX: number; tangentY: number } {
  if (path.length === 0) return { point: { x: 0, y: 0 }, tangentX: 1, tangentY: 0 };
  if (path.length === 1) return { point: path[0]!, tangentX: 1, tangentY: 0 };
  let remaining = Math.max(0, target);
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]!;
    const next = path[index]!;
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const segment = Math.hypot(dx, dy);
    if (segment <= 1e-9) continue;
    if (remaining <= segment) {
      const t = remaining / segment;
      return {
        point: { x: previous.x + dx * t, y: previous.y + dy * t },
        tangentX: dx / segment,
        tangentY: dy / segment
      };
    }
    remaining -= segment;
  }
  const last = path[path.length - 1]!;
  const previous = path[path.length - 2]!;
  const dx = last.x - previous.x;
  const dy = last.y - previous.y;
  const segment = Math.hypot(dx, dy) || 1;
  return { point: last, tangentX: dx / segment, tangentY: dy / segment };
}

function smoothPath(path: readonly LabelPoint[]): LabelPoint[] {
  if (path.length < 3) return [...path];
  const result: LabelPoint[] = [path[0]!];
  for (let index = 1; index < path.length - 1; index += 1) {
    const previous = path[index - 1]!;
    const point = path[index]!;
    const next = path[index + 1]!;
    result.push({
      x: (previous.x + point.x * 2 + next.x) / 4,
      y: (previous.y + point.y * 2 + next.y) / 4
    });
  }
  result.push(path[path.length - 1]!);
  return result;
}

/** Pull a polyline toward the chord between its endpoints to kill jagged bends. */
export function blendTowardStraight(path: readonly LabelPoint[], strength: number): LabelPoint[] {
  if (path.length < 3) return [...path];
  const first = path[0]!;
  const last = path[path.length - 1]!;
  const total = Math.max(polylineLength(path), 1e-9);
  let traveled = 0;
  const result: LabelPoint[] = [];
  for (let index = 0; index < path.length; index += 1) {
    if (index > 0) {
      const previous = path[index - 1]!;
      const point = path[index]!;
      traveled += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
    const t = traveled / total;
    const straight = {
      x: first.x + (last.x - first.x) * t,
      y: first.y + (last.y - first.y) * t
    };
    const curved = path[index]!;
    result.push({
      x: straight.x + (curved.x - straight.x) * strength,
      y: straight.y + (curved.y - straight.y) * strength
    });
  }
  return result;
}

function normalizeAngleDeg(angle: number): number {
  let value = angle;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  if (value > 90) value -= 180;
  if (value < -90) value += 180;
  return value;
}

function clampGlyphTilt(localDeg: number, overallDeg: number): number {
  let delta = localDeg - overallDeg;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  if (delta > 90) delta -= 180;
  if (delta < -90) delta += 180;
  delta = Math.max(-MAX_GLYPH_TILT_DEG, Math.min(MAX_GLYPH_TILT_DEG, delta));
  return normalizeAngleDeg(overallDeg + delta);
}

function largestOuterRing(geometry: GeoJsonGeometry): readonly [number, number][] | undefined {
  const rings: Array<readonly [number, number][]> = [];
  if (geometry.type === "Polygon") {
    const outer = geometry.coordinates[0];
    if (outer !== undefined) rings.push(outer as Array<[number, number]>);
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      const outer = polygon[0];
      if (outer !== undefined) rings.push(outer as Array<[number, number]>);
    }
  }
  if (rings.length === 0) return undefined;
  let best = rings[0]!;
  let bestScore = -1;
  for (const ring of rings) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const score = (maxX - minX) * (maxY - minY);
    if (score > bestScore) {
      best = ring;
      bestScore = score;
    }
  }
  return best;
}

function sampleRingPoints(
  ring: readonly [number, number][],
  maxPoints = GEOMETRY_SAMPLE_LIMIT
): LabelPoint[] {
  if (ring.length === 0) return [];
  const step = Math.max(1, Math.ceil(ring.length / maxPoints));
  const points: LabelPoint[] = [];
  for (let index = 0; index < ring.length; index += step) {
    const [lon, lat] = ring[index]!;
    const [x, y] = lonLatToMapXY(lon, lat);
    points.push({ x, y });
  }
  return points;
}

function pushInside(
  point: LabelPoint,
  normalX: number,
  normalY: number,
  geometry: GeoJsonGeometry,
  maxOffset: number
): LabelPoint | undefined {
  if (pointInGeometry(point.x, point.y, geometry)) return point;
  let best: LabelPoint | undefined;
  let bestDist = Infinity;
  for (const sign of [-1, 1] as const) {
    let low = 0;
    let high = maxOffset;
    let found: LabelPoint | undefined;
    for (let iter = 0; iter < 10; iter += 1) {
      const mid = (low + high) / 2;
      const candidate = {
        x: point.x + normalX * sign * mid,
        y: point.y + normalY * sign * mid
      };
      if (pointInGeometry(candidate.x, candidate.y, geometry)) {
        found = candidate;
        high = mid;
      } else {
        low = mid;
      }
    }
    if (found !== undefined) {
      const dist = Math.hypot(found.x - point.x, found.y - point.y);
      if (dist < bestDist) {
        best = found;
        bestDist = dist;
      }
    }
  }
  return best;
}

function shortFallbackPath(
  center: LabelPoint,
  axisX: number,
  axisY: number,
  half = 0.75
): LabelPoint[] {
  return normalizeReadingDirection([
    { x: center.x - axisX * half, y: center.y - axisY * half },
    center,
    { x: center.x + axisX * half, y: center.y + axisY * half }
  ]);
}

/** Build a map-space centerline approximating the province medial axis. */
export function buildProvinceBaseline(
  geometry: GeoJsonGeometry,
  preferredCenter?: LabelPoint
): LabelPoint[] {
  const ring = largestOuterRing(geometry);
  if (ring === undefined) {
    const center = preferredCenter ?? { x: 0, y: 0 };
    return shortFallbackPath(center, 1, 0);
  }
  const boundary = sampleRingPoints(ring);
  if (boundary.length === 0) {
    const center = preferredCenter ?? { x: 0, y: 0 };
    return shortFallbackPath(center, 1, 0);
  }

  const axis = principalAxis(boundary);
  const center =
    preferredCenter !== undefined && pointInGeometry(preferredCenter.x, preferredCenter.y, geometry)
      ? preferredCenter
      : axis.mean;
  let minProj = Number.POSITIVE_INFINITY;
  let maxProj = Number.NEGATIVE_INFINITY;
  for (const point of boundary) {
    const proj = (point.x - center.x) * axis.axisX + (point.y - center.y) * axis.axisY;
    minProj = Math.min(minProj, proj);
    maxProj = Math.max(maxProj, proj);
  }
  const extent = Math.max(0, maxProj - minProj);
  if (extent < 1e-3) {
    return shortFallbackPath(center, axis.axisX, axis.axisY);
  }

  const secondary =
    Math.max(
      ...boundary.map((point) =>
        Math.abs((point.x - center.x) * axis.normalX + (point.y - center.y) * axis.normalY)
      )
    ) || extent * 0.25;

  const raw: LabelPoint[] = [];
  for (let index = 0; index <= BASELINE_SAMPLES; index += 1) {
    const t = minProj + (extent * index) / BASELINE_SAMPLES;
    const candidate = {
      x: center.x + axis.axisX * t,
      y: center.y + axis.axisY * t
    };
    const inside = pushInside(candidate, axis.normalX, axis.normalY, geometry, secondary * 1.25);
    if (inside !== undefined) raw.push(inside);
  }

  if (raw.length < 2) {
    return shortFallbackPath(center, axis.axisX, axis.axisY, Math.max(0.5, extent / 4));
  }
  return normalizeReadingDirection(blendTowardStraight(smoothPath(raw), PATH_BEND_STRENGTH));
}

/** Gentle PCA chord with a mild bow — not a polyline through every capital. */
export function buildCountryBaseline(
  points: readonly LabelPoint[],
  options?: { readonly spanRatio?: number }
): LabelPoint[] {
  if (points.length === 0) return shortFallbackPath({ x: 0, y: 0 }, 1, 0);
  if (points.length === 1) return shortFallbackPath(points[0]!, 1, 0);
  const axis = principalAxis(points);
  if (axis.extent < 1e-3) {
    return shortFallbackPath(axis.mean, axis.axisX, axis.axisY);
  }
  // Center on the midpoint of the capital span (not density-weighted mean),
  // so countries with denser western provinces (Russia) are not pinned west.
  const midProj = (axis.minProj + axis.maxProj) / 2;
  const pathCenter = {
    x: axis.mean.x + axis.axisX * midProj,
    y: axis.mean.y + axis.axisY * midProj
  };
  const spanRatio =
    options?.spanRatio ?? (axis.extent >= 40 ? 0.46 : axis.extent >= 20 ? 0.4 : 0.36);
  const half = axis.extent * spanRatio;
  const start = {
    x: pathCenter.x - axis.axisX * half,
    y: pathCenter.y - axis.axisY * half
  };
  const end = {
    x: pathCenter.x + axis.axisX * half,
    y: pathCenter.y + axis.axisY * half
  };
  let lateral = 0;
  for (const point of points) {
    lateral += (point.x - pathCenter.x) * axis.normalX + (point.y - pathCenter.y) * axis.normalY;
  }
  lateral /= points.length;
  const bow = Math.max(-half * 0.18, Math.min(half * 0.18, lateral * 0.25));
  const control = {
    x: pathCenter.x + axis.normalX * bow,
    y: pathCenter.y + axis.normalY * bow
  };
  const path: LabelPoint[] = [];
  for (let index = 0; index <= 8; index += 1) {
    const t = index / 8;
    const omt = 1 - t;
    path.push({
      x: omt * omt * start.x + 2 * omt * t * control.x + t * t * end.x,
      y: omt * omt * start.y + 2 * omt * t * control.y + t * t * end.y
    });
  }
  return normalizeReadingDirection(path);
}

export function labelPlacementFromPoints(
  points: readonly LabelPoint[],
  text: string,
  kind: MapLabelKind
): { rotationDeg: number; fontSizePx: number; extent: number } {
  const { min, max } = fontSizeRange(kind);
  const axis = principalAxis(points);
  let rotationDeg = (Math.atan2(axis.axisY, axis.axisX) * 180) / Math.PI;
  if (rotationDeg > 90) rotationDeg -= 180;
  if (rotationDeg < -90) rotationDeg += 180;
  const charCount = Math.max(text.length, 1);
  const fontSizePx = Math.max(min, Math.min(max, (axis.extent * 2.1) / charCount));
  return { rotationDeg, fontSizePx, extent: axis.extent };
}

export function mapToScreen(
  x: number,
  y: number,
  cameraX: number,
  cameraY: number,
  halfWidth: number,
  halfHeight: number,
  viewWidth: number,
  viewHeight: number
): LabelPoint {
  return {
    x: ((x - cameraX) / halfWidth) * (viewWidth / 2) + viewWidth / 2,
    y: -((y - cameraY) / halfHeight) * (viewHeight / 2) + viewHeight / 2
  };
}

/** Place glyphs along a screen-space polyline; offsets are relative to the path midpoint. */
export function layoutGlyphsAlongPath(
  screenPath: readonly LabelPoint[],
  text: string,
  kind: MapLabelKind,
  fillRatio = PATH_FILL_RATIO
): GlyphLayout {
  const { min, max } = fontSizeRange(kind);
  const chars = [...text];
  if (chars.length === 0) return { fontSizePx: min, glyphs: [] };
  if (screenPath.length === 0) {
    return {
      fontSizePx: min,
      glyphs: chars.map((char, index) => ({
        char,
        x: (index - (chars.length - 1) / 2) * min * MIN_GLYPH_ADVANCE_EM,
        y: 0,
        rotationDeg: 0
      }))
    };
  }

  const first = screenPath[0]!;
  const last = screenPath[screenPath.length - 1]!;
  const overallDeg = normalizeAngleDeg(
    (Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI
  );
  const length = Math.max(polylineLength(screenPath), 1);
  const budget = Math.min(length * fillRatio, length);
  let fontSizePx = Math.max(min, Math.min(max, budget / Math.max(chars.length, 1)));
  if (chars.length > 1) {
    const minSpan = (chars.length - 1) * fontSizePx * MIN_GLYPH_ADVANCE_EM;
    if (minSpan > budget) {
      fontSizePx = budget / ((chars.length - 1) * MIN_GLYPH_ADVANCE_EM);
      if (fontSizePx < ABSOLUTE_MIN_FONT_PX) {
        return { fontSizePx: ABSOLUTE_MIN_FONT_PX, glyphs: [] };
      }
    }
  }
  const gapEm = maxGlyphGapEm(kind);
  const maxUsed = chars.length <= 1 ? fontSizePx : (chars.length - 1) * fontSizePx * gapEm;
  const minUsed = chars.length <= 1 ? 0 : (chars.length - 1) * fontSizePx * MIN_GLYPH_ADVANCE_EM;
  const used = Math.min(Math.max(minUsed, Math.min(budget, maxUsed)), length);
  const start = (length - used) / 2;
  const mid = pointAtArcLength(screenPath, length / 2).point;
  const step = chars.length === 1 ? 0 : used / (chars.length - 1);
  const glyphs = chars.map((char, index) => {
    const sample = pointAtArcLength(screenPath, start + step * index);
    const localDeg = normalizeAngleDeg(
      (Math.atan2(sample.tangentY, sample.tangentX) * 180) / Math.PI
    );
    return {
      char,
      x: sample.point.x - mid.x,
      y: sample.point.y - mid.y,
      rotationDeg: clampGlyphTilt(localDeg, overallDeg)
    };
  });
  return { fontSizePx, glyphs };
}

/** Rigid wrap copies of a path that fall inside the camera frustum (matches land tiles). */
export function visibleLabelCopies(
  path: readonly LabelPoint[],
  fallback: LabelPoint,
  cameraX: number,
  cameraY: number,
  marginX: number,
  marginY: number
): Array<{ offset: number; path: LabelPoint[]; anchor: LabelPoint }> {
  const basePath = wrapPathToCamera(path, cameraX);
  const baseFallback = { x: wrapLabelX(fallback.x, cameraX), y: fallback.y };
  const copies: Array<{ offset: number; path: LabelPoint[]; anchor: LabelPoint }> = [];
  for (const offset of LABEL_WRAP_OFFSETS) {
    const shifted =
      offset === 0
        ? basePath
        : basePath.map((point) => ({ x: point.x + offset, y: point.y }));
    const anchor =
      shifted.length === 0
        ? { x: baseFallback.x + offset, y: baseFallback.y }
        : pathAnchor(shifted, { x: baseFallback.x + offset, y: baseFallback.y });
    if (Math.abs(anchor.x - cameraX) > marginX || Math.abs(anchor.y - cameraY) > marginY) {
      continue;
    }
    copies.push({ offset, path: shifted, anchor });
  }
  return copies;
}

function labelInstanceKey(id: string, offset: number): string {
  return `${id}@${offset}`;
}

function pathAnchor(path: readonly LabelPoint[], fallback: LabelPoint): LabelPoint {
  if (path.length === 0) return fallback;
  if (path.length === 1) return path[0]!;
  const length = polylineLength(path);
  return pointAtArcLength(path, length / 2).point;
}

export function resolveCountryLabelText(
  ownerId: string,
  countries: CountryNameTable | undefined
): string {
  const entry = countries?.[ownerId];
  if (entry === undefined) return ownerId;
  return entry.nameEn || entry.name || ownerId;
}

function capitalPoint(feature: ProvinceFeature): LabelPoint {
  const [x, y] = lonLatToMapXY(
    feature.properties.capital.coordinates[0],
    feature.properties.capital.coordinates[1]
  );
  return { x, y };
}

export function buildProvinceLabels(provinces: readonly ProvinceFeature[]): MapLabelSpec[] {
  const labels: MapLabelSpec[] = [];
  for (const feature of provinces) {
    const text = feature.properties.nameEn ?? feature.properties.name;
    if (text === undefined || text.length === 0) continue;
    const capital = capitalPoint(feature);
    const path = buildProvinceBaseline(feature.geometry, capital);
    const anchor = pathAnchor(path, capital);
    const placement = labelPlacementFromPoints(path, text, "province");
    labels.push({
      id: `province:${feature.id}`,
      kind: "province",
      text,
      x: wrapLongitude(anchor.x),
      y: anchor.y,
      provinceCount: 1,
      path,
      rotationDeg: placement.rotationDeg,
      fontSizePx: placement.fontSizePx
    });
  }
  return labels;
}

export function buildCountryLabelAnchors(
  provinces: readonly ProvinceFeature[],
  ownerLookup: (provinceId: string) => string | undefined,
  countries?: CountryNameTable
): MapLabelSpec[] {
  const groups = new Map<
    string,
    {
      count: number;
      members: Array<{
        point: LabelPoint;
        area: number;
        bbox: LonLatBBox;
        geometry: GeoJsonGeometry;
        capital: LabelPoint;
      }>;
    }
  >();
  for (const feature of provinces) {
    const owner = ownerLookup(feature.id) ?? feature.properties.adm0A3;
    if (owner === undefined || owner.length === 0) continue;
    const capital = capitalPoint(feature);
    const member = {
      point: capital,
      area: provinceAreaDegrees(feature),
      bbox: featureBBox(feature),
      geometry: feature.geometry,
      capital
    };
    const existing = groups.get(owner);
    if (existing === undefined) {
      groups.set(owner, { count: 1, members: [member] });
    } else {
      existing.count += 1;
      existing.members.push(member);
    }
  }

  const labels: MapLabelSpec[] = [];
  for (const [owner, group] of groups) {
    const homeland = selectPrimaryLandmass(group.members);
    const origin = homeland[0]?.point ?? { x: 0, y: 0 };
    // Shape samples from homeland geometry (not just capitals) keep labels centered
    // on the landmass — capital-only PCA pins Australia to the populous SE coast.
    const shapePoints: LabelPoint[] = [];
    for (const member of homeland) {
      const ring = largestOuterRing(member.geometry);
      if (ring === undefined) {
        shapePoints.push({
          x: unwrapLon(member.point.x, origin.x),
          y: member.point.y
        });
        continue;
      }
      for (const sample of sampleRingPoints(ring, 18)) {
        shapePoints.push({
          x: unwrapLon(sample.x, origin.x),
          y: sample.y
        });
      }
    }
    const points =
      shapePoints.length >= 3
        ? shapePoints
        : homeland.map((member) => ({
            x: unwrapLon(member.point.x, origin.x),
            y: member.point.y
          }));
    const mean =
      points.length === 0
        ? { x: 0, y: 0 }
        : {
            x: wrapLongitude(points.reduce((sum, point) => sum + point.x, 0) / points.length),
            y: points.reduce((sum, point) => sum + point.y, 0) / points.length
          };
    const kind: MapLabelKind =
      group.count >= MAJOR_COUNTRY_MIN_PROVINCES ? "country-major" : "country";
    const text = resolveCountryLabelText(owner, countries);
    const largest = [...homeland].sort((left, right) => right.area - left.area)[0];
    let path =
      points.length >= 3
        ? buildCountryBaseline(points)
        : largest !== undefined
          ? buildProvinceBaseline(largest.geometry, largest.capital)
          : shortFallbackPath(mean, 1, 0);
    if (polylineLength(path) < 0.5 && largest !== undefined) {
      path = buildProvinceBaseline(largest.geometry, largest.capital);
    }
    const anchor = pathAnchor(path, mean);
    const placement = labelPlacementFromPoints(path, text, kind);
    labels.push({
      id: `country:${owner}`,
      kind,
      text,
      x: wrapLongitude(anchor.x),
      y: anchor.y,
      provinceCount: group.count,
      path,
      rotationDeg: placement.rotationDeg,
      fontSizePx: placement.fontSizePx
    });
  }
  return labels;
}

const LABEL_Z = 0.06;

export class MapLabelLayer {
  private readonly cssRenderer: CSS2DRenderer;
  private readonly root = new THREE.Group();
  private readonly objects = new Map<string, CSS2DObject>();
  private readonly specs = new Map<string, MapLabelSpec>();
  private viewWidth = 1;
  private viewHeight = 1;
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.cssRenderer = new CSS2DRenderer();
    this.cssRenderer.domElement.className = "map-label-layer";
    this.cssRenderer.domElement.style.position = "absolute";
    this.cssRenderer.domElement.style.inset = "0";
    this.cssRenderer.domElement.style.pointerEvents = "none";
    this.container.appendChild(this.cssRenderer.domElement);
  }

  get sceneRoot(): THREE.Object3D {
    return this.root;
  }

  setLabels(specs: readonly MapLabelSpec[]): void {
    const nextIds = new Set(specs.map((spec) => spec.id));
    for (const [key, object] of this.objects) {
      const specId = key.slice(0, key.lastIndexOf("@"));
      if (nextIds.has(specId)) continue;
      this.root.remove(object);
      object.element.remove();
      this.objects.delete(key);
    }
    for (const id of this.specs.keys()) {
      if (!nextIds.has(id)) this.specs.delete(id);
    }
    for (const spec of specs) {
      this.specs.set(spec.id, spec);
      for (const offset of LABEL_WRAP_OFFSETS) {
        const key = labelInstanceKey(spec.id, offset);
        let object = this.objects.get(key);
        if (object === undefined) {
          const element = document.createElement("div");
          element.className = labelClassName(spec.kind);
          object = new CSS2DObject(element);
          object.center.set(0.5, 0.5);
          this.objects.set(key, object);
          this.root.add(object);
        } else {
          object.element.className = labelClassName(spec.kind);
        }
        syncGlyphElements(object.element, spec.text);
        object.position.set(spec.x + offset, spec.y, LABEL_Z);
        object.visible = false;
      }
    }
  }

  update(halfHeight: number, cameraX: number, cameraY: number, halfWidth: number): void {
    const marginX = halfWidth + 8;
    const marginY = halfHeight + 6;
    for (const [id, spec] of this.specs) {
      const show = labelVisibility(halfHeight, spec.kind);
      for (const offset of LABEL_WRAP_OFFSETS) {
        const object = this.objects.get(labelInstanceKey(id, offset));
        if (object === undefined) continue;
        if (!show) {
          object.visible = false;
        }
      }
      if (!show) continue;

      const copies = visibleLabelCopies(
        spec.path,
        { x: spec.x, y: spec.y },
        cameraX,
        cameraY,
        marginX,
        marginY
      );
      const visibleOffsets = new Set(copies.map((copy) => copy.offset));
      for (const offset of LABEL_WRAP_OFFSETS) {
        const object = this.objects.get(labelInstanceKey(id, offset));
        if (object === undefined) continue;
        if (!visibleOffsets.has(offset)) {
          object.visible = false;
        }
      }
      for (const copy of copies) {
        const object = this.objects.get(labelInstanceKey(id, copy.offset));
        if (object === undefined) continue;
        object.position.set(copy.anchor.x, copy.anchor.y, LABEL_Z);
        const screenPath = copy.path.map((point) =>
          mapToScreen(
            point.x,
            point.y,
            cameraX,
            cameraY,
            halfWidth,
            halfHeight,
            this.viewWidth,
            this.viewHeight
          )
        );
        const layout = layoutGlyphsAlongPath(screenPath, spec.text, spec.kind);
        if (layout.glyphs.length === 0) {
          object.visible = false;
          continue;
        }
        object.visible = true;
        applyGlyphLayout(object.element, layout);
      }
    }
  }

  resize(width: number, height: number): void {
    this.viewWidth = Math.max(1, width);
    this.viewHeight = Math.max(1, height);
    this.cssRenderer.setSize(this.viewWidth, this.viewHeight);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.disposed) return;
    this.cssRenderer.render(scene, camera);
  }

  dispose(): void {
    this.disposed = true;
    for (const object of this.objects.values()) {
      this.root.remove(object);
      object.element.remove();
    }
    this.objects.clear();
    this.specs.clear();
    this.cssRenderer.domElement.remove();
  }
}

function syncGlyphElements(element: HTMLElement, text: string): void {
  const chars = [...text];
  while (element.childElementCount > chars.length) {
    element.lastElementChild?.remove();
  }
  while (element.childElementCount < chars.length) {
    const glyph = document.createElement("span");
    glyph.className = "map-label-glyph";
    element.appendChild(glyph);
  }
  for (let index = 0; index < chars.length; index += 1) {
    const glyph = element.children[index];
    if (glyph instanceof HTMLElement) glyph.textContent = chars[index]!;
  }
}

function applyGlyphLayout(element: HTMLElement, layout: GlyphLayout): void {
  element.style.fontSize = `${layout.fontSizePx}px`;
  for (let index = 0; index < layout.glyphs.length; index += 1) {
    const glyph = element.children[index];
    const placed = layout.glyphs[index];
    if (!(glyph instanceof HTMLElement) || placed === undefined) continue;
    glyph.style.transform = `translate(${placed.x}px, ${placed.y}px) translate(-50%, -50%) rotate(${placed.rotationDeg}deg)`;
  }
}

function labelClassName(kind: MapLabelKind): string {
  if (kind === "province") return "map-label map-label-province";
  if (kind === "country-major") return "map-label map-label-country map-label-country-major";
  return "map-label map-label-country";
}
