import { pointInFeatureBBox, pointInGeometry } from "./geometry.js";
import type { ProvinceFeature, SpatialIndexData } from "./types.js";

/** Uniform lon/lat grid for coarse province hit-testing. */
export class ProvinceGridIndex {
  private readonly cellSize: number;
  private readonly cells = new Map<string, ProvinceFeature[]>();

  constructor(features: readonly ProvinceFeature[], cellSizeDegrees = 5) {
    this.cellSize = cellSizeDegrees;
    for (const feature of features) {
      const [minLon, minLat, maxLon, maxLat] = feature.bbox;
      const minX = Math.floor(minLon / cellSizeDegrees);
      const maxX = Math.floor(maxLon / cellSizeDegrees);
      const minY = Math.floor(minLat / cellSizeDegrees);
      const maxY = Math.floor(maxLat / cellSizeDegrees);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = `${x}:${y}`;
          const bucket = this.cells.get(key);
          if (bucket === undefined) {
            this.cells.set(key, [feature]);
          } else {
            bucket.push(feature);
          }
        }
      }
    }
  }

  static fromPrecomputed(
    features: readonly ProvinceFeature[],
    data: SpatialIndexData
  ): ProvinceGridIndex {
    const byId = new Map(features.map((feature) => [feature.id, feature]));
    const index = Object.create(ProvinceGridIndex.prototype) as ProvinceGridIndex;
    (index as unknown as { cellSize: number }).cellSize = data.cellSizeDegrees;
    const cells = new Map<string, ProvinceFeature[]>();
    for (const [key, ids] of Object.entries(data.cells)) {
      const bucket: ProvinceFeature[] = [];
      for (const id of ids) {
        const feature = byId.get(id);
        if (feature !== undefined) {
          bucket.push(feature);
        }
      }
      if (bucket.length > 0) {
        cells.set(key, bucket);
      }
    }
    (index as unknown as { cells: Map<string, ProvinceFeature[]> }).cells = cells;
    return index;
  }

  private candidates(lon: number, lat: number): readonly ProvinceFeature[] {
    const x = Math.floor(lon / this.cellSize);
    const y = Math.floor(lat / this.cellSize);
    return this.cells.get(`${x}:${y}`) ?? [];
  }

  hitTest(lon: number, lat: number): ProvinceFeature | undefined {
    const seen = new Set<string>();
    for (const feature of this.candidates(lon, lat)) {
      if (seen.has(feature.id)) {
        continue;
      }
      seen.add(feature.id);
      if (!pointInFeatureBBox(lon, lat, feature)) {
        continue;
      }
      if (pointInGeometry(lon, lat, feature.geometry)) {
        return feature;
      }
    }
    return undefined;
  }
}
