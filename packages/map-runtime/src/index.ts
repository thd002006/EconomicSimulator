export { inspectFeatureCollection } from "./types.js";
export type {
  GeoJsonGeometry,
  GeoJsonInspection,
  LonLat,
  MapBoundary,
  MapFeature,
  MapFeatureProperties,
  ProvinceCapital,
  ProvinceFeature,
  ProvinceFeatureProperties,
  MapPackManifest,
  MapPackProvenance,
  MapViewModel,
  MapViewModelHooks,
  GlobeMeshData,
  GlobeMeshLod,
  Vec3,
  SpatialIndexData
} from "./types.js";

export { lonLatToUnitVector, unitVectorToLonLat } from "./globe.js";

export {
  createGlobeMeshData,
  GLOBE_MESH_BINARY_MAGIC,
  GLOBE_MESH_BINARY_VERSION,
  GLOBE_MESH_HEADER_BYTES,
  parseGlobeMeshBuffer,
  parseGlobeMeshMetadata
} from "./globe-mesh.js";
export type { GlobeMeshMetadata } from "./globe-mesh.js";

export {
  computeBBox,
  pointInFeatureBBox,
  pointInGeometry,
  pointInPolygon,
  pointInRing
} from "./geometry.js";

export { ProvinceGridIndex } from "./spatial-index.js";
export { loadMapPack, MapSchemaError, parseMapPackBundle } from "./load-map-pack.js";
export type { LoadedMapPack, MapPackBundleInput } from "./load-map-pack.js";
export {
  parseBBox,
  parseLineGeometry,
  parsePointGeometry,
  parseProvinceCapital,
  parsePolygonGeometry
} from "./schema.js";
export { createMapViewModel } from "./view-model.js";
