import {
  lonLatToMapXY,
  wrapLongitude,
  type ProvinceFeature
} from "@economic-simulator/map-runtime";
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { MAP_WRAP } from "./map-controls.js";

export const COUNTRY_LABEL_HALF_HEIGHT = 55;
export const PROVINCE_LABEL_HALF_HEIGHT = 40;
export const MAJOR_COUNTRY_MIN_PROVINCES = 12;

export type MapLabelKind = "country-major" | "country" | "province";

export interface MapLabelSpec {
  readonly id: string;
  readonly kind: MapLabelKind;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly provinceCount: number;
}

export function labelVisibility(halfHeight: number, kind: MapLabelKind): boolean {
  if (kind === "province") return halfHeight <= PROVINCE_LABEL_HALF_HEIGHT;
  if (kind === "country") return halfHeight <= COUNTRY_LABEL_HALF_HEIGHT;
  return true;
}

export function wrapLabelX(baseX: number, cameraX: number): number {
  let x = baseX;
  while (x - cameraX > MAP_WRAP / 2) x -= MAP_WRAP;
  while (cameraX - x > MAP_WRAP / 2) x += MAP_WRAP;
  return x;
}

export function buildProvinceLabels(provinces: readonly ProvinceFeature[]): MapLabelSpec[] {
  const labels: MapLabelSpec[] = [];
  for (const feature of provinces) {
    const text = feature.properties.nameEn ?? feature.properties.name;
    if (text === undefined || text.length === 0) continue;
    const [x, y] = lonLatToMapXY(
      feature.properties.capital.coordinates[0],
      feature.properties.capital.coordinates[1]
    );
    labels.push({
      id: `province:${feature.id}`,
      kind: "province",
      text,
      x,
      y,
      provinceCount: 1
    });
  }
  return labels;
}

export function buildCountryLabelAnchors(
  provinces: readonly ProvinceFeature[],
  ownerLookup: (provinceId: string) => string | undefined
): MapLabelSpec[] {
  const groups = new Map<
    string,
    { sumX: number; sumY: number; count: number; sampleName?: string }
  >();
  for (const feature of provinces) {
    const owner = ownerLookup(feature.id) ?? feature.properties.adm0A3;
    if (owner === undefined || owner.length === 0) continue;
    const [x, y] = lonLatToMapXY(
      feature.properties.capital.coordinates[0],
      feature.properties.capital.coordinates[1]
    );
    const existing = groups.get(owner);
    if (existing === undefined) {
      groups.set(owner, { sumX: x, sumY: y, count: 1 });
    } else {
      // Keep longitude average on the shortest-arc side of the running mean.
      let lon = x;
      const meanLon = existing.sumX / existing.count;
      if (lon - meanLon > 180) lon -= 360;
      if (meanLon - lon > 180) lon += 360;
      existing.sumX += lon;
      existing.sumY += y;
      existing.count += 1;
    }
  }

  const labels: MapLabelSpec[] = [];
  for (const [owner, group] of groups) {
    const meanX = wrapLongitude(group.sumX / group.count);
    const meanY = group.sumY / group.count;
    const kind: MapLabelKind =
      group.count >= MAJOR_COUNTRY_MIN_PROVINCES ? "country-major" : "country";
    labels.push({
      id: `country:${owner}`,
      kind,
      text: owner,
      x: meanX,
      y: meanY,
      provinceCount: group.count
    });
  }
  return labels;
}

const LABEL_Z = 0.06;

export class MapLabelLayer {
  private readonly cssRenderer: CSS2DRenderer;
  private readonly root = new THREE.Group();
  private readonly objects = new Map<string, CSS2DObject>();
  private readonly specs = new Map<string, MapLabelSpec>();
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.cssRenderer = new CSS2DRenderer();
    this.cssRenderer.domElement.className = "map-label-layer";
    this.cssRenderer.domElement.style.position = "absolute";
    this.cssRenderer.domElement.style.inset = "0";
    this.cssRenderer.domElement.style.pointerEvents = "none";
    this.container.appendChild(this.cssRenderer.domElement);
  }

  get sceneRoot(): THREE.Object3D {
    return this.root;
  }

  setLabels(specs: readonly MapLabelSpec[]): void {
    const nextIds = new Set(specs.map((spec) => spec.id));
    for (const [id, object] of this.objects) {
      if (nextIds.has(id)) continue;
      this.root.remove(object);
      object.element.remove();
      this.objects.delete(id);
      this.specs.delete(id);
    }
    for (const spec of specs) {
      this.specs.set(spec.id, spec);
      let object = this.objects.get(spec.id);
      if (object === undefined) {
        const element = document.createElement("div");
        element.className = labelClassName(spec.kind);
        element.textContent = spec.text;
        object = new CSS2DObject(element);
        object.center.set(0.5, 0.5);
        this.objects.set(spec.id, object);
        this.root.add(object);
      } else {
        object.element.className = labelClassName(spec.kind);
        object.element.textContent = spec.text;
      }
      object.position.set(spec.x, spec.y, LABEL_Z);
      object.visible = false;
    }
  }

  update(halfHeight: number, cameraX: number, cameraY: number, halfWidth: number): void {
    const marginX = halfWidth + 8;
    const marginY = halfHeight + 6;
    for (const [id, object] of this.objects) {
      const spec = this.specs.get(id);
      if (spec === undefined) continue;
      if (!labelVisibility(halfHeight, spec.kind)) {
        object.visible = false;
        continue;
      }
      const x = wrapLabelX(spec.x, cameraX);
      object.position.set(x, spec.y, LABEL_Z);
      object.visible = Math.abs(x - cameraX) <= marginX && Math.abs(spec.y - cameraY) <= marginY;
    }
  }

  resize(width: number, height: number): void {
    this.cssRenderer.setSize(width, height);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.disposed) return;
    this.cssRenderer.render(scene, camera);
  }

  dispose(): void {
    this.disposed = true;
    for (const object of this.objects.values()) {
      this.root.remove(object);
      object.element.remove();
    }
    this.objects.clear();
    this.specs.clear();
    this.cssRenderer.domElement.remove();
  }
}

function labelClassName(kind: MapLabelKind): string {
  if (kind === "province") return "map-label map-label-province";
  if (kind === "country-major") return "map-label map-label-country map-label-country-major";
  return "map-label map-label-country";
}
