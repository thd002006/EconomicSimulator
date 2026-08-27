import type { OperatingUnitKind, OperatingUnitKindDefinition } from "./types.js";

export const OPERATING_UNIT_KIND_DEFINITIONS: readonly OperatingUnitKindDefinition[] = [
  {
    kind: "factory",
    requiredComponentKind: "production_site",
    permitsInventory: true,
    permitsRelocation: false,
    creatable: true
  },
  {
    kind: "farm",
    requiredComponentKind: "production_site",
    permitsInventory: true,
    permitsRelocation: false,
    creatable: false
  },
  {
    kind: "store",
    requiredComponentKind: "retail_site",
    permitsInventory: true,
    permitsRelocation: false,
    creatable: true
  },
  {
    kind: "service_business",
    requiredComponentKind: "service_site",
    permitsInventory: false,
    permitsRelocation: false,
    creatable: false
  },
  {
    kind: "headquarters",
    requiredComponentKind: "headquarters_site",
    permitsInventory: false,
    permitsRelocation: true,
    creatable: true
  },
  {
    kind: "warehouse",
    requiredComponentKind: "warehouse_site",
    permitsInventory: true,
    permitsRelocation: false,
    creatable: false
  },
  {
    kind: "road",
    requiredComponentKind: "infrastructure_operator",
    permitsInventory: false,
    permitsRelocation: false,
    creatable: true
  },
  {
    kind: "railway",
    requiredComponentKind: "infrastructure_operator",
    permitsInventory: false,
    permitsRelocation: false,
    creatable: false
  },
  {
    kind: "port",
    requiredComponentKind: "infrastructure_operator",
    permitsInventory: false,
    permitsRelocation: false,
    creatable: false
  },
  {
    kind: "utility",
    requiredComponentKind: "utility_site",
    permitsInventory: false,
    permitsRelocation: false,
    creatable: false
  },
  {
    kind: "government_service",
    requiredComponentKind: "government_service_site",
    permitsInventory: false,
    permitsRelocation: false,
    creatable: false
  }
];

const KIND_BY_ID = new Map(
  OPERATING_UNIT_KIND_DEFINITIONS.map((definition) => [definition.kind, definition])
);

export function getOperatingUnitKindDefinition(
  kind: OperatingUnitKind
): OperatingUnitKindDefinition {
  const definition = KIND_BY_ID.get(kind);
  if (definition === undefined) {
    throw new Error(`Unknown operating unit kind: ${kind}.`);
  }
  return definition;
}
