import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asNumber,
  asString,
  countVertices,
  geometryGapKm,
  geometryAreaKm2,
  geometryCenter,
  geometryPerimeterKm,
  interiorPoint,
  isRecord,
  normalizeAreaGeometry,
  pointInGeometry,
  prop,
  validCode
} from "./geo.js";
import {
  dynamicMinimumProvinceAreaKm2,
  loadMergePolicy,
  type MergeParameters
} from "./merge-policy.js";
import {
  authoredFeaturesFromTopology,
  buildAdjacency,
  buildTopology,
  extractTopologyLines,
  makeAuthoredFeature,
  mergeGeometry,
  simplifyAuthoredTopology,
  topologyGeometries
} from "./topology.js";
import type {
  AreaGeometry,
  CapitalCandidate,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  MergeGroup,
  ProvinceCapital,
  ReviewProvince,
  SourceProvince
} from "./types.js";

const NATURAL_EARTH_COMMIT = "9380cca83db5f9aef52d5e762765100745f84b27";
const NATURAL_EARTH_BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_COMMIT}/geojson`;
const COUNTRY_ID_REASSIGNMENTS = new Map([["KAB", "KAZ"]]);
const EXCLUDED_FROM_MERGED_PROVINCE_NAMES = new Set(["-99-X05~"]);
const SOURCES = {
  provinces: {
    fileName: "ne_10m_admin_1_states_provinces_lakes.geojson",
    url: `${NATURAL_EARTH_BASE}/ne_10m_admin_1_states_provinces_lakes.geojson`,
    fallbackFileName: "ne_10m_admin_1_states_provinces.geojson",
    fallbackUrl: `${NATURAL_EARTH_BASE}/ne_10m_admin_1_states_provinces.geojson`
  },
  places: {
    fileName: "ne_10m_populated_places.geojson",
    url: `${NATURAL_EARTH_BASE}/ne_10m_populated_places.geojson`
  }
} as const;

export function parseRetainedFraction(
  args: readonly string[],
  defaultRetainedFraction = 0.5
): number {
  let rawValue: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
    if (argument === "--retain" || argument === "--retained-fraction") {
      rawValue = args[index + 1];
      if (rawValue === undefined) throw new Error(`${argument} requires a value.`);
      index += 1;
      continue;
    }
    if (argument.startsWith("--retain=")) {
      rawValue = argument.slice("--retain=".length);
      continue;
    }
    if (argument.startsWith("--retained-fraction=")) {
      rawValue = argument.slice("--retained-fraction=".length);
      continue;
    }
    throw new Error(`Unknown generator argument: ${argument}`);
  }
  if (rawValue === undefined) return defaultRetainedFraction;
  const percentage = rawValue.endsWith("%");
  const numericText = percentage ? rawValue.slice(0, -1) : rawValue;
  const numericValue = Number(numericText);
  const fraction = percentage ? numericValue / 100 : numericValue;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error(
      `Retained arc fraction must be in (0, 1] or written as (0%, 100%]: ${rawValue}`
    );
  }
  return fraction;
}

async function downloadTo(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function ensureSource(
  vendorDir: string,
  source: { fileName: string; url: string; fallbackFileName?: string; fallbackUrl?: string }
): Promise<string> {
  const primaryPath = join(vendorDir, source.fileName);
  try {
    await readFile(primaryPath);
    return primaryPath;
  } catch {
    // Download the pinned source below.
  }
  try {
    console.log(`Downloading ${source.fileName}...`);
    await downloadTo(source.url, primaryPath);
    return primaryPath;
  } catch (error) {
    if (source.fallbackFileName === undefined || source.fallbackUrl === undefined) throw error;
    const fallbackPath = join(vendorDir, source.fallbackFileName);
    console.warn(`Primary source failed; downloading ${source.fallbackFileName}.`);
    await downloadTo(source.fallbackUrl, fallbackPath);
    return fallbackPath;
  }
}

async function readCollection(path: string): Promise<GeoJsonFeatureCollection> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error(`Expected a FeatureCollection at ${path}.`);
  }
  return value as unknown as GeoJsonFeatureCollection;
}

function uniqueId(preferred: string, used: Set<string>, fallback: string): string {
  for (const candidate of [preferred, fallback]) {
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  let suffix = 2;
  while (used.has(`${fallback}-${suffix}`)) suffix += 1;
  const result = `${fallback}-${suffix}`;
  used.add(result);
  return result;
}

function normalizeProvinces(source: GeoJsonFeatureCollection): SourceProvince[] {
  const result: SourceProvince[] = [];
  const used = new Set<string>();
  for (const [sourceIndex, feature] of source.features.entries()) {
    const geometry = normalizeAreaGeometry(feature, `province source ${sourceIndex}`);
    if (geometry === undefined) continue;
    const properties = feature.properties;
    const iso = asString(prop(properties, "iso_3166_2"));
    const adm1 = asString(prop(properties, "adm1_code"));
    const neId = asString(prop(properties, "ne_id"));
    const preferred = validCode(iso)
      ? iso
      : validCode(adm1)
        ? adm1
        : validCode(neId)
          ? `ne-${neId}`
          : `province-${sourceIndex}`;
    const fallback = validCode(neId) ? `ne-${neId}` : `province-${sourceIndex}`;
    const id = uniqueId(preferred, used, fallback);
    const sourceCountryId = asString(prop(properties, "adm0_a3"));
    if (!validCode(sourceCountryId)) throw new Error(`Province ${id} has no country code.`);
    const countryId = COUNTRY_ID_REASSIGNMENTS.get(sourceCountryId) ?? sourceCountryId;
    const lon = asNumber(prop(properties, "longitude"));
    const lat = asNumber(prop(properties, "latitude"));
    const type = asString(prop(properties, "type_en", "type"));
    const region = asString(prop(properties, "region"));
    const regionCode = asString(prop(properties, "region_cod"));
    result.push({
      index: result.length,
      id,
      countryId,
      name: asString(prop(properties, "name", "name_local")) ?? id,
      nameEn: asString(prop(properties, "name_en", "name")) ?? id,
      ...(type === undefined ? {} : { type }),
      ...(region === undefined ? {} : { region }),
      ...(regionCode === undefined ? {} : { regionCode }),
      geometry,
      areaKm2: geometryAreaKm2(geometry),
      center: lon === undefined || lat === undefined ? geometryCenter(geometry) : [lon, lat]
    });
  }
  return result;
}

function normalizeCapitals(source: GeoJsonFeatureCollection): CapitalCandidate[] {
  const result: CapitalCandidate[] = [];
  for (const feature of source.features) {
    if (feature.geometry?.type !== "Point") continue;
    const properties = feature.properties;
    const featureClass = asString(prop(properties, "featurecla")) ?? "";
    if (!featureClass.toLowerCase().includes("capital")) continue;
    const countryId = asString(prop(properties, "adm0_a3", "sov_a3"));
    if (!validCode(countryId)) continue;
    const nameEn = asString(prop(properties, "name_en", "name"));
    result.push({
      name: asString(prop(properties, "name", "nameascii")) ?? "Capital",
      ...(nameEn === undefined ? {} : { nameEn }),
      countryId,
      coordinates: feature.geometry.coordinates,
      population: asNumber(prop(properties, "pop_max")) ?? 0,
      national:
        asNumber(prop(properties, "adm0cap")) === 1 ||
        featureClass.toLowerCase().startsWith("admin-0 capital")
    });
  }
  return result;
}

function normalizedCollection(
  provinces: readonly SourceProvince[]
): GeoJsonFeatureCollection<AreaGeometry> {
  return {
    type: "FeatureCollection",
    features: provinces.map((province) => ({
      type: "Feature",
      id: province.id,
      properties: { sourceIndex: province.index },
      geometry: province.geometry
    }))
  };
}

function weightedCenter(
  indices: readonly number[],
  provinces: readonly SourceProvince[]
): readonly [number, number] {
  let area = 0;
  let lon = 0;
  let lat = 0;
  for (const index of indices) {
    const province = provinces[index]!;
    area += province.areaKm2;
    lon += province.center[0] * province.areaKm2;
    lat += province.center[1] * province.areaKm2;
  }
  return area === 0 ? [0, 0] : [lon / area, lat / area];
}

interface Cluster {
  key: number;
  members: number[];
  nameParts: Array<{
    order: number;
    name: string;
    nameEn: string;
  }>;
  countryId: string;
  areaKm2: number;
  center: readonly [number, number];
  perimeterKm: number;
  fragmentCount: number;
  method: MergeGroup["method"];
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function groupHash(countryId: string, members: readonly SourceProvince[]): string {
  return createHash("sha1")
    .update(
      `${countryId}|${members
        .map((member) => member.id)
        .sort()
        .join("|")}`
    )
    .digest("hex")
    .slice(0, 7)
    .toUpperCase();
}

function officialRegionComponents(
  indices: readonly number[],
  provinces: readonly SourceProvince[],
  adjacency: ReturnType<typeof buildAdjacency>,
  allowOfficialRegions: boolean
): Array<{ members: number[]; official: boolean }> {
  if (!allowOfficialRegions) {
    return indices.map((index) => ({ members: [index], official: false }));
  }
  const members = indices.map((index) => provinces[index]!);
  const distinctRegions = new Set(members.map((member) => member.region));
  const hasCompleteMacroregions =
    members.length > 0 &&
    members.every((member) => validCode(member.region)) &&
    distinctRegions.size >= 2;
  if (!hasCompleteMacroregions) {
    return indices.map((index) => ({ members: [index], official: false }));
  }
  const allowed = new Set(indices);
  const pending = new Set(indices);
  const result: Array<{ members: number[]; official: boolean }> = [];
  while (pending.size > 0) {
    const start = [...pending].sort((a, b) => a - b)[0]!;
    pending.delete(start);
    const region = provinces[start]!.region;
    const component = [start];
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      const current = component[cursor]!;
      for (const neighbor of adjacency.neighbors[current] ?? []) {
        if (
          allowed.has(neighbor) &&
          pending.has(neighbor) &&
          provinces[neighbor]!.region === region
        ) {
          pending.delete(neighbor);
          component.push(neighbor);
        }
      }
    }
    component.sort((a, b) => a - b);
    result.push({ members: component, official: true });
  }
  return result;
}

function sourceFragmentCount(province: SourceProvince): number {
  return province.geometry.type === "Polygon" ? 1 : province.geometry.coordinates.length;
}

function clusterPerimeterKm(
  members: readonly number[],
  provinces: readonly SourceProvince[],
  adjacency: ReturnType<typeof buildAdjacency>
): number {
  const memberSet = new Set(members);
  let result = members.reduce(
    (sum, member) => sum + geometryPerimeterKm(provinces[member]!.geometry),
    0
  );
  for (const member of members) {
    for (const neighbor of adjacency.neighbors[member] ?? []) {
      if (member < neighbor && memberSet.has(neighbor)) {
        result -= 2 * (adjacency.sharedBorder.get(pairKey(member, neighbor)) ?? 0);
      }
    }
  }
  return Math.max(0, result);
}

function clusterSignature(cluster: Cluster, provinces: readonly SourceProvince[]): string {
  return cluster.members
    .map((member) => provinces[member]!.id)
    .sort()
    .join("|");
}

function sharedClusterBorderKm(
  cluster: Cluster,
  targetKey: number,
  owner: readonly number[],
  adjacency: ReturnType<typeof buildAdjacency>
): number {
  let result = 0;
  for (const member of cluster.members) {
    for (const neighbor of adjacency.neighbors[member] ?? []) {
      if (owner[neighbor] === targetKey) {
        result += adjacency.sharedBorder.get(pairKey(member, neighbor)) ?? 0;
      }
    }
  }
  return result;
}

function sameCountryLandNeighbors(
  cluster: Cluster,
  clusters: ReadonlyMap<number, Cluster>,
  owner: readonly number[],
  provinces: readonly SourceProvince[],
  adjacency: ReturnType<typeof buildAdjacency>
): Map<number, number> {
  const result = new Map<number, number>();
  for (const member of cluster.members) {
    for (const neighbor of adjacency.neighbors[member] ?? []) {
      const targetKey = owner[neighbor];
      if (targetKey === undefined || targetKey === cluster.key) continue;
      const target = clusters.get(targetKey);
      if (target?.countryId !== cluster.countryId) continue;
      const border = adjacency.sharedBorder.get(pairKey(member, neighbor)) ?? 0;
      if (border <= 0) continue;
      result.set(targetKey, (result.get(targetKey) ?? 0) + border);
    }
  }
  return result;
}

function isIslandCluster(
  cluster: Cluster,
  owner: readonly number[],
  adjacency: ReturnType<typeof buildAdjacency>
): boolean {
  if (!cluster.members.some((member) => adjacency.exposedBoundary[member] === true)) return false;
  for (const member of cluster.members) {
    for (const neighbor of adjacency.neighbors[member] ?? []) {
      if (owner[neighbor] !== cluster.key) return false;
    }
  }
  return true;
}

function mergeClusterInto(
  sourceKey: number,
  targetKey: number,
  method: MergeGroup["method"],
  clusters: Map<number, Cluster>,
  owner: number[],
  provinces: readonly SourceProvince[],
  adjacency: ReturnType<typeof buildAdjacency>
): void {
  const source = clusters.get(sourceKey);
  const target = clusters.get(targetKey);
  if (source === undefined || target === undefined || sourceKey === targetKey) return;
  const border = sharedClusterBorderKm(source, targetKey, owner, adjacency);
  const members = [...source.members, ...target.members].sort((a, b) => a - b);
  const adjacent = border > 0;
  clusters.set(targetKey, {
    key: targetKey,
    members,
    nameParts: [...source.nameParts, ...target.nameParts].sort((a, b) => a.order - b.order),
    countryId: target.countryId,
    areaKm2: source.areaKm2 + target.areaKm2,
    center: weightedCenter(members, provinces),
    perimeterKm: Math.max(0, source.perimeterKm + target.perimeterKm - 2 * border),
    fragmentCount: adjacent
      ? Math.max(1, source.fragmentCount + target.fragmentCount - 1)
      : source.fragmentCount + target.fragmentCount,
    method
  });
  clusters.delete(sourceKey);
  source.members.forEach((member) => (owner[member] = targetKey));
}

function mergeEnclosures(
  clusters: Map<number, Cluster>,
  owner: number[],
  provinces: readonly SourceProvince[],
  adjacency: ReturnType<typeof buildAdjacency>
): number {
  let mergeCount = 0;
  while (true) {
    let selected: { source: number; target: number } | undefined;
    const ordered = [...clusters.values()].sort(
      (a, b) =>
        a.areaKm2 - b.areaKm2 ||
        clusterSignature(a, provinces).localeCompare(clusterSignature(b, provinces))
    );
    for (const cluster of ordered) {
      if (cluster.members.some((member) => adjacency.exposedBoundary[member] === true)) continue;
      const external = new Set<number>();
      let touchesForeign = false;
      for (const member of cluster.members) {
        for (const neighbor of adjacency.neighbors[member] ?? []) {
          const targetKey = owner[neighbor];
          if (targetKey === undefined || targetKey === cluster.key) continue;
          const target = clusters.get(targetKey);
          if (target?.countryId !== cluster.countryId) touchesForeign = true;
          else external.add(targetKey);
        }
      }
      if (!touchesForeign && external.size === 1) {
        selected = { source: cluster.key, target: [...external][0]! };
        break;
      }
    }
    if (selected === undefined) return mergeCount;
    mergeClusterInto(
      selected.source,
      selected.target,
      "enclosure-merge",
      clusters,
      owner,
      provinces,
      adjacency
    );
    mergeCount += 1;
  }
}

function compactness(areaKm2: number, perimeterKm: number): number {
  return perimeterKm === 0 ? 0 : (4 * Math.PI * areaKm2) / perimeterKm ** 2;
}

function chooseLandTarget(
  source: Cluster,
  candidates: ReadonlyMap<number, number>,
  threshold: number,
  clusters: ReadonlyMap<number, Cluster>,
  provinces: readonly SourceProvince[]
): number | undefined {
  return [...candidates].sort(([aKey, aBorder], [bKey, bBorder]) => {
    const a = clusters.get(aKey)!;
    const b = clusters.get(bKey)!;
    const aArea = source.areaKm2 + a.areaKm2;
    const bArea = source.areaKm2 + b.areaKm2;
    const areaDelta = Math.abs(aArea - threshold) - Math.abs(bArea - threshold);
    if (Math.abs(areaDelta) > 1e-9) return areaDelta;
    if (Math.abs(aBorder - bBorder) > 1e-9) return bBorder - aBorder;
    const aCompactness = compactness(aArea, source.perimeterKm + a.perimeterKm - 2 * aBorder);
    const bCompactness = compactness(bArea, source.perimeterKm + b.perimeterKm - 2 * bBorder);
    if (Math.abs(aCompactness - bCompactness) > 1e-12) return bCompactness - aCompactness;
    const aFragments = Math.max(1, source.fragmentCount + a.fragmentCount - 1);
    const bFragments = Math.max(1, source.fragmentCount + b.fragmentCount - 1);
    if (aFragments !== bFragments) return aFragments - bFragments;
    return clusterSignature(a, provinces).localeCompare(clusterSignature(b, provinces));
  })[0]?.[0];
}

export function buildMergeGroups(
  provinces: readonly SourceProvince[],
  adjacency: ReturnType<typeof buildAdjacency>,
  parameters: MergeParameters
): MergeGroup[] {
  const countries = new Map<string, number[]>();
  for (const province of provinces) {
    const bucket = countries.get(province.countryId) ?? [];
    bucket.push(province.index);
    countries.set(province.countryId, bucket);
  }
  const countryAreas = new Map(
    [...countries].map(([countryId, indices]) => [
      countryId,
      indices.reduce((sum, index) => sum + provinces[index]!.areaKm2, 0)
    ])
  );
  const thresholds = new Map(
    [...countryAreas].map(([countryId, areaKm2]) => [
      countryId,
      dynamicMinimumProvinceAreaKm2(areaKm2, parameters)
    ])
  );
  const clusters = new Map<number, Cluster>();
  const owner = provinces.map(() => -1);
  let nextKey = 0;
  for (const [countryId, indices] of [...countries].sort(([a], [b]) => a.localeCompare(b))) {
    const allowOfficialRegions =
      countryAreas.get(countryId)! <= parameters.macroRegionCountryAreaLimitKm2;
    for (const component of officialRegionComponents(
      indices,
      provinces,
      adjacency,
      allowOfficialRegions
    )) {
      const key = nextKey++;
      const members = component.members;
      const areaKm2 = members.reduce((sum, member) => sum + provinces[member]!.areaKm2, 0);
      const firstMember = provinces[members[0]!]!;
      const excludedFromName = members.every((member) =>
        EXCLUDED_FROM_MERGED_PROVINCE_NAMES.has(provinces[member]!.id)
      );
      clusters.set(key, {
        key,
        members,
        nameParts: excludedFromName
          ? []
          : [
              {
                order: members[0]!,
                name: component.official ? firstMember.region! : firstMember.name,
                nameEn: component.official ? firstMember.region! : firstMember.nameEn
              }
            ],
        countryId: provinces[members[0]!]!.countryId,
        areaKm2,
        center: weightedCenter(members, provinces),
        perimeterKm: clusterPerimeterKm(members, provinces, adjacency),
        fragmentCount: members.reduce(
          (sum, member) => sum + sourceFragmentCount(provinces[member]!),
          0
        ),
        method: component.official ? "official-region" : "retained"
      });
      members.forEach((member) => (owner[member] = key));
    }
  }
  const enclosureMerges = mergeEnclosures(clusters, owner, provinces, adjacency);
  let areaMerges = 0;
  while (true) {
    let selected: { source: Cluster; target: number } | undefined;
    const undersized = [...clusters.values()]
      .filter((cluster) => cluster.areaKm2 + 1e-6 < thresholds.get(cluster.countryId)!)
      .sort(
        (a, b) =>
          a.areaKm2 - b.areaKm2 ||
          clusterSignature(a, provinces).localeCompare(clusterSignature(b, provinces))
      );
    for (const source of undersized) {
      const candidates = sameCountryLandNeighbors(source, clusters, owner, provinces, adjacency);
      const target = chooseLandTarget(
        source,
        candidates,
        thresholds.get(source.countryId)!,
        clusters,
        provinces
      );
      if (target !== undefined) {
        selected = { source, target };
        break;
      }
    }
    if (selected === undefined) break;
    mergeClusterInto(
      selected.source.key,
      selected.target,
      "area-merge",
      clusters,
      owner,
      provinces,
      adjacency
    );
    areaMerges += 1;
    mergeEnclosures(clusters, owner, provinces, adjacency);
  }

  const sourceGapCache = new Map<string, number>();
  const clusterGap = (a: Cluster, b: Cluster): number => {
    let result = Number.POSITIVE_INFINITY;
    for (const aMember of a.members) {
      for (const bMember of b.members) {
        const key = pairKey(aMember, bMember);
        let gap = sourceGapCache.get(key);
        if (gap === undefined) {
          gap = geometryGapKm(provinces[aMember]!.geometry, provinces[bMember]!.geometry);
          sourceGapCache.set(key, gap);
        }
        result = Math.min(result, gap);
      }
    }
    return result;
  };
  let archipelagoMerges = 0;
  while (true) {
    let selected: { source: Cluster; target: number } | undefined;
    const undersized = [...clusters.values()]
      .filter(
        (cluster) =>
          cluster.areaKm2 + 1e-6 < thresholds.get(cluster.countryId)! &&
          sameCountryLandNeighbors(cluster, clusters, owner, provinces, adjacency).size === 0 &&
          isIslandCluster(cluster, owner, adjacency)
      )
      .sort(
        (a, b) =>
          a.areaKm2 - b.areaKm2 ||
          clusterSignature(a, provinces).localeCompare(clusterSignature(b, provinces))
      );
    for (const source of undersized) {
      const threshold = thresholds.get(source.countryId)!;
      const candidates = [...clusters.values()]
        .filter(
          (candidate) =>
            candidate.key !== source.key &&
            candidate.countryId === source.countryId &&
            isIslandCluster(candidate, owner, adjacency)
        )
        .map((candidate) => ({ candidate, gap: clusterGap(source, candidate) }))
        .filter(({ gap }) => gap <= parameters.maximumArchipelagoGapKm + 1e-6)
        .sort((a, b) => {
          const areaDelta =
            Math.abs(source.areaKm2 + a.candidate.areaKm2 - threshold) -
            Math.abs(source.areaKm2 + b.candidate.areaKm2 - threshold);
          if (Math.abs(areaDelta) > 1e-9) return areaDelta;
          if (Math.abs(a.gap - b.gap) > 1e-6) return a.gap - b.gap;
          const fragmentDelta = a.candidate.fragmentCount - b.candidate.fragmentCount;
          if (fragmentDelta !== 0) return fragmentDelta;
          return clusterSignature(a.candidate, provinces).localeCompare(
            clusterSignature(b.candidate, provinces)
          );
        });
      if (candidates[0] !== undefined) {
        selected = { source, target: candidates[0].candidate.key };
        break;
      }
    }
    if (selected === undefined) break;
    mergeClusterInto(
      selected.source.key,
      selected.target,
      "archipelago-merge",
      clusters,
      owner,
      provinces,
      adjacency
    );
    archipelagoMerges += 1;
    mergeEnclosures(clusters, owner, provinces, adjacency);
  }

  console.log(
    `Uniform merge policy: ${enclosureMerges} enclosure, ${areaMerges} area, ${archipelagoMerges} archipelago merges.`
  );
  const groups = [...clusters.values()].map((cluster): MergeGroup => {
    const members = cluster.members.map((index) => provinces[index]!);
    const nameParts = cluster.nameParts.filter(
      (part, index, parts) =>
        parts.findIndex(
          (candidate) => candidate.name === part.name && candidate.nameEn === part.nameEn
        ) === index
    );
    if (nameParts.length === 0) {
      throw new Error(`Final province ${cluster.countryId} has no display name.`);
    }
    return {
      id:
        members.length === 1
          ? members[0]!.id
          : `${cluster.countryId}-G${groupHash(cluster.countryId, members)}`,
      name: nameParts.map((part) => part.name).join("–"),
      nameEn: nameParts.map((part) => part.nameEn).join("–"),
      countryId: cluster.countryId,
      memberIndices: cluster.members,
      method: cluster.method
    };
  });
  const assigned = groups.flatMap((group) => group.memberIndices);
  if (assigned.length !== provinces.length || new Set(assigned).size !== provinces.length) {
    throw new Error(`Merge plan assigned ${assigned.length}/${provinces.length} source provinces.`);
  }
  const ids = new Set<string>();
  for (const group of groups) {
    if (ids.has(group.id)) throw new Error(`Duplicate final province id ${group.id}.`);
    ids.add(group.id);
  }
  return groups.sort((a, b) => a.id.localeCompare(b.id));
}

function chooseCapital(
  geometry: AreaGeometry,
  countryId: string,
  candidates: readonly CapitalCandidate[]
): { capital: ProvinceCapital; source: ReviewProvince["capitalSource"] } {
  const matches = candidates
    .filter(
      (candidate) =>
        candidate.countryId === countryId && pointInGeometry(candidate.coordinates, geometry)
    )
    .sort((a, b) => Number(b.national) - Number(a.national) || b.population - a.population);
  const selected = matches[0];
  if (selected === undefined) {
    return { capital: { coordinates: interiorPoint(geometry) }, source: "generated" };
  }
  return {
    capital: {
      coordinates: selected.coordinates,
      name: selected.name,
      ...(selected.nameEn === undefined ? {} : { nameEn: selected.nameEn })
    },
    source: selected.national ? "national" : "regional"
  };
}

async function writeJson(path: string, value: unknown): Promise<number> {
  const text = `${JSON.stringify(value)}\n`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
  return Buffer.byteLength(text);
}

async function main(args: readonly string[]): Promise<void> {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const policy = await loadMergePolicy(join(projectRoot, "config/world-modern-merges.json"));
  const requestedRetainedFraction = parseRetainedFraction(args, policy.defaultRetainedArcFraction);
  const vendorDir = join(projectRoot, "cache/natural-earth");
  const outDir = join(projectRoot, "output/world-modern");
  await Promise.all([
    rm(join(outDir, "cities.geojson"), { force: true }),
    rm(join(outDir, "cities.json"), { force: true })
  ]);
  const provincesPath = await ensureSource(vendorDir, SOURCES.provinces);
  const placesPath = await ensureSource(vendorDir, SOURCES.places);
  const sourceProvinces = normalizeProvinces(await readCollection(provincesPath));
  const capitals = normalizeCapitals(await readCollection(placesPath));
  const sourceTopology = buildTopology("source", normalizedCollection(sourceProvinces));
  const sourceGeometries = topologyGeometries(sourceTopology, "source");
  const adjacency = buildAdjacency(sourceTopology, "source");
  const groups = buildMergeGroups(sourceProvinces, adjacency, policy);
  const countryAreas = new Map<string, number>();
  for (const province of sourceProvinces) {
    countryAreas.set(
      province.countryId,
      (countryAreas.get(province.countryId) ?? 0) + province.areaKm2
    );
  }
  const minimumAreas = new Map(
    [...countryAreas].map(([countryId, areaKm2]) => [
      countryId,
      dynamicMinimumProvinceAreaKm2(areaKm2, policy)
    ])
  );

  const review: ReviewProvince[] = [];
  const mergedFeatures: GeoJsonFeature<AreaGeometry>[] = groups.map((group) => {
    const geometry = mergeGeometry(
      sourceTopology,
      group.memberIndices.map((index) => sourceGeometries[index]!)
    );
    const selectedCapital = chooseCapital(geometry, group.countryId, capitals);
    const members = group.memberIndices.map((index) => sourceProvinces[index]!);
    review.push({
      id: group.id,
      name: group.name,
      nameEn: group.nameEn,
      countryId: group.countryId,
      method: group.method,
      members: members.map((member) => member.id),
      areaKm2: Math.round(geometryAreaKm2(geometry)),
      compactness: 0,
      fragmentCount: 0,
      vertexCount: 0,
      capital: selectedCapital.capital,
      capitalSource: selectedCapital.source,
      minimumAreaKm2: Math.round(minimumAreas.get(group.countryId)!)
    });
    return makeAuthoredFeature(
      group.id,
      {
        name: group.name,
        nameEn: group.nameEn,
        adm0A3: group.countryId,
        type: "Game province",
        capital: selectedCapital.capital
      },
      geometry
    );
  });

  const authoredTopology = buildTopology("provinces", {
    type: "FeatureCollection",
    features: mergedFeatures
  });
  const simplified = simplifyAuthoredTopology(
    authoredTopology,
    "provinces",
    requestedRetainedFraction
  );
  const provinces = authoredFeaturesFromTopology(simplified.topology, "provinces");
  for (const feature of provinces.features) {
    if (feature.geometry === null || feature.properties === null) continue;
    const capital = feature.properties.capital as ProvinceCapital | undefined;
    if (capital === undefined || !pointInGeometry(capital.coordinates, feature.geometry)) {
      feature.properties.capital = { coordinates: interiorPoint(feature.geometry) };
      const reviewEntry = review.find((entry) => entry.id === String(feature.id));
      if (reviewEntry !== undefined) {
        const index = review.indexOf(reviewEntry);
        review[index] = { ...reviewEntry, capitalSource: "generated" };
      }
    }
    const repairedCapital = feature.properties.capital as ProvinceCapital;
    if (!pointInGeometry(repairedCapital.coordinates, feature.geometry)) {
      throw new Error(`Unable to place an interior capital for province ${String(feature.id)}`);
    }
  }
  const lines = extractTopologyLines(simplified.topology, "provinces");
  const boundaries = { type: "BoundaryCollection", features: lines.boundaries };
  const countryCounts = Object.fromEntries(
    [...new Set(groups.map((group) => group.countryId))]
      .sort()
      .map((countryId) => [
        countryId,
        groups.filter((group) => group.countryId === countryId).length
      ])
  );
  const sourceCountryCounts = Object.fromEntries(
    [...new Set(sourceProvinces.map((province) => province.countryId))]
      .sort()
      .map((countryId) => [
        countryId,
        sourceProvinces.filter((province) => province.countryId === countryId).length
      ])
  );
  const provinceFeatures = new Map(
    provinces.features.map((feature) => [String(feature.id), feature] as const)
  );
  const detailedReview = review.map((entry) => {
    const feature = provinceFeatures.get(entry.id);
    if (
      feature?.geometry === null ||
      feature?.geometry === undefined ||
      feature.properties === null
    ) {
      throw new Error(`Review feature ${entry.id} is missing.`);
    }
    const areaKm2 = geometryAreaKm2(feature.geometry);
    const perimeterKm = geometryPerimeterKm(feature.geometry);
    const belowMinimum = areaKm2 + 1 < entry.minimumAreaKm2;
    return {
      ...entry,
      areaKm2: Math.round(areaKm2),
      compactness:
        perimeterKm === 0
          ? 0
          : Math.round(((4 * Math.PI * areaKm2) / perimeterKm ** 2) * 10_000) / 10_000,
      fragmentCount: feature.geometry.type === "Polygon" ? 1 : feature.geometry.coordinates.length,
      vertexCount: countVertices(feature.geometry),
      capital: feature.properties.capital as ProvinceCapital,
      ...(belowMinimum ? { belowMinimumReason: "no-legal-neighbor" as const } : {})
    };
  });
  const warnings = detailedReview.flatMap((entry) => {
    const results: string[] = [];
    if (entry.capitalSource === "generated") results.push(`${entry.id}: generated capital`);
    if (entry.fragmentCount > 20) results.push(`${entry.id}: ${entry.fragmentCount} fragments`);
    if (entry.compactness < 0.01 && entry.areaKm2 > 0)
      results.push(`${entry.id}: low compactness ${entry.compactness}`);
    if (entry.belowMinimumReason !== undefined)
      results.push(
        `${entry.id}: ${entry.areaKm2} km2 below ${entry.minimumAreaKm2} km2 (${entry.belowMinimumReason})`
      );
    return results;
  });
  const bytes: Record<string, number> = {};
  bytes.provinces = await writeJson(join(outDir, "provinces.geojson"), provinces);
  bytes.boundaries = await writeJson(join(outDir, "boundaries.json"), boundaries);
  bytes.coastlines = await writeJson(join(outDir, "coastlines.geojson"), lines.coastlines);
  bytes.manifest = await writeJson(join(outDir, "map.json"), {
    schemaVersion: 2,
    id: "world-modern",
    version: "0.3.4",
    nameKey: "map.worldModern.name",
    coordinateReferenceSystem: "EPSG:4326",
    layers: {
      provinces: "provinces.geojson",
      boundaries: "boundaries.json",
      coastlines: "coastlines.geojson"
    },
    attribution: {
      source: "Natural Earth 1:10m",
      license: "public domain",
      naturalEarthCommit: NATURAL_EARTH_COMMIT
    }
  });
  await writeJson(join(outDir, "review-report.json"), {
    sourceProvinceCount: sourceProvinces.length,
    provinceCount: provinces.features.length,
    countrySummary: Object.fromEntries(
      Object.keys(sourceCountryCounts).map((countryId) => [
        countryId,
        {
          before: sourceCountryCounts[countryId],
          after: countryCounts[countryId] ?? 0,
          areaKm2: Math.round(countryAreas.get(countryId) ?? 0),
          minimumAreaKm2: Math.round(minimumAreas.get(countryId) ?? 0),
          belowMinimum: detailedReview.filter(
            (province) =>
              province.countryId === countryId && province.belowMinimumReason !== undefined
          ).length
        }
      ])
    ),
    countryCounts,
    requestedRetainedFraction,
    retainedFraction: simplified.retainedFraction,
    vertices: provinces.features.reduce(
      (sum, feature) => sum + (feature.geometry === null ? 0 : countVertices(feature.geometry)),
      0
    ),
    bytes,
    warnings,
    parameters: policy,
    provinces: detailedReview
  });
  console.log(
    JSON.stringify(
      {
        outDir,
        sourceProvinces: sourceProvinces.length,
        provinces: provinces.features.length,
        boundaries: lines.boundaries.length,
        coastlines: lines.coastlines.features.length,
        requestedRetainedFraction,
        retainedFraction: simplified.retainedFraction,
        bytes,
        examples: Object.fromEntries(
          ["BEL", "NLD", "FRA", "DEU", "KWT", "BHR", "CHN", "USA", "IND", "RUS"].map(
            (countryId) => [countryId, countryCounts[countryId] ?? 0]
          )
        )
      },
      null,
      2
    )
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
