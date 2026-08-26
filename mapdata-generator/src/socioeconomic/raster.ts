import { readFile } from "node:fs/promises";
import { fromArrayBuffer } from "geotiff";
import type { GeoTIFFImage } from "geotiff";

export type BBox = readonly [number, number, number, number];

const MOLLWEIDE_RADIUS_M = 6_371_007.181;

/** Inverse World Mollweide (EPSG:54009, central meridian 0, no false offsets). */
export function mollweideToLonLat(xM: number, yM: number): [number, number] {
  const sqrt2 = Math.SQRT2;
  const theta = Math.asin(Math.max(-1, Math.min(1, yM / (sqrt2 * MOLLWEIDE_RADIUS_M))));
  const lonRad = (Math.PI * xM) / (2 * sqrt2 * MOLLWEIDE_RADIUS_M * Math.cos(theta));
  const latSin = (2 * theta + Math.sin(2 * theta)) / Math.PI;
  const lat = Math.asin(Math.max(-1, Math.min(1, latSin)));
  return [(lonRad * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** Forward World Mollweide; used to bound province bboxes in projected space. */
export function lonLatToMollweide(lon: number, lat: number): [number, number] {
  const lonRad = (lon * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  let theta = Math.asin(Math.max(-1, Math.min(1, latRad)));
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const residual = 2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(latRad);
    const derivative = 2 + 2 * Math.cos(2 * theta);
    if (Math.abs(derivative) < 1e-9) break;
    const next = theta - residual / derivative;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - theta) < 1e-12) {
      theta = next;
      break;
    }
    theta = next;
  }
  const x = ((2 * Math.SQRT2) / Math.PI) * MOLLWEIDE_RADIUS_M * lonRad * Math.cos(theta);
  const y = Math.SQRT2 * MOLLWEIDE_RADIUS_M * Math.sin(theta);
  return [x, y];
}

export interface BlockSample {
  readonly lon: number;
  readonly lat: number;
  readonly value: number;
}

export interface GeoTiffRasterOptions {
  /** Source pixels aggregated per sample (n×n block summed onto its center). */
  readonly blockSizePx?: number;
}

/**
 * Windowed-access GeoTIFF sampler. The compressed file is read into memory
 * once; only tiles overlapping a requested window are decoded, so the
 * uncompressed multi-GB raster never fully materializes.
 */
export class GeoTiffRaster {
  private constructor(
    private readonly image: GeoTIFFImage,
    readonly width: number,
    readonly height: number,
    private readonly pixelScaleX: number,
    private readonly pixelScaleYAbs: number,
    private readonly tiePointX: number,
    private readonly tiePointY: number,
    readonly crs: "EPSG:4326" | "EPSG:54009",
    private readonly nodata: number | undefined,
    private readonly blockSizePx: number
  ) {}

  static async open(path: string, options: GeoTiffRasterOptions = {}): Promise<GeoTiffRaster> {
    const buffer = await readFile(path);
    const tiff = await fromArrayBuffer(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );
    const image = await tiff.getImage();
    const directory = image.fileDirectory;
    const scale = directory.ModelPixelScale as number[] | undefined;
    const tie = directory.ModelTiepoint as number[] | undefined;
    if (scale === undefined || tie === undefined || scale.length < 3 || tie.length < 6) {
      throw new Error(`Missing geo-referencing tags in ${path}.`);
    }
    let crs: "EPSG:4326" | "EPSG:54009" = "EPSG:4326";
    const geoKeys = directory.GeoKeyDirectory as number[] | undefined;
    if (geoKeys !== undefined) {
      const readKey = (keyId: number): number | undefined => {
        for (let index = 0; index + 3 < geoKeys.length; index += 4) {
          if (geoKeys[index] === keyId) return geoKeys[index + 3];
        }
        return undefined;
      };
      // GHS ships a user-defined projected CRS (GTModelType 32767, no
      // ProjectedCSType code). Distinguish by unit magnitude: meter-based
      // pixel scales are >>1, degree-based ones are fractions of a degree.
      const projType = readKey(3072);
      crs =
        projType === 54009 || (projType === undefined && scale[0]! > 1)
          ? "EPSG:54009"
          : "EPSG:4326";
    }
    const nodataTag = directory.GDAL_NODATA as unknown;
    let nodata: number | undefined;
    if (typeof nodataTag === "string") {
      const match = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(nodataTag);
      nodata = match === null ? undefined : Number(match[0]);
    } else if (typeof nodataTag === "number" && Number.isFinite(nodataTag)) {
      nodata = nodataTag;
    }
    return new GeoTiffRaster(
      image,
      image.getWidth(),
      image.getHeight(),
      scale[0]!,
      Math.abs(scale[1]!),
      tie[3]!,
      tie[4]!,
      crs,
      nodata,
      options.blockSizePx ?? 1
    );
  }

  private pixelCenterToLonLat(column: number, row: number): [number, number] {
    const x = this.tiePointX + (column + 0.5) * this.pixelScaleX;
    const y = this.tiePointY - (row + 0.5) * this.pixelScaleYAbs;
    if (this.crs === "EPSG:4326") return [x, y];
    return mollweideToLonLat(x, y);
  }

  private projectedBBoxOfLonLatBBox(bbox: BBox): BBox {
    if (this.crs === "EPSG:4326") return bbox;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const consider = (lon: number, lat: number): void => {
      const [x, y] = lonLatToMollweide(lon, lat);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    // Corner-only sampling degenerates near the poles (Mollweide converges
    // to points there), so densely sample the bbox edges instead.
    const lonSteps = 180;
    const latSteps = 90;
    for (let index = 0; index <= lonSteps; index += 1) {
      const lon = bbox[0] + ((bbox[2] - bbox[0]) * index) / lonSteps;
      consider(lon, bbox[1]);
      consider(lon, bbox[3]);
    }
    for (let index = 0; index <= latSteps; index += 1) {
      const lat = bbox[1] + ((bbox[3] - bbox[1]) * index) / latSteps;
      consider(bbox[0], lat);
      consider(bbox[2], lat);
    }
    return [minX, minY, maxX, maxY];
  }

  /**
   * Iterates n×n source-pixel blocks inside the lon/lat bounding box. Each
   * block yields one sample carrying the summed value at its center pixel's
   * coordinates. Nodata and non-finite cells contribute zero. Windows are
   * decoded in horizontal strips so huge bboxes never materialize fully.
   */
  async forEachBlock(bbox: BBox, callback: (sample: BlockSample) => void): Promise<void> {
    const step = this.blockSizePx;
    const projected = this.projectedBBoxOfLonLatBBox(bbox);
    const left = Math.max(0, Math.floor((projected[0] - this.tiePointX) / this.pixelScaleX));
    const right = Math.min(this.width, Math.ceil((projected[2] - this.tiePointX) / this.pixelScaleX));
    const top = Math.max(0, Math.floor((this.tiePointY - projected[3]) / this.pixelScaleYAbs));
    const bottom = Math.min(this.height, Math.ceil((this.tiePointY - projected[1]) / this.pixelScaleYAbs));
    if (left >= right || top >= bottom) return;

    const blockLeft = Math.floor(left / step) * step;
    const blockRight = Math.min(this.width, Math.ceil(right / step) * step);
    const windowWidth = blockRight - blockLeft;
    // Cap strip height to ~1024 source rows; for step=10 this is 1024 rows, for step=1 it's 1024 rows.
    // Full-global GHS (1km Mollweide) is ~40000px wide, so a strip is ~40M pixels (~160MB Float32) at most.
    const maxStripRows = Math.max(step, (1024 / step) * step);

    for (let stripTop = Math.floor(top / step) * step; stripTop < bottom; stripTop += maxStripRows) {
      const stripBottom = Math.min(this.height, Math.min(bottom, stripTop + maxStripRows));
      const windowHeight = stripBottom - stripTop;
      if (windowHeight < step) break;
      const rasters = await this.image.readRasters({
        window: [blockLeft, stripTop, blockRight, stripBottom],
        samples: [0]
      });
      const data = rasters[0] as Float32Array | Float64Array | Uint16Array | Uint8Array;

      for (let row = 0; row + step <= windowHeight; row += step) {
        for (let column = 0; column + step <= windowWidth; column += step) {
          let sum = 0;
          let valid = false;
          for (let innerRow = row; innerRow < row + step; innerRow += 1) {
            const offset = innerRow * windowWidth;
            for (let innerColumn = column; innerColumn < column + step; innerColumn += 1) {
              const value = data[offset + innerColumn]!;
              if (
                !Number.isFinite(value) ||
                (this.nodata !== undefined && Object.is(value, this.nodata))
              ) {
                continue;
              }
              sum += value;
              valid = true;
            }
          }
          if (!valid || sum === 0) continue;
          const centerColumn = blockLeft + column + (step >> 1);
          const centerRow = stripTop + row + (step >> 1);
          const [lon, lat] = this.pixelCenterToLonLat(centerColumn, centerRow);
          callback({ lon, lat, value: sum });
        }
      }
    }
  }
}
