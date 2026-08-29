import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  writeProvinceCsvSkeleton,
  writeMapManifest,
  type ProvinceAgrarianOverview
} from "./build-world-modern.js";
import {
  ensureProjectClassesFromBase,
  parseCsvLine,
  readProvinceClassCsvs,
  splitDemographicsIntoClasses,
  sumClassSeedRows,
  writeClassSeedRows,
  type ClassSeedRow
} from "./class-split.js";
import type { ProvinceDemographicsEntry } from "./socioeconomic/aggregate.js";
import { interiorPoint, pointInGeometry } from "./geo.js";
import { allocateMapId, loadProject, validatePartition, type ProjectGroup } from "./project.js";
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

interface SourceProvinceOverview {
  readonly arableLandKm2: number;
  readonly landAreaKm2: number;
  readonly cultivationCondition: number;
  readonly habitability: number;
  readonly terrainProfileId: string;
  readonly climateProfileId: string;
  readonly gdpPpp: number;
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

async function loadSourceProvinceOverviewById(
  baseRoot: string
): Promise<Map<string, SourceProvinceOverview>> {
  const result = new Map<string, SourceProvinceOverview>();
  const provincesRoot = join(baseRoot, "provinces");
  let ids: string[] = [];
  try {
    ids = (await readdir(provincesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return result;
  }
  for (const id of ids) {
    try {
      const text = await readFile(join(provincesRoot, id, "province.csv"), "utf8");
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) continue;
      const headers = parseCsvLine(lines[0]!);
      const cells = parseCsvLine(lines[1]!);
      const getNum = (field: string, fallback = 0): number => {
        const idx = headers.indexOf(field);
        if (idx < 0) return fallback;
        const n = Number(cells[idx]);
        return Number.isFinite(n) ? n : fallback;
      };
      const getStr = (field: string, fallback = "temperate"): string => {
        const idx = headers.indexOf(field);
        if (idx < 0) return fallback;
        const val = cells[idx]?.trim();
        return val ? val : fallback;
      };
      result.set(id, {
        arableLandKm2: getNum("arable_land_km2", 0),
        landAreaKm2: Math.max(1, getNum("land_area_km2", 1)),
        cultivationCondition: getNum("cultivation_condition", 0.5),
        habitability: getNum("habitability", 0.5),
        terrainProfileId: getStr("terrain_profile_id", "temperate"),
        climateProfileId: getStr("climate_profile_id", "temperate"),
        gdpPpp: getNum("gdp_ppp", 0)
      });
    } catch {
      // skip missing province.csv
    }
  }
  return result;
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
      "corepack",
      [
        "pnpm",
        "--filter",
        "@economic-simulator/map-pipeline",
        "publish-maps",
        "--",
        "--map",
        mapId
      ],
      { cwd: repoRoot, stdio: "inherit", shell: true }
    );
    child.on("error", (err) => {
      reject(new Error(`Failed to spawn publish-maps process: ${err.message}`));
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`map:publish failed for ${mapId} with exit status ${code}`));
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
  readonly skipPublish?: boolean;
}): Promise<ExportResult> {
  const projectDir = join(options.generatorRoot, "projects", options.projectId);
  const project = await loadProject(projectDir);
  const baseRoot = join(options.generatorRoot, "base", project.meta.baseMapId);
  const base = await loadBaseProvinces(baseRoot);
  const errors = validatePartition(project.groups, new Set(base.keys()));
  if (errors.length > 0) {
    throw new Error(`Invalid L2 partition:\n${errors.slice(0, 20).join("\n")}`);
  }

  // Ensure all member provinces have class data in L2 (auto-generate from L1 if missing)
  const allMemberIds = new Set(project.groups.flatMap((g) => g.members));
  await ensureProjectClassesFromBase(projectDir, baseRoot, allMemberIds);

  const mapsRoot = join(options.repoRoot, "assets/maps");
  const mapId = (options.requestedMapId ?? project.meta.suggestedMapId).trim().toLowerCase();
  const outDir = join(mapsRoot, mapId);
  const stagingDir = join(mapsRoot, `.${mapId}.exporting-${process.pid}-${Date.now()}`);
  await mkdir(stagingDir, { recursive: true });
  let installed = false;

  try {
    const sourceOverviews = await loadSourceProvinceOverviewById(baseRoot);
    const gdpById = new Map<string, number>();
    const agrarianById = new Map<string, ProvinceAgrarianOverview>();
    const derivedFeatures: GeoJsonFeature<AreaGeometry>[] = [];
    const classRowsByGroup = new Map<string, Awaited<ReturnType<typeof sumClassSeedRows>>>();

    for (const group of project.groups) {
      const geometry = dissolveGroup(group, base);
      const first = base.get(group.members[0]!)!;
      const capital = first.capital ?? { coordinates: interiorPoint(geometry) };
      const memberClassRows = await Promise.all(
        group.members.map((memberId) =>
          readProvinceClassCsvs(join(projectDir, "provinces", memberId))
        )
      );
      const mergedClasses = sumClassSeedRows(memberClassRows);
      classRowsByGroup.set(group.id, mergedClasses);

      let totalGdp = 0;
      let totalArable = 0;
      let totalLandArea = 0;
      let weightedCultivation = 0;
      let weightedHabitability = 0;
      let primaryTerrain = "temperate";
      let primaryClimate = "temperate";
      let maxArea = -1;

      for (const memberId of group.members) {
        const src = sourceOverviews.get(memberId);
        if (src === undefined) continue;
        totalGdp += src.gdpPpp;
        totalArable += src.arableLandKm2;
        totalLandArea += src.landAreaKm2;
        weightedCultivation += src.cultivationCondition * src.landAreaKm2;
        weightedHabitability += src.habitability * src.landAreaKm2;
        if (src.landAreaKm2 > maxArea) {
          maxArea = src.landAreaKm2;
          primaryTerrain = src.terrainProfileId;
          primaryClimate = src.climateProfileId;
        }
      }

      gdpById.set(group.id, totalGdp);
      agrarianById.set(group.id, {
        arableLandKm2: totalArable,
        cultivationCondition:
          totalLandArea > 0 ? Math.round((weightedCultivation / totalLandArea) * 1000) / 1000 : 0.5,
        habitability:
          totalLandArea > 0
            ? Math.round((weightedHabitability / totalLandArea) * 1000) / 1000
            : 0.5,
        terrainProfileId: primaryTerrain,
        climateProfileId: primaryClimate
      });

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
      const capital = feature.properties.capital as { coordinates: [number, number] } | undefined;
      if (capital === undefined || !pointInGeometry(capital.coordinates, feature.geometry)) {
        feature.properties.capital = {
          ...capital,
          coordinates: interiorPoint(feature.geometry)
        };
      }
    }
    const lines = extractTopologyLines(simplified.topology, "provinces");
    const geometryDir = join(stagingDir, "geometry");
    await mkdir(geometryDir, { recursive: true });
    await writeJson(join(geometryDir, "provinces.geojson"), provinces);
    await writeJson(join(geometryDir, "boundaries.json"), {
      type: "BoundaryCollection",
      features: lines.boundaries
    });
    await writeJson(join(geometryDir, "coastlines.geojson"), lines.coastlines);
    await writeFile(
      join(stagingDir, "countries.csv"),
      await readFile(join(baseRoot, "countries.csv"), "utf8")
    );
    await writeProvinceCsvSkeleton(stagingDir, provinces, {
      unsetGameplayFields: false,
      gdpById,
      agrarianById
    });
    let classFiles = 0;
    for (const [provinceId, rows] of classRowsByGroup) {
      classFiles += await writeClassSeedRows(join(stagingDir, "provinces", provinceId), rows);
    }
    await writeMapManifest(stagingDir, {
      id: mapId,
      version: "0.1.0",
      nameKey: `map.${mapId}.name`,
      attribution: {
        source: "Natural Earth 1:10m via world-admin1 base",
        baseMapId: project.meta.baseMapId,
        projectId: project.meta.projectId
      }
    });
    await writeJson(join(stagingDir, "export-report.json"), {
      mapId,
      projectId: project.meta.projectId,
      baseMapId: project.meta.baseMapId,
      provinceCount: provinces.features.length,
      sourceProvinceCount: base.size,
      classFiles
    });

    let renameError: unknown;
    await rm(outDir, { recursive: true, force: true });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rename(stagingDir, outDir);
        renameError = undefined;
        break;
      } catch (error) {
        renameError = error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EACCES") throw error;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100 * (attempt + 1)));
      }
    }
    if (renameError !== undefined) {
      await mkdir(outDir, { recursive: true });
      await cp(stagingDir, outDir, { recursive: true });
      await rm(stagingDir, { recursive: true, force: true });
    }
    installed = true;

    if (options.skipPublish !== true) {
      await publishMap(options.repoRoot, mapId);
    }
    return { mapId, outDir, provinceCount: provinces.features.length };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    if (!installed) await rm(outDir, { recursive: true, force: true });
    throw error;
  }
}

function parseArgs(args: readonly string[]): { projectId: string; mapId?: string } {
  let projectId: string | undefined;
  let mapId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
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
