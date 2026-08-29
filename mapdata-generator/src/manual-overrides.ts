import { readFile } from "node:fs/promises";
import type { MergeGroup, SourceProvince } from "./types.js";

export interface ManualGroupSpec {
  readonly id: string;
  readonly countryId: string;
  readonly members: readonly string[];
  readonly name?: string;
  readonly nameEn?: string;
}

export interface ManualOverrides {
  readonly manualGroups: readonly ManualGroupSpec[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function sanitizeProvinceId(id: string): string {
  return id
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/^[. ]+/g, "");
}

export async function loadManualOverrides(path: string): Promise<ManualOverrides | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) throw new Error(`Manual overrides at ${path} must be an object.`);
  const rawGroups = value.manualGroups;
  if (rawGroups === undefined) return { manualGroups: [] };
  if (!Array.isArray(rawGroups)) throw new Error(`manualGroups must be an array.`);
  const groups: ManualGroupSpec[] = [];
  const seenIds = new Set<string>();
  const seenMembers = new Set<string>();
  for (let i = 0; i < rawGroups.length; i++) {
    const raw = rawGroups[i] as unknown;
    if (!isRecord(raw)) throw new Error(`manualGroups[${i}] must be an object.`);
    const rawId = raw.id;
    const countryId = raw.countryId;
    const members = raw.members;
    if (typeof rawId !== "string" || rawId.trim() === "")
      throw new Error(`manualGroups[${i}].id must be a non-empty string.`);
    const id = sanitizeProvinceId(rawId);
    if (!id)
      throw new Error(`manualGroups[${i}].id must be a valid non-empty identifier.`);
    if (typeof countryId !== "string" || countryId.trim() === "")
      throw new Error(`manualGroups[${i}].countryId must be a string.`);
    if (!Array.isArray(members) || members.length === 0)
      throw new Error(`manualGroups[${i}].members must be a non-empty array.`);
    const normMembers = members.map((m, idx) => {
      if (typeof m !== "string" || m.trim() === "")
        throw new Error(`manualGroups[${i}].members[${idx}] must be a string.`);
      return m.trim();
    });
    if (seenIds.has(id)) throw new Error(`Duplicate manual group id ${id}.`);
    seenIds.add(id);
    for (const m of normMembers) {
      if (seenMembers.has(m))
        throw new Error(`Source province ${m} appears in multiple manual groups.`);
    }
    normMembers.forEach((m) => seenMembers.add(m));
    const name =
      typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : undefined;
    const nameEn =
      typeof raw.nameEn === "string" && raw.nameEn.trim() !== "" ? raw.nameEn.trim() : undefined;
    groups.push({
      id,
      countryId,
      members: normMembers,
      ...(name ? { name } : {}),
      ...(nameEn ? { nameEn } : {})
    });
  }
  return { manualGroups: groups };
}

export function applyManualOverrides(
  groups: readonly MergeGroup[],
  provinces: readonly SourceProvince[],
  overrides: ManualOverrides | undefined
): MergeGroup[] {
  if (overrides === undefined || overrides.manualGroups.length === 0) return [...groups];
  const provinceById = new Map<string, SourceProvince>();
  for (const p of provinces) provinceById.set(p.id, p);

  // Validate all manual member IDs exist and country matches
  for (const g of overrides.manualGroups) {
    for (const mid of g.members) {
      const prov = provinceById.get(mid);
      if (!prov) throw new Error(`Manual group ${g.id} references unknown province ${mid}.`);
      if (prov.countryId !== g.countryId) {
        throw new Error(
          `Manual group ${g.id} country ${g.countryId} mismatches province ${mid} country ${prov.countryId}.`
        );
      }
    }
  }

  const manualMemberSet = new Set<string>();
  for (const g of overrides.manualGroups) for (const m of g.members) manualMemberSet.add(m);

  // Build new groups: keep auto groups but strip manual members
  const nextGroups: MergeGroup[] = [];
  const manualIndexByMember = new Map<string, number>();
  overrides.manualGroups.forEach((g, idx) =>
    g.members.forEach((m) => manualIndexByMember.set(m, idx))
  );

  // Map from source index to manual group index for quick lookup
  const memberToManualGroup = new Map<number, number>();
  for (const p of provinces) {
    const mi = manualIndexByMember.get(p.id);
    if (mi !== undefined) memberToManualGroup.set(p.index, mi);
  }

  for (const group of groups) {
    const remainingIndices = group.memberIndices.filter((idx) => !memberToManualGroup.has(idx));
    const manualIndicesInGroup = group.memberIndices.filter((idx) => memberToManualGroup.has(idx));
    // If group has no remaining and all its members are manual, it will be fully replaced
    if (remainingIndices.length === 0) {
      // Fully consumed by manual groups, skip this auto group
      continue;
    }
    // If group had some manual members, we need to keep the remaining as a new group (if contiguous? For now keep as one)
    if (manualIndicesInGroup.length > 0) {
      // Need to split remaining by country? Group is already per-country, so ok.
      // Reuse original group id if only remaining members left; otherwise generate new id via hash? Simplify: keep original id if remaining still forms one group, but to avoid id collision we create derived id.
      // If remaining is subset of original, we create a new group with derived id
      const remainingMembers = remainingIndices.map((i) => provinces[i]!);
      const sortedIds = remainingMembers
        .map((m) => m.id)
        .sort()
        .join("|");
      // Keep original id if remainingIndices length === original, else derive
      const newId =
        remainingIndices.length === group.memberIndices.length
          ? group.id
          : `${group.countryId}-G-REMAIN-${hashShort(sortedIds)}`;
      const nameParts = remainingMembers.map((m) => m.name).join("–");
      const nameEnParts = remainingMembers.map((m) => m.nameEn).join("–");
      nextGroups.push({
        id: newId,
        name: group.name.includes("–") ? nameParts : remainingMembers[0]!.name,
        nameEn: group.nameEn.includes("–") ? nameEnParts : remainingMembers[0]!.nameEn,
        countryId: group.countryId,
        memberIndices: remainingIndices.sort((a, b) => a - b),
        method: group.method
      });
      // Also ensure we don't duplicate handling of manual members that were in this group - they will be added below
    } else {
      // No overlap, keep group as is
      nextGroups.push(group);
    }
  }

  // Now add manual groups
  // Need to map member ids to indices
  const idToIndex = new Map<string, number>();
  for (const p of provinces) idToIndex.set(p.id, p.index);

  for (const spec of overrides.manualGroups) {
    const indices = spec.members
      .map((mid) => {
        const idx = idToIndex.get(mid);
        if (idx === undefined) throw new Error(`Missing index for ${mid}`);
        return idx;
      })
      .sort((a, b) => a - b);
    // Determine display names: use explicit name if provided, else join source names
    let name: string;
    let nameEn: string;
    if (spec.name !== undefined || spec.nameEn !== undefined) {
      name = spec.name ?? spec.nameEn ?? provinces[indices[0]!]!.name;
      nameEn = spec.nameEn ?? spec.name ?? provinces[indices[0]!]!.nameEn;
    } else {
      if (indices.length === 1) {
        name = provinces[indices[0]!]!.name;
        nameEn = provinces[indices[0]!]!.nameEn;
      } else {
        name = indices.map((i) => provinces[i]!.name).join("–");
        nameEn = indices.map((i) => provinces[i]!.nameEn).join("–");
      }
    }
    nextGroups.push({
      id: spec.id,
      name,
      nameEn,
      countryId: spec.countryId,
      memberIndices: indices,
      method: "retained" // manual groups treated as retained to avoid area-merge labeling
    });
  }

  // Validate no duplicate member assignment
  const assigned = nextGroups.flatMap((g) => g.memberIndices);
  if (assigned.length !== provinces.length) {
    const missing = provinces.filter((p) => !assigned.includes(p.index)).map((p) => p.id);
    throw new Error(
      `Manual overrides left ${missing.length} provinces unassigned: ${missing.slice(0, 10).join(",")}`
    );
  }
  if (new Set(assigned).size !== assigned.length) {
    throw new Error(`Manual overrides produced duplicate member assignment.`);
  }
  const ids = new Set<string>();
  for (const g of nextGroups) {
    if (ids.has(g.id)) throw new Error(`Duplicate final province id ${g.id} after overrides.`);
    ids.add(g.id);
  }
  return nextGroups.sort((a, b) => a.id.localeCompare(b.id));
}

function hashShort(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h.toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
}
