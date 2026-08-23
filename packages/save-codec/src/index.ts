import { isSimulationSnapshot, type SimulationSnapshot } from "@economic-simulator/simulation-core";

export const SAVE_FORMAT_VERSION = 1 as const;

export interface SaveMetadataInput {
  readonly gameVersion: string;
  readonly simulationVersion: string;
  readonly protocolVersion: number;
  readonly dataPackVersion: string;
  readonly savedAt: string;
}

export interface SaveFileV1 {
  readonly saveFormatVersion: typeof SAVE_FORMAT_VERSION;
  readonly metadata: SaveMetadataInput;
  readonly snapshot: SimulationSnapshot;
  readonly checksum: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Save data cannot contain NaN or Infinity.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`Unsupported save value: ${typeof value}.`);
}

export function checksum(value: unknown): string {
  const text = canonicalStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function validateMetadata(value: unknown): value is SaveMetadataInput {
  return (
    isRecord(value) &&
    typeof value.gameVersion === "string" &&
    typeof value.simulationVersion === "string" &&
    Number.isSafeInteger(value.protocolVersion) &&
    typeof value.dataPackVersion === "string" &&
    typeof value.savedAt === "string"
  );
}

export function encodeSave(snapshot: SimulationSnapshot, metadata: SaveMetadataInput): string {
  if (!isSimulationSnapshot(snapshot)) {
    throw new Error("Cannot encode an invalid simulation snapshot.");
  }

  const body = {
    saveFormatVersion: SAVE_FORMAT_VERSION,
    metadata,
    snapshot
  };

  return canonicalStringify({ ...body, checksum: checksum(body) });
}

export function decodeSave(text: string): SaveFileV1 {
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) {
    throw new Error("Save file must be an object.");
  }
  if (value.saveFormatVersion !== SAVE_FORMAT_VERSION) {
    throw new Error("Unsupported save format version.");
  }
  if (!validateMetadata(value.metadata) || !isSimulationSnapshot(value.snapshot)) {
    throw new Error("Save file payload is invalid.");
  }
  if (typeof value.checksum !== "string") {
    throw new Error("Save file checksum is missing.");
  }

  const body = {
    saveFormatVersion: SAVE_FORMAT_VERSION,
    metadata: value.metadata,
    snapshot: value.snapshot
  };
  if (checksum(body) !== value.checksum) {
    throw new Error("Save file checksum does not match its contents.");
  }

  return { ...body, checksum: value.checksum };
}
