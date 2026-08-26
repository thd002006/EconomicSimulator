export interface SourceMapManifest {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly version: string;
  readonly nameKey: string;
  readonly coordinateReferenceSystem: "EPSG:4326";
  readonly layers: {
    readonly provinces: string;
    readonly boundaries: string;
    readonly coastlines?: string;
    readonly countries?: string;
    readonly demographics?: string;
  };
  readonly attribution?: {
    readonly source: string;
    readonly license: string;
    readonly naturalEarthCommit?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Source map manifest ${field} must be a non-empty string.`);
  }
  return value;
}

export function parseSourceMapManifest(value: unknown, expectedId: string): SourceMapManifest {
  if (!isRecord(value)) throw new Error("Source map manifest must be an object.");
  if (value.schemaVersion !== 2) {
    throw new Error(
      `Unsupported source map schemaVersion ${String(value.schemaVersion)}; expected 2.`
    );
  }
  const id = requiredString(value.id, "id");
  if (id !== expectedId) {
    throw new Error(`Source map manifest id ${id} does not match directory ${expectedId}.`);
  }
  const version = requiredString(value.version, "version");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Source map manifest version must be SemVer: ${version}.`);
  }
  const nameKey = requiredString(value.nameKey, "nameKey");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nameKey)) {
    throw new Error(`Source map manifest nameKey is invalid: ${nameKey}.`);
  }
  if (value.coordinateReferenceSystem !== "EPSG:4326") {
    throw new Error("Source map manifest coordinateReferenceSystem must be EPSG:4326.");
  }
  if (!isRecord(value.layers)) throw new Error("Source map manifest layers must be an object.");
  const provinces = requiredString(value.layers.provinces, "layers.provinces");
  const boundaries = requiredString(value.layers.boundaries, "layers.boundaries");
  const coastlines =
    value.layers.coastlines === undefined
      ? undefined
      : requiredString(value.layers.coastlines, "layers.coastlines");
  const countries =
    value.layers.countries === undefined
      ? undefined
      : requiredString(value.layers.countries, "layers.countries");
  const demographics =
    (value.layers as Record<string, unknown>).demographics === undefined
      ? undefined
      : requiredString((value.layers as Record<string, unknown>).demographics as string, "layers.demographics");
  let attribution: SourceMapManifest["attribution"];
  if (value.attribution !== undefined) {
    if (!isRecord(value.attribution)) {
      throw new Error("Source map manifest attribution must be an object.");
    }
    const naturalEarthCommit =
      value.attribution.naturalEarthCommit === undefined
        ? undefined
        : requiredString(value.attribution.naturalEarthCommit, "attribution.naturalEarthCommit");
    attribution = {
      source: requiredString(value.attribution.source, "attribution.source"),
      license: requiredString(value.attribution.license, "attribution.license"),
      ...(naturalEarthCommit === undefined ? {} : { naturalEarthCommit })
    };
  }
  return {
    schemaVersion: 2,
    id,
    version,
    nameKey,
    coordinateReferenceSystem: "EPSG:4326",
    layers: {
      provinces,
      boundaries,
      ...(coastlines === undefined ? {} : { coastlines }),
      ...(countries === undefined ? {} : { countries }),
      ...(demographics === undefined ? {} : { demographics })
    },
    ...(attribution === undefined ? {} : { attribution })
  };
}
