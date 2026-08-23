import type { LonLat, MapFeature, MapViewport } from "./types.js";

export function projectToScreen(lon: number, lat: number, viewport: MapViewport): LonLat {
  const x = (lon - viewport.centerLon) * viewport.zoom + viewport.width / 2;
  const y = (viewport.centerLat - lat) * viewport.zoom + viewport.height / 2;
  return [x, y];
}

export function unprojectFromScreen(x: number, y: number, viewport: MapViewport): LonLat {
  const lon = (x - viewport.width / 2) / viewport.zoom + viewport.centerLon;
  const lat = viewport.centerLat - (y - viewport.height / 2) / viewport.zoom;
  return [lon, lat];
}

export function clampZoom(zoom: number): number {
  return Math.min(64, Math.max(0.8, zoom));
}

export function panViewport(viewport: MapViewport, dxPx: number, dyPx: number): void {
  viewport.centerLon -= dxPx / viewport.zoom;
  viewport.centerLat += dyPx / viewport.zoom;
}

export function zoomViewportAt(
  viewport: MapViewport,
  screenX: number,
  screenY: number,
  factor: number
): void {
  const [lon, lat] = unprojectFromScreen(screenX, screenY, viewport);
  viewport.zoom = clampZoom(viewport.zoom * factor);
  const [afterX, afterY] = projectToScreen(lon, lat, viewport);
  panViewport(viewport, afterX - screenX, afterY - screenY);
}

export function featureVisibleInViewport(feature: MapFeature, viewport: MapViewport): boolean {
  const [minLon, minLat, maxLon, maxLat] = feature.bbox;
  const left = viewport.centerLon - viewport.width / 2 / viewport.zoom;
  const right = viewport.centerLon + viewport.width / 2 / viewport.zoom;
  const bottom = viewport.centerLat - viewport.height / 2 / viewport.zoom;
  const top = viewport.centerLat + viewport.height / 2 / viewport.zoom;
  return !(maxLon < left || minLon > right || maxLat < bottom || minLat > top);
}
