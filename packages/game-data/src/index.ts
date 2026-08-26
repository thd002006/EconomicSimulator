import { z } from "zod";

export * from "./population-data-pack";

export const GAME_DATA_SCHEMA_VERSION = 1 as const;

const DefinitionReferenceSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1)
});

export const GameDataManifestSchema = z.object({
  schemaVersion: z.literal(GAME_DATA_SCHEMA_VERSION),
  dataPackVersion: z.string().min(1),
  definitions: z.array(DefinitionReferenceSchema),
  maps: z.array(DefinitionReferenceSchema)
});

export type GameDataManifest = z.infer<typeof GameDataManifestSchema>;

export function parseGameDataManifest(input: unknown): GameDataManifest {
  const manifest = GameDataManifestSchema.parse(input);
  const ids = new Set<string>();
  for (const reference of [...manifest.definitions, ...manifest.maps]) {
    if (ids.has(reference.id)) {
      throw new Error(`Duplicate game-data reference ID: ${reference.id}.`);
    }
    ids.add(reference.id);
  }
  return manifest;
}
