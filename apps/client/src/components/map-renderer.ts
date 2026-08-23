import type {
  GeoJsonGeometry,
  LonLat,
  MapBoundary,
  MapFeature,
  MapViewModel
} from "@economic-simulator/map-runtime";
import { featureVisibleInViewport, projectToScreen } from "@economic-simulator/map-runtime";

const OCEAN = "#0b1c2c";
const LAND_STROKE = "#2a4558";
const COAST = "#7eb6c9";
const PROVINCE_BORDER = "#3d5a6e";
const COUNTRY_BORDER = "#d7e6f2";
const CITY = "#d7e8f5";
const HOVER_FILL = "#3a6f88";
const SELECT_FILL = "#4f8fad";
const SELECT_STROKE = "#b7e4f4";

export interface MapRenderCache {
  readonly provincePathsByLod: readonly ReadonlyMap<string, Path2D>[];
  readonly provinceOrder: readonly string[];
  readonly provinceById: ReadonlyMap<string, MapFeature>;
  readonly boundariesByProvince: ReadonlyMap<string, readonly MapBoundary[]>;
  readonly provinceFills: Map<string, string>;
  readonly coastPath: Path2D;
  provinceBorderPath: Path2D;
  countryBorderPath: Path2D;
  readonly boundaries: readonly MapBoundary[];
}

/** Pick coarse/medium/full province geometry from prebuilt LOD paths. */
export function selectProvinceLodIndex(zoom: number, lodCount: number): number {
  if (lodCount <= 1) {
    return 0;
  }
  if (zoom < 1.5) {
    return 0;
  }
  if (zoom < 6) {
    return Math.min(1, lodCount - 1);
  }
  return lodCount - 1;
}

function addRing(path: Path2D, ring: readonly LonLat[]): void {
  if (ring.length === 0) {
    return;
  }
  path.moveTo(ring[0]![0], ring[0]![1]);
  for (let i = 1; i < ring.length; i += 1) {
    path.lineTo(ring[i]![0], ring[i]![1]);
  }
  path.closePath();
}

function addGeometry(path: Path2D, geometry: GeoJsonGeometry): void {
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) {
      addRing(path, ring);
    }
    return;
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        addRing(path, ring);
      }
    }
    return;
  }
  if (geometry.type === "LineString") {
    if (geometry.coordinates.length === 0) {
      return;
    }
    path.moveTo(geometry.coordinates[0]![0], geometry.coordinates[0]![1]);
    for (let i = 1; i < geometry.coordinates.length; i += 1) {
      path.lineTo(geometry.coordinates[i]![0], geometry.coordinates[i]![1]);
    }
    return;
  }
  if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) {
      if (line.length === 0) {
        continue;
      }
      path.moveTo(line[0]![0], line[0]![1]);
      for (let i = 1; i < line.length; i += 1) {
        path.lineTo(line[i]![0], line[i]![1]);
      }
    }
  }
}

function addBoundaryLine(path: Path2D, coordinates: readonly LonLat[]): void {
  if (coordinates.length < 2) {
    return;
  }
  path.moveTo(coordinates[0]![0], coordinates[0]![1]);
  for (let i = 1; i < coordinates.length; i += 1) {
    path.lineTo(coordinates[i]![0], coordinates[i]![1]);
  }
}

function countryFill(adm0A3: string | undefined): string {
  if (adm0A3 === undefined || adm0A3.length === 0) {
    return "#1a3348";
  }
  let hash = 0;
  for (let i = 0; i < adm0A3.length; i += 1) {
    hash = (hash * 33 + adm0A3.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} ${28 + (hash % 18)}% ${28 + (hash % 10)}%)`;
}

function indexBoundariesByProvince(
  boundaries: readonly MapBoundary[]
): ReadonlyMap<string, readonly MapBoundary[]> {
  const map = new Map<string, MapBoundary[]>();
  const add = (provinceId: string, boundary: MapBoundary): void => {
    const bucket = map.get(provinceId);
    if (bucket === undefined) {
      map.set(provinceId, [boundary]);
    } else {
      bucket.push(boundary);
    }
  };
  for (const boundary of boundaries) {
    add(boundary.leftProvinceId, boundary);
    if (boundary.rightProvinceId !== null) {
      add(boundary.rightProvinceId, boundary);
    }
  }
  return map;
}

function resolveOwner(
  model: MapViewModel,
  provinceId: string,
  ownerLookup?: (provinceId: string) => string | undefined
): string | undefined {
  return ownerLookup?.(provinceId) ?? model.hooks.getProvinceOwner?.(provinceId);
}

export function rebuildBoundaryPaths(
  cache: MapRenderCache,
  model: MapViewModel,
  ownerLookup?: (provinceId: string) => string | undefined
): void {
  const provinceBorderPath = new Path2D();
  const countryBorderPath = new Path2D();
  for (const boundary of cache.boundaries) {
    const leftOwner = resolveOwner(model, boundary.leftProvinceId, ownerLookup);
    const rightOwner =
      boundary.rightProvinceId === null
        ? undefined
        : resolveOwner(model, boundary.rightProvinceId, ownerLookup);
    const isCountryBorder =
      boundary.rightProvinceId === null ||
      leftOwner === undefined ||
      rightOwner === undefined ||
      leftOwner !== rightOwner;
    addBoundaryLine(isCountryBorder ? countryBorderPath : provinceBorderPath, boundary.coordinates);
  }
  cache.provinceBorderPath = provinceBorderPath;
  cache.countryBorderPath = countryBorderPath;
}

export function rebuildProvinceFills(
  cache: MapRenderCache,
  model: MapViewModel,
  ownerLookup?: (provinceId: string) => string | undefined,
  changedProvinceIds?: readonly string[]
): void {
  const targets =
    changedProvinceIds === undefined || changedProvinceIds.length === 0
      ? cache.provinceOrder
      : changedProvinceIds;
  for (const id of targets) {
    const feature = cache.provinceById.get(id);
    cache.provinceFills.set(
      id,
      countryFill(resolveOwner(model, id, ownerLookup) ?? feature?.properties.adm0A3)
    );
  }
}

export function rebuildOwnershipStyles(
  cache: MapRenderCache,
  model: MapViewModel,
  ownerLookup?: (provinceId: string) => string | undefined,
  changedProvinceIds?: readonly string[]
): void {
  const fullRebuild =
    changedProvinceIds === undefined ||
    changedProvinceIds.length === 0 ||
    changedProvinceIds.length >= cache.provinceOrder.length / 2;
  rebuildProvinceFills(cache, model, ownerLookup, fullRebuild ? undefined : changedProvinceIds);
  rebuildBoundaryPaths(cache, model, ownerLookup);
}

export function buildMapRenderCache(
  model: MapViewModel,
  ownerLookup?: (provinceId: string) => string | undefined
): MapRenderCache {
  const provinceOrder: string[] = [];
  const provinceById = new Map<string, MapFeature>();
  const provinceFills = new Map<string, string>();
  const lodCount = Math.max(1, ...model.provinces.map((feature) => feature.lod?.length ?? 1));
  const provincePathsByLod: Map<string, Path2D>[] = Array.from(
    { length: lodCount },
    () => new Map()
  );

  for (const feature of model.provinces) {
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") {
      continue;
    }
    provinceOrder.push(feature.id);
    provinceById.set(feature.id, feature);
    provinceFills.set(
      feature.id,
      countryFill(resolveOwner(model, feature.id, ownerLookup) ?? feature.properties.adm0A3)
    );

    for (let lodIndex = 0; lodIndex < lodCount; lodIndex += 1) {
      const geometry =
        feature.lod !== undefined && feature.lod[lodIndex] !== undefined
          ? feature.lod[lodIndex]!
          : feature.lod !== undefined && feature.lod.length > 0
            ? feature.lod[feature.lod.length - 1]!
            : feature.geometry;
      const path = new Path2D();
      addGeometry(path, geometry);
      provincePathsByLod[lodIndex]!.set(feature.id, path);
    }
  }

  const coastPath = new Path2D();
  for (const feature of model.coastlines) {
    addGeometry(coastPath, feature.geometry);
  }

  const boundariesByProvince = indexBoundariesByProvince(model.boundaries);
  const cache: MapRenderCache = {
    provincePathsByLod,
    provinceOrder,
    provinceById,
    boundariesByProvince,
    provinceFills,
    coastPath,
    provinceBorderPath: new Path2D(),
    countryBorderPath: new Path2D(),
    boundaries: model.boundaries
  };
  rebuildBoundaryPaths(cache, model, ownerLookup);
  return cache;
}

function applyWorldTransform(
  ctx: CanvasRenderingContext2D,
  viewport: MapViewModel["viewport"],
  dpr: number
): void {
  const zoom = viewport.zoom;
  ctx.setTransform(
    zoom * dpr,
    0,
    0,
    -zoom * dpr,
    (viewport.width / 2 - viewport.centerLon * zoom) * dpr,
    (viewport.height / 2 + viewport.centerLat * zoom) * dpr
  );
}

function screenLineWidth(viewport: MapViewModel["viewport"], pixels: number): number {
  return pixels / Math.max(viewport.zoom, 0.001);
}

export function renderMapView(
  ctx: CanvasRenderingContext2D,
  model: MapViewModel,
  cache: MapRenderCache,
  dpr: number,
  options?: { readonly interactive?: boolean }
): void {
  const interactive = options?.interactive === true;
  const lodIndex = selectProvinceLodIndex(model.viewport.zoom, cache.provincePathsByLod.length);
  const provincePaths =
    cache.provincePathsByLod[lodIndex] ??
    cache.provincePathsByLod[cache.provincePathsByLod.length - 1]!;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = OCEAN;
  ctx.fillRect(0, 0, model.viewport.width, model.viewport.height);
  applyWorldTransform(ctx, model.viewport, dpr);

  for (const id of cache.provinceOrder) {
    const path = provincePaths.get(id);
    if (path === undefined) {
      continue;
    }
    let fill = model.hooks.getProvinceFill?.(id) ?? cache.provinceFills.get(id) ?? "#1a3348";
    if (id === model.selectedProvinceId) {
      fill = SELECT_FILL;
    } else if (id === model.hoveredProvinceId) {
      fill = HOVER_FILL;
    }
    ctx.fillStyle = fill;
    ctx.fill(path, "evenodd");
  }

  ctx.strokeStyle = LAND_STROKE;
  ctx.lineWidth = screenLineWidth(model.viewport, 0.35);
  ctx.lineJoin = "round";
  for (const id of cache.provinceOrder) {
    const path = provincePaths.get(id);
    if (path !== undefined) {
      ctx.stroke(path);
    }
  }

  ctx.strokeStyle = PROVINCE_BORDER;
  ctx.lineWidth = screenLineWidth(model.viewport, 0.55);
  ctx.stroke(cache.provinceBorderPath);

  ctx.strokeStyle = COUNTRY_BORDER;
  ctx.lineWidth = screenLineWidth(model.viewport, interactive ? 1.1 : 1.35);
  ctx.stroke(cache.countryBorderPath);

  if (model.selectedProvinceId !== undefined) {
    const selectedPath = provincePaths.get(model.selectedProvinceId);
    if (selectedPath !== undefined) {
      ctx.strokeStyle = SELECT_STROKE;
      ctx.lineWidth = screenLineWidth(model.viewport, 1.6);
      ctx.stroke(selectedPath);
    }
  }

  ctx.strokeStyle = COAST;
  ctx.lineWidth = screenLineWidth(model.viewport, 0.9);
  ctx.stroke(cache.coastPath);

  if (interactive || model.viewport.zoom < 2 || model.cities.length === 0) {
    return;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = CITY;
  for (const feature of model.cities) {
    if (!featureVisibleInViewport(feature, model.viewport)) {
      continue;
    }
    if (feature.geometry.type !== "Point") {
      continue;
    }
    const [x, y] = projectToScreen(
      feature.geometry.coordinates[0],
      feature.geometry.coordinates[1],
      model.viewport
    );
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function provinceLabel(feature: MapFeature | undefined): string {
  if (feature === undefined) {
    return "—";
  }
  return feature.properties.nameEn ?? feature.properties.name ?? feature.id;
}
