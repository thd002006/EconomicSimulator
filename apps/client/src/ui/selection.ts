export type MapSelectionKind = "province" | "country";

export type MapSelection =
  | { readonly kind: "province"; readonly id: string }
  | { readonly kind: "country"; readonly id: string };

/** Resolve a province hit into province or country selection based on LOD. */
export function selectionFromPick(
  provinceId: string | undefined,
  ownerId: string | undefined,
  provinceDetail: boolean
): MapSelection | undefined {
  if (provinceId === undefined) return undefined;
  if (provinceDetail) return { kind: "province", id: provinceId };
  if (ownerId === undefined || ownerId === "") return undefined;
  return { kind: "country", id: ownerId };
}

export function sameSelection(
  a: MapSelection | undefined,
  b: MapSelection | undefined
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.kind === b.kind && a.id === b.id;
}
