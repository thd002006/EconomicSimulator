/**
 * Generate default road segments from Natural Earth road-connection strength.
 *
 * Usage:
 *   tsx src/generate-default-roads.ts --map world-modern
 *   tsx src/generate-default-roads.ts --map world-modern --min-border-km 5 --highway-threshold 8
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, pointInGeometry } from "./geo.js";
import type { AreaGeometry, LonLat } from "./types.js";

const generatorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(generatorRoot, "..");
const NATURAL_EARTH_COMMIT = "9380cca83db5f9aef52d5e762765100745f84b27";
const NATURAL_EARTH_BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_COMMIT}/geojson`;
const NE_ROADS_FILE = "ne_10m_roads.geojson";
const SAMPLE_STEP_KM = 12;
const GRID_CELL = 2;

const TYPE_WEIGHT: Readonly<Record<string, number>> = {
  "Major Highway": 4,
  "Secondary Highway": 2.5,
  Bypass: 1.5,
  Beltway: 1.5,
  Road: 1,
  Track: 0.25
};

interface ProvinceHit {
  readonly id: string;
  readonly geometry: AreaGeometry;
  readonly bbox: readonly [number, number, number, number];
}

function haversineKm(a: LonLat, b: LonLat): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lineLengthKm(coordinates: readonly LonLat[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    total += haversineKm(coordinates[i - 1]!, coordinates[i]!);
  }
  return total;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function bboxOfGeometry(geometry: AreaGeometry): readonly [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const rings =
    geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

function cellKey(lon: number, lat: number): string {
  return `${Math.floor(lon / GRID_CELL)}:${Math.floor(lat / GRID_CELL)}`;
}

class ProvinceIndex {
  private readonly cells = new Map<string, ProvinceHit[]>();

  constructor(provinces: readonly ProvinceHit[]) {
    for (const province of provinces) {
      const [minLon, minLat, maxLon, maxLat] = province.bbox;
      const x0 = Math.floor(minLon / GRID_CELL);
      const x1 = Math.floor(maxLon / GRID_CELL);
      const y0 = Math.floor(minLat / GRID_CELL);
      const y1 = Math.floor(maxLat / GRID_CELL);
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) {
          const key = `${x}:${y}`;
          const list = this.cells.get(key) ?? [];
          list.push(province);
          this.cells.set(key, list);
        }
      }
    }
  }

  hit(lon: number, lat: number): string | undefined {
    const candidates = this.cells.get(cellKey(lon, lat)) ?? [];
    for (const province of candidates) {
      const [minLon, minLat, maxLon, maxLat] = province.bbox;
      if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
      if (pointInGeometry([lon, lat], province.geometry)) return province.id;
    }
    return undefined;
  }
}

function typeWeight(type: string | undefined): number | undefined {
  if (type === undefined) return undefined;
  if (type === "Ferry Route") return undefined;
  return TYPE_WEIGHT[type] ?? 0.5;
}

function scalerankFactor(scalerank: number | undefined): number {
  if (scalerank === undefined || !Number.isFinite(scalerank)) return 0.7;
  return Math.max(0.2, Math.min(1.2, (11 - scalerank) / 10));
}

function parseArgs(args: readonly string[]): {
  mapId: string;
  minBorderKm: number;
  highwayThreshold: number;
  localThreshold: number;
} {
  let mapId = "world-modern";
  let minBorderKm = 5;
  let highwayThreshold = 8;
  let localThreshold = 2.5;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--map") mapId = args[++i] ?? mapId;
    else if (arg.startsWith("--map=")) mapId = arg.slice("--map=".length);
    else if (arg === "--min-border-km") minBorderKm = Number(args[++i]);
    else if (arg.startsWith("--min-border-km=")) minBorderKm = Number(arg.slice("--min-border-km=".length));
    else if (arg === "--highway-threshold") highwayThreshold = Number(args[++i]);
    else if (arg.startsWith("--highway-threshold=")) {
      highwayThreshold = Number(arg.slice("--highway-threshold=".length));
    } else if (arg === "--local-threshold") localThreshold = Number(args[++i]);
    else if (arg.startsWith("--local-threshold=")) {
      localThreshold = Number(arg.slice("--local-threshold=".length));
    }
  }
  if (
    !mapId ||
    !Number.isFinite(minBorderKm) ||
    minBorderKm < 0 ||
    !Number.isFinite(highwayThreshold) ||
    !Number.isFinite(localThreshold)
  ) {
    throw new Error("Invalid arguments");
  }
  return { mapId, minBorderKm, highwayThreshold, localThreshold };
}

async function ensureNeRoads(): Promise<string> {
  const cacheDir = join(generatorRoot, "cache", "natural-earth");
  await mkdir(cacheDir, { recursive: true });
  const path = join(cacheDir, NE_ROADS_FILE);
  try {
    await access(path);
    return path;
  } catch {
    // download below
  }
  const url = `${NATURAL_EARTH_BASE}/${NE_ROADS_FILE}`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download NE roads: HTTP ${response.status}`);
  const text = await response.text();
  await writeFile(path, text, "utf8");
  return path;
}

function asLonLat(point: unknown): LonLat | undefined {
  if (!Array.isArray(point) || point.length < 2) return undefined;
  const lon = Number(point[0]);
  const lat = Number(point[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
  return [lon, lat];
}

function sampleLine(coords: readonly LonLat[], stepKm: number): LonLat[] {
  if (coords.length === 0) return [];
  const out: LonLat[] = [coords[0]!];
  let carry = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const seg = haversineKm(a, b);
    if (seg <= 1e-9) continue;
    let dist = stepKm - carry;
    while (dist < seg) {
      const t = dist / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      dist += stepKm;
    }
    carry = seg - (dist - stepKm);
  }
  const last = coords[coords.length - 1]!;
  const prev = out[out.length - 1]!;
  if (prev[0] !== last[0] || prev[1] !== last[1]) out.push(last);
  return out;
}

async function main(): Promise<void> {
  const { mapId, minBorderKm, highwayThreshold, localThreshold } = parseArgs(process.argv.slice(2));
  const mapRoot = join(repoRoot, "assets", "maps", mapId);
  const provincesPath = join(mapRoot, "geometry", "provinces.geojson");
  const boundariesPath = join(mapRoot, "geometry", "boundaries.json");
  const roadsPath = join(mapRoot, "geometry", "roads.json");
  const manifestPath = join(mapRoot, "map.json");

  const provincesRaw = JSON.parse(await readFile(provincesPath, "utf8")) as unknown;
  if (
    !isRecord(provincesRaw) ||
    provincesRaw.type !== "FeatureCollection" ||
    !Array.isArray(provincesRaw.features)
  ) {
    throw new Error("provinces.geojson must be a FeatureCollection");
  }

  const provinces: ProvinceHit[] = [];
  for (const feature of provincesRaw.features) {
    if (!isRecord(feature)) continue;
    const id = typeof feature.id === "string" ? feature.id : undefined;
    if (id === undefined) continue;
    if (!isRecord(feature.geometry)) continue;
    const geometry = feature.geometry as AreaGeometry;
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") continue;
    provinces.push({ id, geometry, bbox: bboxOfGeometry(geometry) });
  }
  const index = new ProvinceIndex(provinces);

  const boundariesRaw = JSON.parse(await readFile(boundariesPath, "utf8")) as unknown;
  if (
    !isRecord(boundariesRaw) ||
    boundariesRaw.type !== "BoundaryCollection" ||
    !Array.isArray(boundariesRaw.features)
  ) {
    throw new Error("boundaries.json must be a BoundaryCollection");
  }

  const adjacency = new Set<string>();
  let skippedShort = 0;
  for (const raw of boundariesRaw.features) {
    if (!isRecord(raw)) continue;
    const left = typeof raw.leftProvinceId === "string" ? raw.leftProvinceId : undefined;
    const right = typeof raw.rightProvinceId === "string" ? raw.rightProvinceId : undefined;
    if (left === undefined || right === undefined) continue;
    if (!Array.isArray(raw.coordinates) || raw.coordinates.length < 2) {
      skippedShort += 1;
      continue;
    }
    const coords: LonLat[] = [];
    for (const point of raw.coordinates) {
      const ll = asLonLat(point);
      if (ll === undefined) throw new Error("Invalid boundary coordinate");
      coords.push(ll);
    }
    if (lineLengthKm(coords) < minBorderKm) {
      skippedShort += 1;
      continue;
    }
    adjacency.add(pairKey(left, right));
  }

  const nePath = await ensureNeRoads();
  const neRaw = JSON.parse(await readFile(nePath, "utf8")) as unknown;
  if (!isRecord(neRaw) || !Array.isArray(neRaw.features)) {
    throw new Error("NE roads must be a FeatureCollection");
  }

  const scores = new Map<string, number>();
  let sampledFeatures = 0;
  let skippedFerry = 0;

  for (const feature of neRaw.features) {
    if (!isRecord(feature) || !isRecord(feature.geometry)) continue;
    const props = isRecord(feature.properties) ? feature.properties : {};
    const type = typeof props.type === "string" ? props.type : undefined;
    const weight = typeWeight(type);
    if (weight === undefined) {
      skippedFerry += 1;
      continue;
    }
    const scalerank =
      typeof props.scalerank === "number"
        ? props.scalerank
        : typeof props.scalerank === "string"
          ? Number(props.scalerank)
          : undefined;
    const factor = weight * scalerankFactor(scalerank);
    const geom = feature.geometry;
    const lines: LonLat[][] = [];
    if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
      const line: LonLat[] = [];
      for (const point of geom.coordinates) {
        const ll = asLonLat(point);
        if (ll !== undefined) line.push(ll);
      }
      if (line.length >= 2) lines.push(line);
    } else if (geom.type === "MultiLineString" && Array.isArray(geom.coordinates)) {
      for (const part of geom.coordinates) {
        if (!Array.isArray(part)) continue;
        const line: LonLat[] = [];
        for (const point of part) {
          const ll = asLonLat(point);
          if (ll !== undefined) line.push(ll);
        }
        if (line.length >= 2) lines.push(line);
      }
    }
    if (lines.length === 0) continue;
    sampledFeatures += 1;

    for (const line of lines) {
      const samples = sampleLine(line, SAMPLE_STEP_KM);
      let prevId: string | undefined;
      let prevPoint: LonLat | undefined;
      for (const point of samples) {
        const id = index.hit(point[0], point[1]);
        if (
          id !== undefined &&
          prevId !== undefined &&
          prevPoint !== undefined &&
          id !== prevId
        ) {
          const key = pairKey(prevId, id);
          if (adjacency.has(key)) {
            const dist = haversineKm(prevPoint, point);
            scores.set(key, (scores.get(key) ?? 0) + dist * factor);
          }
        }
        if (id !== undefined) {
          prevId = id;
          prevPoint = point;
        }
      }
    }
  }

  const segments: Array<{
    id: string;
    typeId: "highway" | "local_road";
    provinceIdA: string;
    provinceIdB: string;
  }> = [];
  const scoredPairs = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  let highways = 0;
  let locals = 0;
  for (const [key, score] of scoredPairs) {
    const [a, b] = key.split("|") as [string, string];
    if (score >= highwayThreshold) {
      segments.push({
        id: `road-hw-${a}-${b}`,
        typeId: "highway",
        provinceIdA: a,
        provinceIdB: b
      });
      highways += 1;
    } else if (score >= localThreshold) {
      segments.push({
        id: `road-local-${a}-${b}`,
        typeId: "local_road",
        provinceIdA: a,
        provinceIdB: b
      });
      locals += 1;
    }
  }
  segments.sort((left, right) => left.id.localeCompare(right.id));

  const collection = { schemaVersion: 1 as const, segments };
  await mkdir(dirname(roadsPath), { recursive: true });
  await writeFile(roadsPath, `${JSON.stringify(collection)}\n`, "utf8");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    layers: Record<string, string>;
  };
  manifest.layers.roads = "geometry/roads.json";
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

  const topScores = scoredPairs.slice(0, 5).map(([key, score]) => ({ key, score: Number(score.toFixed(2)) }));
  console.log(
    JSON.stringify(
      {
        mapId,
        adjacencyPairs: adjacency.size,
        scoredPairs: scores.size,
        highways,
        localRoads: locals,
        skippedShort,
        skippedFerry,
        sampledNeFeatures: sampledFeatures,
        highwayThreshold,
        localThreshold,
        minBorderKm,
        neRoadsPath: nePath,
        topScores,
        roadsPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
