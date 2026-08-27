import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeProvinceCsvSkeleton, writeMapManifest } from "./build-world-modern.js";
import { interiorPoint } from "./geo.js";
import {
  allocateMapId,
  loadProject,
  validatePartition,
  type ProjectGroup
} from "./project.js";
import type { ProvinceDemographicsEntry } from "./socioeconomic/aggregate.js";
import {
  buildTopology,
  extractTopologyLines,
  makeAuthoredFeature,
  mergeGeometry,
  simplifyAuthoredTopology,
  authoredFeaturesFromTopology,
  topologyGeometries
} from "./topology.js";
import type { AreaGeometry, GeoJsonFeature, GeoJsonFeatureCollection } from "./types.js";

interface BaseProvince {
  readonly id: string;
  readonly countryId: string;
  readonly name: string;
  readonly nameEn: string;
  readonly geometry: AreaGeometry;
  readonly capital?: { coordinates: [number, number]; name?: string; nameEn?: string };
}

async function loadBaseProvinces(baseRoot: string): Promise<Map<string, BaseProvince>> {
  const collection = JSON.parse(
    await readFile(join(baseRoot, "geometry/provinces.geojson"), "utf8")
  ) as GeoJsonFeatureCollection;
  const map = new Map<string, BaseProvince>();
  for (const feature of collection.features) {
    if (feature.geometry === null || feature.properties === null) continue;
    const id = String(feature.id);
    const props = feature.properties;
    const capital =
      props.capital !== null && typeof props.capital === "object"
        ? (props.capital as BaseProvince["capital"])
        : undefined;
    map.set(id, {
      id,
      countryId: typeof props.adm0A3 === "string" ? props.adm0A3 : "UNK",
      name: typeof props.name === "string" ? props.name : id,
      nameEn: typeof props.nameEn === "string" ? props.nameEn : id,
      geometry: feature.geometry as AreaGeometry,
      ...(capital === undefined ? {} : { capital })
    });
  }
  return map;
}

async function loadDemographics(
  baseRoot: string
): Promise<Record<string, ProvinceDemographicsEntry>> {
  try {
    return JSON.parse(await readFile(join(baseRoot, "demographics.json"), "utf8")) as Record<
      string,
      ProvinceDemographicsEntry
    >;
  } catch {
    return {};
  }
}

function sumDemographics(
  members: readonly string[],
  source: Readonly<Record<string, ProvinceDemographicsEntry>>
): ProvinceDemographicsEntry {
  const emptyAge = {
    child_0_14: 0,
    youth_15_24: 0,
    prime_25_44: 0,
    mature_45_64: 0,
    senior_65_plus: 0
  };
  const emptyEdu = { basic: 0, secondary: 0, tertiary: 0, advanced: 0 };
  let pop = 0;
  let male = 0;
  let female = 0;
  let gdpPpp = 0;
  const age = { ...emptyAge };
  const education15Plus = { ...emptyEdu };
  for (const member of members) {
    const entry = source[member];
    if (entry === undefined) continue;
    pop += entry.pop;
    male += entry.male;
    female += entry.female;
    gdpPpp += entry.gdpPpp;
    for (const key of Object.keys(age) as (keyof typeof age)[]) {
      age[key] += entry.age[key] ?? 0;
    }
    for (const key of Object.keys(education15Plus) as (keyof typeof education15Plus)[]) {
      education15Plus[key] += entry.education15Plus[key] ?? 0;
    }
  }
  return { pop, male, female, age, education15Plus, gdpPpp };
}

function dissolveGroup(group: ProjectGroup, base: ReadonlyMap<string, BaseProvince>): AreaGeometry {
  const members = group.members.map((id) => {
    const province = base.get(id);
    if (province === undefined) throw new Error(`Missing base province ${id}.`);
    return province;
  });
  if (members.length === 1) return members[0]!.geometry;
  const features: GeoJsonFeature<AreaGeometry>[] = members.map((member) => ({
    type: "Feature",
    id: member.id,
    properties: {},
    geometry: member.geometry
  }));
  const topology = buildTopology("members", { type: "FeatureCollection", features });
  return mergeGeometry(topology, topologyGeometries(topology, "members"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function publishMap(repoRoot: string, mapId: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@economic-simulator/map-pipeline", "publish-maps", "--", "--map", mapId],
      { cwd: repoRoot, stdio: "inherit", shell: true }
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`map:publish failed for ${mapId} with exit ${code}`));
    });
  });
}

export interface ExportResult {
  readonly mapId: string;
  readonly outDir: string;
  readonly provinceCount: number;
}

export async function exportProjectToL3L4(options: {
  readonly generatorRoot: string;
  readonly repoRoot: string;
  readonly projectId: string;
  readonly requestedMapId?: string;
  readonly retainedFraction?: number;
}): Promise<ExportResult> {
  const projectDir = join(options.generatorRoot, "projects", options.projectId);
  const project = await loadProject(projectDir);
  const baseRoot = join(options.generatorRoot, "base", project.meta.baseMapId);
  const base = await loadBaseProvinces(baseRoot);
  const errors = validatePartition(project.groups, new Set(base.keys()));
  if (errors.length > 0) {
    throw new Error(`Invalid L2 partition:\n${errors.slice(0, 20).join("\n")}`);
  }

  const mapsRoot = join(options.repoRoot, "assets/maps");
  const mapId = await allocateMapId(
    mapsRoot,
    options.requestedMapId ?? project.meta.suggestedMapId
  );
  const outDir = join(mapsRoot, mapId);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const demographics = await loadDemographics(baseRoot);
  const gdpById = new Map<string, number>();
  const derivedFeatures: GeoJsonFeature<AreaGeometry>[] = [];
  const derivedDemographics: Record<string, ProvinceDemographicsEntry> = {};

  for (const group of project.groups) {
    const geometry = dissolveGroup(group, base);
    const first = base.get(group.members[0]!)!;
    const capital = first.capital ?? { coordinates: interiorPoint(geometry) };
    const demo = sumDemographics(group.members, demographics);
    derivedDemographics[group.id] = demo;
    gdpById.set(group.id, demo.gdpPpp);
    derivedFeatures.push(
      makeAuthoredFeature(
        group.id,
        {
          name: group.name,
          nameEn: group.nameEn,
          adm0A3: group.countryId,
          type: "Game province",
          capital
        },
        geometry
      )
    );
  }

  const authoredTopology = buildTopology("provinces", {
    type: "FeatureCollection",
    features: derivedFeatures
  });
  const simplified = simplifyAuthoredTopology(
    authoredTopology,
    "provinces",
    options.retainedFraction ?? 0.5
  );
  const provinces = authoredFeaturesFromTopology(simplified.topology, "provinces");
  for (const feature of provinces.features) {
    if (feature.geometry === null || feature.properties === null) continue;
    const capital = feature.properties.capital as
      | { coordinates: [number, number] }
      | undefined;
    if (capital === undefined) {
      feature.properties.capital = { coordinates: interiorPoint(feature.geometry) };
    }
  }
  const lines = extractTopologyLines(simplified.topology, "provinces");
  const geometryDir = join(outDir, "geometry");
  await mkdir(geometryDir, { recursive: true });
  await writeJson(join(geometryDir, "provinces.geojson"), provinces);
  await writeJson(join(geometryDir, "boundaries.json"), {
    type: "BoundaryCollection",
    features: lines.boundaries
  });
  await writeJson(join(geometryDir, "coastlines.geojson"), lines.coastlines);
  await writeFile(
    join(outDir, "countries.csv"),
    await readFile(join(baseRoot, "countries.csv"), "utf8")
  );
  await writeProvinceCsvSkeleton(outDir, provinces, {
    unsetGameplayFields: true,
    gdpById
  });
  await writeMapManifest(outDir, {
    id: mapId,
    version: "0.1.0",
    nameKey: `map.${mapId}.name`,
    attribution: {
      source: "Natural Earth 1:10m via world-admin1 base",
      baseMapId: project.meta.baseMapId,
      projectId: project.meta.projectId
    }
  });
  await writeJson(join(outDir, "demographics.json"), derivedDemographics);
  await writeJson(join(outDir, "export-report.json"), {
    mapId,
    projectId: project.meta.projectId,
    baseMapId: project.meta.baseMapId,
    provinceCount: provinces.features.length,
    sourceProvinceCount: base.size
  });

  await publishMap(options.repoRoot, mapId);
  return { mapId, outDir, provinceCount: provinces.features.length };
}

function parseArgs(args: readonly string[]): { projectId: string; mapId?: string } {
  let projectId: string | undefined;
  let mapId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--project") {
      projectId = args[++index];
      continue;
    }
    if (argument === "--map-id") {
      mapId = args[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (projectId === undefined || projectId === "") {
    throw new Error("Usage: export-map --project <projectId> [--map-id <suggestedId>]");
  }
  return mapId === undefined ? { projectId } : { projectId, mapId };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const generatorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = resolve(generatorRoot, "..");
  const args = parseArgs(process.argv.slice(2));
  const result = await exportProjectToL3L4({
    generatorRoot,
    repoRoot,
    projectId: args.projectId,
    ...(args.mapId === undefined ? {} : { requestedMapId: args.mapId })
  });
  console.log(JSON.stringify(result, null, 2));
}
