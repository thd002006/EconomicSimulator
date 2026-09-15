import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "./geo.js";
import type { DisputedProvinceProperty, DisputedTerritorySpec } from "./types.js";

export interface DisputedTerritoriesConfig {
  readonly disputedTerritories: readonly DisputedTerritorySpec[];
}

function isDisputedSpec(v: unknown): v is DisputedTerritorySpec {
  if (!isRecord(v)) return false;
  if (typeof v.provinceIdPattern !== "string" || v.provinceIdPattern === "") return false;
  if (typeof v.countryId !== "string" || v.countryId === "") return false;
  if (
    v.level !== "disputed-area" &&
    v.level !== "de-facto-control" &&
    v.level !== "special-admin"
  )
    return false;
  if (!Array.isArray(v.claimedBy) || v.claimedBy.some((c) => typeof c !== "string"))
    return false;
  if (typeof v.administeredBy !== "string" || v.administeredBy === "") return false;
  if (typeof v.noteZh !== "string" || typeof v.noteEn !== "string") return false;
  return true;
}

export async function loadDisputedTerritories(
  projectRoot: string
): Promise<DisputedTerritoriesConfig | undefined> {
  let text: string;
  try {
    text = await readFile(join(projectRoot, "config/disputed-territories.json"), "utf8");
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value) || !Array.isArray(value.disputedTerritories)) {
    throw new Error("disputed-territories.json must contain a disputedTerritories array.");
  }
  const specs: DisputedTerritorySpec[] = [];
  for (let i = 0; i < value.disputedTerritories.length; i++) {
    const entry = value.disputedTerritories[i];
    if (!isDisputedSpec(entry)) {
      throw new Error(`disputed-territories.json[${i}] is not a valid DisputedTerritorySpec.`);
    }
    specs.push(entry);
  }
  return { disputedTerritories: specs };
}

/**
 * Match a province id against the configured patterns.
 * Patterns use simple prefix matching with `*` wildcard suffix.
 */
function matchesPattern(provinceId: string, pattern: string): boolean {
  if (pattern === provinceId) return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return provinceId.startsWith(prefix);
  }
  return false;
}

export function findDisputedSpec(
  provinceId: string,
  config: DisputedTerritoriesConfig | undefined
): DisputedTerritorySpec | undefined {
  if (config === undefined) return undefined;
  for (const spec of config.disputedTerritories) {
    if (matchesPattern(provinceId, spec.provinceIdPattern)) return spec;
  }
  return undefined;
}

/** First disputed spec matching any member; a merged province inherits its disputed members. */
export function findDisputedSpecForProvinces(
  provinceIds: readonly string[],
  config: DisputedTerritoriesConfig | undefined
): DisputedTerritorySpec | undefined {
  if (config === undefined) return undefined;
  for (const provinceId of provinceIds) {
    const spec = findDisputedSpec(provinceId, config);
    if (spec !== undefined) return spec;
  }
  return undefined;
}

/** Strip config-only matching fields before storing on an authored province. */
export function toDisputedProperty(spec: DisputedTerritorySpec): DisputedProvinceProperty {
  return {
    level: spec.level,
    claimedBy: spec.claimedBy,
    administeredBy: spec.administeredBy,
    noteZh: spec.noteZh,
    noteEn: spec.noteEn
  };
}