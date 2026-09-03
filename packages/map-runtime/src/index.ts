export { inspectFeatureCollection } from "./types.js";
export type {
  CountryAggregate,
  CountryNameEntry,
  CountryNameTable,
  GeoJsonGeometry,
  GeoJsonInspection,
  GlobeMeshData,
  GlobeMeshLod,
  LonLat,
  MapBoundary,
  MapFeature,
  MapFeatureProperties,
  MapPackManifest,
  MapPackProvenance,
  MapViewModel,
  MapViewModelHooks,
  ProvinceCapital,
  ProvinceDemographicsEntry,
  ProvinceDemographicsTable,
  ProvinceFeature,
  ProvinceFeatureProperties,
  RoadBendOverride,
  RoadCollection,
  RoadSegment,
  RoadSegmentId,
  RoadTypeDefinition,
  RoadTypeId,
  SpatialIndexData,
  Vec3
} from "./types.js";

export { lonLatToUnitVector, unitVectorToLonLat } from "./globe.js";
export {
  lonLatToMapXY,
  mapXYToLonLat,
  wrapLongitude,
  MAP_HEIGHT_DEGREES,
  MAP_MAX_LAT,
  MAP_MAX_LON,
  MAP_MIN_LAT,
  MAP_MIN_LON,
  MAP_WIDTH_DEGREES
} from "./map-projection.js";

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
export { loadMapPack, parseMapPackBundle } from "./load-map-pack.js";
export type { LoadedMapPack, MapPackBundleInput, ScenarioSeedData } from "./load-map-pack.js";
export {
  MapSchemaError,
  parseBBox,
  parseLineGeometry,
  parsePointGeometry,
  parsePolygonGeometry,
  parseProvinceCapital,
  parseProvinceDescription
} from "./schema.js";
export { createMapViewModel } from "./view-model.js";
export {
  ROAD_TYPE_DEFINITIONS,
  ROAD_TYPE_HIGHWAY,
  ROAD_TYPE_LOCAL,
  ROAD_TYPE_RAILWAY,
  getRoadTypeDefinition,
  isKnownRoadTypeId,
  roadTypesSortedByDrawOrder
} from "./road-types.js";
export {
  EMPTY_ROAD_COLLECTION,
  adjacencyPairKey,
  buildAdjacencyPairSet,
  buildBoundaryMidpointIndex,
  buildSharedBoundaryIndex,
  buildRoadDrawBatches,
  parseRoadCollection,
  roadSegmentKey,
  sampleRoadSegmentCurve
} from "./roads.js";
export type {
  BuildRoadDrawBatchesOptions,
  RoadDrawBatch,
  RoadParseContext,
  SampleRoadCurveOptions
} from "./roads.js";
