export interface SourceMapManifest {
  readonly schemaVersion: 3;
  readonly id: string;
  readonly version: string;
  readonly nameKey: string;
  readonly coordinateReferenceSystem: "EPSG:4326";
  readonly layers: {
    readonly provinces: string;
    readonly boundaries: string;
    readonly coastlines?: string;
    readonly countries: string;
    readonly provincesDir: string;
    readonly companiesDir: string;
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

function parseAttribution(
  value: unknown
): SourceMapManifest["attribution"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error("Source map manifest attribution must be an object.");
  }
  const naturalEarthCommit =
    value.naturalEarthCommit === undefined
      ? undefined
      : requiredString(value.naturalEarthCommit, "attribution.naturalEarthCommit");
  return {
    source: requiredString(value.source, "attribution.source"),
    license: requiredString(value.license, "attribution.license"),
    ...(naturalEarthCommit === undefined ? {} : { naturalEarthCommit })
  };
}

export function parseSourceMapManifest(value: unknown, expectedId: string): SourceMapManifest {
  if (!isRecord(value)) throw new Error("Source map manifest must be an object.");
  if (value.schemaVersion !== 3) {
    throw new Error(
      `Unsupported source map schemaVersion ${String(value.schemaVersion)}; expected 3.`
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
  const attribution = parseAttribution(value.attribution);
  const provinces = requiredString(value.layers.provinces, "layers.provinces");
  const boundaries = requiredString(value.layers.boundaries, "layers.boundaries");
  const coastlines =
    value.layers.coastlines === undefined
      ? undefined
      : requiredString(value.layers.coastlines, "layers.coastlines");
  const countries = requiredString(value.layers.countries, "layers.countries");
  const provincesDir = requiredString(value.layers.provincesDir, "layers.provincesDir");
  const companiesDir =
    value.layers.companiesDir === undefined
      ? "companies"
      : requiredString(value.layers.companiesDir, "layers.companiesDir");
  return {
    schemaVersion: 3,
    id,
    version,
    nameKey,
    coordinateReferenceSystem: "EPSG:4326",
    layers: {
      provinces,
      boundaries,
      ...(coastlines === undefined ? {} : { coastlines }),
      countries,
      provincesDir,
      companiesDir
    },
    ...(attribution === undefined ? {} : { attribution })
  };
}
