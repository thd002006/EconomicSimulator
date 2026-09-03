import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "./geo.js";

export interface ProjectMeta {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly baseMapId: string;
  readonly suggestedMapId: string;
  readonly name: string;
  readonly nameEn?: string;
}

export interface ProjectGroup {
  readonly id: string;
  readonly countryId: string;
  readonly members: readonly string[];
  readonly name: string;
  readonly nameEn: string;
}

export interface ProjectRoadSegment {
  readonly id: string;
  readonly typeId: string;
  readonly provinceIdA: string;
  readonly provinceIdB: string;
  readonly name?: string;
  readonly nameEn?: string;
}

export interface ProjectRoadsFile {
  readonly schemaVersion: 1;
  readonly segments: readonly ProjectRoadSegment[];
}

export interface ProjectGroupsFile {
  readonly groups: readonly ProjectGroup[];
}

export interface EditorProject {
  readonly meta: ProjectMeta;
  readonly groups: readonly ProjectGroup[];
  readonly roads: ProjectRoadsFile;
}

export const EMPTY_PROJECT_ROADS: ProjectRoadsFile = Object.freeze({
  schemaVersion: 1,
  segments: Object.freeze([])
});

export function identityGroupsFromIds(
  provinces: readonly { id: string; countryId: string; name: string; nameEn: string }[]
): ProjectGroup[] {
  return provinces.map((province) => ({
    id: province.id,
    countryId: province.countryId,
    members: [province.id],
    name: province.name,
    nameEn: province.nameEn
  }));
}

export function validatePartition(
  groups: readonly ProjectGroup[],
  sourceIds: ReadonlySet<string>
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (group.members.length === 0) {
      errors.push(`Group ${group.id} has no members.`);
      continue;
    }
    for (const member of group.members) {
      if (!sourceIds.has(member)) {
        errors.push(`Group ${group.id} references unknown source ${member}.`);
      }
      if (seen.has(member)) {
        errors.push(`Source ${member} appears in more than one group.`);
      }
      seen.add(member);
    }
  }
  for (const id of sourceIds) {
    if (!seen.has(id)) errors.push(`Source ${id} is not assigned to any group.`);
  }
  return errors;
}

export function sanitizeProvinceId(id: string): string {
  return id
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/^[. ]+/g, "");
}

export function mergeGroups(
  groups: readonly ProjectGroup[],
  groupIds: readonly string[],
  merged: { id: string; name: string; nameEn: string }
): ProjectGroup[] {
  const selected = new Set(groupIds);
  const parts = groups.filter((group) => selected.has(group.id));
  if (parts.length < 2) throw new Error("Merge requires at least two groups.");
  const countryId = parts[0]!.countryId;
  if (parts.some((group) => group.countryId !== countryId)) {
    throw new Error("Cannot merge groups from different countries.");
  }
  const members = parts.flatMap((group) => group.members);
  const remainder = groups.filter((group) => !selected.has(group.id));
  const sanitizedId = sanitizeProvinceId(merged.id);
  if (!sanitizedId) throw new Error("Merged group id cannot be empty after sanitization.");
  return [
    ...remainder,
    {
      id: sanitizedId,
      countryId,
      members,
      name: merged.name,
      nameEn: merged.nameEn
    }
  ];
}

export function splitGroupWithNames(
  groups: readonly ProjectGroup[],
  groupId: string,
  nameById: ReadonlyMap<string, { name: string; nameEn: string }>
): ProjectGroup[] {
  const target = groups.find((group) => group.id === groupId);
  if (target === undefined) throw new Error(`Unknown group ${groupId}.`);
  if (target.members.length <= 1) throw new Error(`Group ${groupId} is already atomic.`);
  const remainder = groups.filter((group) => group.id !== groupId);
  const splits = target.members.map((memberId) => {
    const names = nameById.get(memberId);
    return {
      id: memberId,
      countryId: target.countryId,
      members: [memberId],
      name: names?.name ?? memberId,
      nameEn: names?.nameEn ?? memberId
    };
  });
  return [...remainder, ...splits];
}

function parseMeta(value: unknown): ProjectMeta {
  if (!isRecord(value)) throw new Error("project.json must be an object.");
  if (value.schemaVersion !== 1) throw new Error("Unsupported project schemaVersion.");
  for (const key of ["projectId", "baseMapId", "suggestedMapId", "name"] as const) {
    if (typeof value[key] !== "string" || value[key] === "") {
      throw new Error(`project.json.${key} must be a non-empty string.`);
    }
  }
  return {
    schemaVersion: 1,
    projectId: value.projectId as string,
    baseMapId: value.baseMapId as string,
    suggestedMapId: value.suggestedMapId as string,
    name: value.name as string,
    ...(typeof value.nameEn === "string" ? { nameEn: value.nameEn } : {})
  };
}

function parseGroups(value: unknown): ProjectGroup[] {
  if (!isRecord(value) || !Array.isArray(value.groups)) {
    throw new Error("groups.json must contain a groups array.");
  }
  return value.groups.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`groups[${index}] must be an object.`);
    if (typeof entry.id !== "string" || entry.id === "") {
      throw new Error(`groups[${index}].id is required.`);
    }
    if (typeof entry.countryId !== "string" || entry.countryId === "") {
      throw new Error(`groups[${index}].countryId is required.`);
    }
    if (!Array.isArray(entry.members) || entry.members.some((m) => typeof m !== "string")) {
      throw new Error(`groups[${index}].members must be a string array.`);
    }
    return {
      id: entry.id,
      countryId: entry.countryId,
      members: entry.members as string[],
      name: typeof entry.name === "string" ? entry.name : entry.id,
      nameEn: typeof entry.nameEn === "string" ? entry.nameEn : entry.id
    };
  });
}

function parseRoads(value: unknown): ProjectRoadsFile {
  if (value === undefined || value === null) return EMPTY_PROJECT_ROADS;
  if (!isRecord(value)) throw new Error("roads.json must be an object.");
  if (value.schemaVersion !== 1) throw new Error("Unsupported roads schemaVersion.");
  if (!Array.isArray(value.segments)) throw new Error("roads.json.segments must be an array.");
  const segments: ProjectRoadSegment[] = [];
  for (const [index, entry] of value.segments.entries()) {
    if (!isRecord(entry)) throw new Error(`roads.segments[${index}] must be an object.`);
    if (typeof entry.id !== "string" || entry.id === "") {
      throw new Error(`roads.segments[${index}].id is required.`);
    }
    if (typeof entry.typeId !== "string" || entry.typeId === "") {
      throw new Error(`roads.segments[${index}].typeId is required.`);
    }
    if (typeof entry.provinceIdA !== "string" || typeof entry.provinceIdB !== "string") {
      throw new Error(`roads.segments[${index}] requires provinceIdA/B.`);
    }
    const a = entry.provinceIdA < entry.provinceIdB ? entry.provinceIdA : entry.provinceIdB;
    const b = entry.provinceIdA < entry.provinceIdB ? entry.provinceIdB : entry.provinceIdA;
    segments.push({
      id: entry.id,
      typeId: entry.typeId,
      provinceIdA: a,
      provinceIdB: b,
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(typeof entry.nameEn === "string" ? { nameEn: entry.nameEn } : {})
    });
  }
  return { schemaVersion: 1, segments };
}

export function retainValidRoads(
  roads: ProjectRoadsFile,
  groupIds: ReadonlySet<string>
): ProjectRoadsFile {
  return {
    schemaVersion: 1,
    segments: roads.segments.filter(
      (segment) => groupIds.has(segment.provinceIdA) && groupIds.has(segment.provinceIdB)
    )
  };
}

export async function loadProject(projectDir: string): Promise<EditorProject> {
  const [metaRaw, groupsRaw] = await Promise.all([
    readFile(join(projectDir, "project.json"), "utf8"),
    readFile(join(projectDir, "groups.json"), "utf8")
  ]);
  let roadsRaw: string | undefined;
  try {
    roadsRaw = await readFile(join(projectDir, "roads.json"), "utf8");
  } catch {
    roadsRaw = undefined;
  }
  return {
    meta: parseMeta(JSON.parse(metaRaw) as unknown),
    groups: parseGroups(JSON.parse(groupsRaw) as unknown),
    roads: parseRoads(roadsRaw === undefined ? undefined : (JSON.parse(roadsRaw) as unknown))
  };
}

export async function saveProject(projectDir: string, project: EditorProject): Promise<void> {
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "project.json"), `${JSON.stringify(project.meta, null, 2)}\n`);
  await writeFile(
    join(projectDir, "groups.json"),
    `${JSON.stringify({ groups: project.groups }, null, 2)}\n`
  );
  await writeFile(
    join(projectDir, "roads.json"),
    `${JSON.stringify(project.roads ?? EMPTY_PROJECT_ROADS, null, 2)}\n`
  );
}

export async function listProjects(projectsRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(projectsRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

/** Resolve an unused map id under assets/maps (never overwrites). */
export async function allocateMapId(mapsRoot: string, requested: string): Promise<string> {
  const sanitized =
    requested
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "exported-map";
  const existing = new Set(
    (await readdir(mapsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );
  if (!existing.has(sanitized)) return sanitized;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${sanitized}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate a free map id from ${sanitized}.`);
}
