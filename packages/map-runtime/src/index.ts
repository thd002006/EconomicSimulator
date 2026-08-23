export interface GeoJsonInspection {
  readonly featureCount: number;
  readonly geometryCounts: Readonly<Record<string, number>>;
  readonly featureIds: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inspectFeatureCollection(input: unknown): GeoJsonInspection {
  if (!isRecord(input) || input.type !== "FeatureCollection" || !Array.isArray(input.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection.");
  }

  const ids = new Set<string>();
  const geometryCounts: Record<string, number> = {};

  for (const [index, feature] of input.features.entries()) {
    if (!isRecord(feature) || feature.type !== "Feature") {
      throw new Error(`Feature ${index} is invalid.`);
    }
    if (typeof feature.id !== "string" && typeof feature.id !== "number") {
      throw new Error(`Feature ${index} must have a stable string or number ID.`);
    }
    const id = String(feature.id);
    if (ids.has(id)) {
      throw new Error(`Duplicate GeoJSON feature ID: ${id}.`);
    }
    ids.add(id);

    if (!isRecord(feature.geometry) || typeof feature.geometry.type !== "string") {
      throw new Error(`Feature ${id} has invalid geometry.`);
    }
    geometryCounts[feature.geometry.type] = (geometryCounts[feature.geometry.type] ?? 0) + 1;
  }

  return {
    featureCount: input.features.length,
    geometryCounts,
    featureIds: [...ids].sort()
  };
}
