import type { LonLat } from "./types.js";

export const MAP_WIDTH_DEGREES = 360;
export const MAP_HEIGHT_DEGREES = 180;
export const MAP_MIN_LON = -180;
export const MAP_MAX_LON = 180;
export const MAP_MIN_LAT = -90;
export const MAP_MAX_LAT = 90;

/** Wrap longitude into (-180, 180]. */
export function wrapLongitude(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === MAP_MIN_LON ? MAP_MAX_LON : wrapped;
}

export function lonLatToMapXY(lon: number, lat: number): readonly [number, number] {
  return [wrapLongitude(lon), Math.max(MAP_MIN_LAT, Math.min(MAP_MAX_LAT, lat))];
}

export function mapXYToLonLat(x: number, y: number): LonLat {
  return [wrapLongitude(x), Math.max(MAP_MIN_LAT, Math.min(MAP_MAX_LAT, y))];
}
