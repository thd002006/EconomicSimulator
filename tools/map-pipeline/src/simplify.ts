import type { LonLat } from "@economic-simulator/map-runtime";

function perpendicularDistance(point: LonLat, start: LonLat, end: LonLat): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy);
  const projectedX = start[0] + t * dx;
  const projectedY = start[1] + t * dy;
  return Math.hypot(point[0] - projectedX, point[1] - projectedY);
}

export function simplifyLine(points: readonly LonLat[], tolerance: number): LonLat[] {
  if (points.length <= 2 || tolerance <= 0) {
    return points.map((point) => [point[0], point[1]]);
  }
  let maxDistance = 0;
  let maxIndex = 0;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index]!, start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }
  if (maxDistance <= tolerance) {
    return [
      [start[0], start[1]],
      [end[0], end[1]]
    ];
  }
  const left = simplifyLine(points.slice(0, maxIndex + 1), tolerance);
  const right = simplifyLine(points.slice(maxIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function simplifyRing(ring: readonly LonLat[], tolerance: number): LonLat[] {
  if (ring.length < 4) {
    return ring.map((point) => [point[0], point[1]]);
  }
  const closed =
    ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1];
  const openRing = closed ? ring.slice(0, -1) : [...ring];
  const anchor = openRing[0]!;
  let oppositeIndex = 1;
  let oppositeDistance = -1;
  for (let index = 1; index < openRing.length; index += 1) {
    const point = openRing[index]!;
    const distance = Math.hypot(point[0] - anchor[0], point[1] - anchor[1]);
    if (distance > oppositeDistance) {
      oppositeDistance = distance;
      oppositeIndex = index;
    }
  }
  const firstHalf = simplifyLine(openRing.slice(0, oppositeIndex + 1), tolerance);
  const secondHalf = simplifyLine([...openRing.slice(oppositeIndex), anchor], tolerance);
  const simplified = [...firstHalf.slice(0, -1), ...secondHalf];
  if (simplified.length < 3) {
    return ring.map((point) => [point[0], point[1]]);
  }
  const first = simplified[0]!;
  const last = simplified[simplified.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    simplified.push([first[0], first[1]]);
  }
  return simplified;
}

export function signedRingArea(ring: readonly LonLat[]): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index]!;
    const next = ring[index + 1]!;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea / 2;
}

function orientation(a: LonLat, b: LonLat, c: LonLat): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a: LonLat, b: LonLat, c: LonLat, d: LonLat): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

export function ringHasSelfIntersection(ring: readonly LonLat[]): boolean {
  const segmentCount = ring.length - 1;
  for (let first = 0; first < segmentCount; first += 1) {
    for (let second = first + 1; second < segmentCount; second += 1) {
      if (second === first + 1 || (first === 0 && second === segmentCount - 1)) continue;
      if (segmentsIntersect(ring[first]!, ring[first + 1]!, ring[second]!, ring[second + 1]!)) {
        return true;
      }
    }
  }
  return false;
}

/** Simplify conservatively; fall back until area, winding and validity are preserved. */
export function simplifyRingSafely(
  ring: readonly LonLat[],
  requestedTolerance: number,
  maxAreaError = 0.1
): LonLat[] {
  const original = ring.map((point): LonLat => [point[0], point[1]]);
  if (requestedTolerance <= 0) return original;
  const originalArea = signedRingArea(original);
  if (Math.abs(originalArea) < Number.EPSILON) return original;

  let tolerance = requestedTolerance;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = simplifyRing(original, tolerance);
    const candidateArea = signedRingArea(candidate);
    const areaError =
      Math.abs(Math.abs(candidateArea) - Math.abs(originalArea)) / Math.abs(originalArea);
    const preservesWinding = Math.sign(candidateArea) === Math.sign(originalArea);
    if (areaError <= maxAreaError && preservesWinding && !ringHasSelfIntersection(candidate)) {
      return candidate;
    }
    tolerance /= 2;
  }
  return original;
}
