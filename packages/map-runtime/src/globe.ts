import type { LonLat, Vec3 } from "./types.js";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function lonLatToUnitVector(lon: number, lat: number, radius = 1): Vec3 {
  const longitude = lon * DEG_TO_RAD;
  const latitude = lat * DEG_TO_RAD;
  const cosLatitude = Math.cos(latitude);
  return [
    radius * cosLatitude * Math.sin(longitude),
    radius * Math.sin(latitude),
    radius * cosLatitude * Math.cos(longitude)
  ];
}

export function unitVectorToLonLat(vector: Vec3): LonLat {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length === 0) {
    throw new Error("Cannot convert a zero or non-finite vector to longitude/latitude.");
  }
  const lon = Math.atan2(vector[0], vector[2]) * RAD_TO_DEG;
  const lat = Math.asin(Math.max(-1, Math.min(1, vector[1] / length))) * RAD_TO_DEG;
  return [lon, lat];
}
