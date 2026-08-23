export type IdentifiedFeature = { readonly id?: unknown };

export function stableFeatureId(feature: IdentifiedFeature, index: number, layer: string): string {
  const raw = feature.id;
  const validString = typeof raw === "string" && raw.trim() !== "";
  const validNumber = typeof raw === "number" && Number.isFinite(raw);
  if (!validString && !validNumber) {
    throw new Error(`${layer} feature ${index} is missing a stable id.`);
  }
  return String(raw);
}

export function assertUniqueFeatureIds(
  features: readonly IdentifiedFeature[],
  layer: string
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [index, feature] of features.entries()) {
    const id = stableFeatureId(feature, index, layer);
    if (seen.has(id)) throw new Error(`${layer} contains duplicate feature id: ${id}.`);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
