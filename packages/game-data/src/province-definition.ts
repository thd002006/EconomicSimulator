import { z } from "zod";
import provincesJson from "../data/provinces.json";

export const ProvinceDefinitionSchema = z.object({
  id: z.string().min(1),
  map: z.object({
    mapId: z.string().min(1),
    featureId: z.string().min(1),
  }),
  landAreaKm2: z.number().positive().finite(),
  arableLandKm2: z.number().nonnegative().finite(),
  cultivationCondition: z.number().min(0).max(1).finite(),
  habitability: z.number().min(0).max(1).finite(),
  terrainProfileId: z.string().min(1),
  climateProfileId: z.string().min(1),
  resourcePotentialByResourceId: z.record(z.string(), z.number().min(0).max(1)),
});

export type ProvinceDefinition = z.infer<typeof ProvinceDefinitionSchema>;

export const ProvinceDefinitionTableSchema = z.array(ProvinceDefinitionSchema).superRefine((definitions, ctx) => {
  const ids = new Set<string>();
  for (const def of definitions) {
    if (ids.has(def.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate ProvinceDefinition id: ${def.id}` });
    }
    ids.add(def.id);
    if (def.map.featureId !== def.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Province ${def.id} map.featureId mismatch: ${def.map.featureId}` });
    }
    if (def.arableLandKm2 - def.landAreaKm2 > 1e-6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Province ${def.id} arableLandKm2 (${def.arableLandKm2}) exceeds landAreaKm2 (${def.landAreaKm2})` });
    }
  }
});

export type ProvinceDefinitionTable = ProvinceDefinition[];

export function parseProvinceDefinitions(input: unknown): ProvinceDefinitionTable {
  return ProvinceDefinitionTableSchema.parse(input);
}

export const PROVINCE_DATA_PACK_VERSION = "province-v1" as const;

export const PROVINCE_DEFINITIONS: ProvinceDefinitionTable = ProvinceDefinitionTableSchema.parse(
  provincesJson,
);

export const PROVINCE_DEFINITIONS_BY_ID = new Map<string, ProvinceDefinition>(
  PROVINCE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function getProvinceDefinition(provinceId: string): ProvinceDefinition | undefined {
  return PROVINCE_DEFINITIONS_BY_ID.get(provinceId);
}
