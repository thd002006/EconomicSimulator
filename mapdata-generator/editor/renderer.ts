import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import earcut from "earcut";

export interface LonLatBBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface BaseProvinceFeature {
  id: string;
  countryId: string;
  name: string;
  nameEn: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  bbox: LonLatBBox;
  capital?: {
    name?: string | undefined;
    coordinates: [number, number];
  } | undefined;
}

export interface BaseBoundary {
  id: string;
  leftProvinceId: string;
  rightProvinceId: string | null;
  coordinates: [number, number][];
}

export interface BaseCoastline {
  id: string;
  coordinates: [number, number][];
}

export interface EditorBaseData {
  provinces: BaseProvinceFeature[];
  boundaries: BaseBoundary[];
  coastlines: BaseCoastline[];
  demographics: Record<string, { pop?: number; gdpPpp?: number }>;
  countries: string[];
  countryNames?: Record<string, { name?: string; nameEn: string }>;
}

export interface ProjectGroup {
  id: string;
  countryId: string;
  members: string[];
  name: string;
  nameEn: string;
}

export interface EditorProject {
  meta: {
    projectId: string;
    baseMapId: string;
    suggestedMapId: string;
    name: string;
    nameEn?: string;
  };
  groups: ProjectGroup[];
}

const MAP_WRAP = 360;
const TILE_OFFSETS = [-MAP_WRAP, 0, MAP_WRAP] as const;
const CLEAR = 0xc8b898;
const OCEAN = 0x9eb5b0;
const COAST = 0x223843;
const PROVINCE_BORDER = 0x6e523e;
const GROUP_BORDER = 0x3d2b1f;
const COUNTRY_BORDER = 0x1a0f08;
const HOVER_FILL = new THREE.Color("#c4a060");
const SELECT_FILL = new THREE.Color("#a07840");

const LAND_Z = 0.02;
const PROV_LINE_Z = 0.04;
const GROUP_LINE_Z = 0.045;
const COUNTRY_LINE_Z = 0.05;

const PROVINCE_BORDER_WIDTH = 0.85;
const PROVINCE_BORDER_OPACITY = 0.32;
const GROUP_BORDER_WIDTH = 1.35;
const GROUP_BORDER_OPACITY = 0.75;
const COUNTRY_BORDER_WIDTH = 1.85;
const COUNTRY_BORDER_OPACITY = 0.92;
const COAST_BORDER_WIDTH = 1.1;
const COAST_BORDER_OPACITY = 0.78;

export function lonLatToMapXY(lon: number, lat: number): [number, number] {
  return [lon, lat];
}

export function computeBBox(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): LonLatBBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const expand = (lon: number, lat: number) => {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  };

  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (const pt of ring) {
        const lon = pt[0]!;
        const lat = pt[1]!;
        expand(lon, lat);
      }
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}

export function pointInPolygon(lon: number, lat: number, rings: number[][][]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(lon, lat, outer)) return false;
  for (const hole of holes) {
    if (pointInRing(lon, lat, hole)) return false;
  }
  return true;
}

export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(lon: number, lat: number, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  if (geometry.type === "Polygon") {
    return pointInPolygon(lon, lat, geometry.coordinates);
  }
  for (const poly of geometry.coordinates) {
    if (pointInPolygon(lon, lat, poly)) return true;
  }
  return false;
}

export class SpatialGridIndex {
  private cellSize = 5;
  private cells = new Map<string, BaseProvinceFeature[]>();

  constructor(features: BaseProvinceFeature[]) {
    for (const f of features) {
      const minX = Math.floor(f.bbox.minLon / this.cellSize);
      const maxX = Math.floor(f.bbox.maxLon / this.cellSize);
      const minY = Math.floor(f.bbox.minLat / this.cellSize);
      const maxY = Math.floor(f.bbox.maxLat / this.cellSize);

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = `${x}:${y}`;
          let list = this.cells.get(key);
          if (!list) {
            list = [];
            this.cells.set(key, list);
          }
          list.push(f);
        }
      }
    }
  }

  hitTest(lon: number, lat: number): BaseProvinceFeature | undefined {
    let wrapLon = lon;
    while (wrapLon > 180) wrapLon -= 360;
    while (wrapLon < -180) wrapLon += 360;

    const x = Math.floor(wrapLon / this.cellSize);
    const y = Math.floor(lat / this.cellSize);
    const list = this.cells.get(`${x}:${y}`) ?? [];

    for (const f of list) {
      if (
        wrapLon >= f.bbox.minLon &&
        wrapLon <= f.bbox.maxLon &&
        lat >= f.bbox.minLat &&
        lat <= f.bbox.maxLat
      ) {
        if (pointInGeometry(wrapLon, lat, f.geometry)) {
          return f;
        }
      }
    }
    return undefined;
  }
}

export function countryFillColor(countryId: string): THREE.Color {
  if (!countryId) return new THREE.Color("#d4cbb8");
  let hash = 0;
  for (let i = 0; i < countryId.length; i++) {
    hash = (hash * 33 + countryId.charCodeAt(i)) >>> 0;
  }
  return new THREE.Color().setHSL(
    (hash % 360) / 360,
    (18 + (hash % 15)) / 100,
    (58 + (hash % 15)) / 100,
    THREE.SRGBColorSpace
  );
}

export function groupColor(groupId: string, countryId: string): THREE.Color {
  const base = countryFillColor(countryId);
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) {
    hash = (hash * 37 + groupId.charCodeAt(i)) >>> 0;
  }
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const hueShift = ((hash % 40) - 20) / 360;
  const satShift = ((hash % 30) - 15) / 100;
  const lumShift = ((hash % 24) - 12) / 100;
  return new THREE.Color().setHSL(
    (hsl.h + hueShift + 1) % 1,
    THREE.MathUtils.clamp(hsl.s + satShift, 0.15, 0.5),
    THREE.MathUtils.clamp(hsl.l + lumShift, 0.45, 0.75),
    THREE.SRGBColorSpace
  );
}

function clipSegmentToWorld(
  lon0: number,
  lat0: number,
  lon1: number,
  lat1: number
): Array<readonly [number, number, number, number]> {
  let x1 = lon1;
  if (x1 - lon0 > 180) x1 -= 360;
  if (lon0 - x1 > 180) x1 += 360;
  const segments: Array<readonly [number, number, number, number]> = [];
  const emitClipped = (a0: number, b0: number, a1: number, b1: number): void => {
    let xStart = a0;
    let yStart = b0;
    let xEnd = a1;
    let yEnd = b1;
    if (xStart > 180 && xEnd > 180) return;
    if (xStart < -180 && xEnd < -180) return;
    if (xStart > 180 || xEnd > 180) {
      const t = (180 - xStart) / (xEnd - xStart);
      if (xStart > 180) {
        yStart = yStart + t * (yEnd - yStart);
        xStart = 180;
      } else {
        yEnd = yStart + t * (yEnd - yStart);
        xEnd = 180;
      }
    }
    if (xStart < -180 || xEnd < -180) {
      const t = (-180 - xStart) / (xEnd - xStart);
      if (xStart < -180) {
        yStart = yStart + t * (yEnd - yStart);
        xStart = -180;
      } else {
        yEnd = yStart + t * (yEnd - yStart);
        xEnd = -180;
      }
    }
    segments.push([xStart, yStart, xEnd, yEnd]);
  };
  emitClipped(lon0, lat0, x1, lat1);
  return segments;
}

function pushLineSegments(target: number[], coordinates: readonly [number, number][], z: number): void {
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1]!;
    const current = coordinates[index]!;
    for (const [x0, y0, x1, y1] of clipSegmentToWorld(
      previous[0],
      previous[1],
      current[0],
      current[1]
    )) {
      target.push(x0, y0, z, x1, y1, z);
    }
  }
}

function makeWideLines(
  positions: number[],
  color: number,
  width: number,
  opacity = 1,
  renderOrder = 0
): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions.length === 0 ? [0, 0, 0, 0, 0, 0] : positions);
  const material = new LineMaterial({
    color,
    linewidth: width,
    worldUnits: false,
    transparent: opacity < 1,
    opacity,
    depthTest: true,
    depthWrite: false
  });
  const lines = new LineSegments2(geometry, material);
  lines.frustumCulled = false;
  lines.visible = positions.length > 0;
  lines.renderOrder = renderOrder;
  return lines;
}

function createLandMaterial(
  palette: THREE.DataTexture,
  highlight: THREE.DataTexture,
  paletteSize: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      palette: { value: palette },
      highlight: { value: highlight },
      paletteSize: { value: paletteSize },
      hoverColor: { value: HOVER_FILL },
      selectedColor: { value: SELECT_FILL },
      paperStrength: { value: 1 }
    },
    vertexShader: `
      attribute float provinceSlot;
      varying float vProvinceSlot;
      varying vec2 vMapPos;
      void main() {
        vProvinceSlot = provinceSlot;
        vMapPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D palette;
      uniform sampler2D highlight;
      uniform float paletteSize;
      uniform vec3 hoverColor;
      uniform vec3 selectedColor;
      uniform float paperStrength;
      varying float vProvinceSlot;
      varying vec2 vMapPos;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      void main() {
        vec2 uv = vec2((vProvinceSlot + 0.5) / paletteSize, 0.5);
        vec3 color = texture2D(palette, uv).rgb;
        float mark = texture2D(highlight, uv).r * 255.0;
        if (abs(mark - 2.0) < 0.5) {
          color = selectedColor;
        } else if (abs(mark - 1.0) < 0.5) {
          color = hoverColor;
        }
        vec3 paper = vec3(0.82, 0.76, 0.65);
        color = mix(color, paper, 0.08 * paperStrength);
        float screenGrain = hash21(gl_FragCoord.xy) * 0.035 - 0.0175;
        float wash = (valueNoise(vMapPos * 0.55) - 0.5) * 0.028;
        float fiber = (valueNoise(vMapPos * vec2(0.35, 4.5)) - 0.5) * 0.016;
        color += (screenGrain + wash + fiber) * paperStrength;
        float vignette = smoothstep(78.0, 95.0, abs(vMapPos.y));
        color *= mix(1.0, 0.94, vignette * paperStrength);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true
  });
}

function createOceanMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      oceanColor: { value: new THREE.Color(OCEAN) },
      inkColor: { value: new THREE.Color("#3a2a1a") }
    },
    vertexShader: `
      varying vec2 vMapPos;
      void main() {
        vMapPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 oceanColor;
      uniform vec3 inkColor;
      varying vec2 vMapPos;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      void main() {
        vec3 color = oceanColor;
        float screenGrain = hash21(gl_FragCoord.xy) * 0.035 - 0.0175;
        float wash = (valueNoise(vMapPos * 0.45) - 0.5) * 0.035;
        color += (screenGrain + wash);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true
  });
}

function triangulateBaseProvinces(provinces: BaseProvinceFeature[]): {
  positions: Float32Array;
  provinceSlots: Uint16Array;
  indices: Uint32Array;
} {
  const positions: number[] = [];
  const slots: number[] = [];
  const indices: number[] = [];

  for (let slot = 0; slot < provinces.length; slot++) {
    const f = provinces[slot]!;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;

    for (const poly of polys) {
      if (poly.length === 0) continue;
      const flatVertices: number[] = [];
      const holeIndices: number[] = [];

      for (let r = 0; r < poly.length; r++) {
        const ring = poly[r]!;
        if (ring.length < 3) continue;
        if (r > 0) holeIndices.push(flatVertices.length / 2);
        for (const pt of ring) {
          const lon = pt[0]!;
          const lat = pt[1]!;
          flatVertices.push(lon, lat);
        }
      }

      if (flatVertices.length < 6) continue;
      const triangles = earcut(flatVertices, holeIndices, 2);
      const vertexOffset = positions.length / 3;

      for (let i = 0; i < flatVertices.length; i += 2) {
        positions.push(flatVertices[i]!, flatVertices[i + 1]!, 0);
        slots.push(slot);
      }
      for (const idx of triangles) {
        indices.push(vertexOffset + idx);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    provinceSlots: new Uint16Array(slots),
    indices: new Uint32Array(indices)
  };
}

export class EditorMapRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private oceanMesh: THREE.Mesh;
  private tileTemplate = new THREE.Group();
  private mapRoot = new THREE.Group();
  private landMesh?: THREE.Mesh;
  private coastLines?: LineSegments2;
  private provinceLines?: LineSegments2;
  private groupLines?: LineSegments2;
  private countryLines?: LineSegments2;

  private paletteTexture?: THREE.DataTexture;
  private paletteBytes?: Uint8Array;
  private highlightTexture?: THREE.DataTexture;
  private highlightBytes?: Uint8Array;
  private slotByProvinceId = new Map<string, number>();

  public baseData?: EditorBaseData | undefined;
  public spatialIndex?: SpatialGridIndex | undefined;
  public project?: EditorProject | undefined;
  public selectedGroupIds = new Set<string>();
  public hoveredProvinceId?: string | undefined;

  public halfHeight = 65;
  private dragging = false;
  private prevMouse = new THREE.Vector3();
  private nextMouse = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setClearColor(CLEAR, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.OrthographicCamera(-180, 180, 90, -90, 0.1, 100);
    this.camera.position.set(10, 20, 10);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(10, 20, 0);

    const oceanGeometry = new THREE.PlaneGeometry(MAP_WRAP * 3, 180, 1, 1);
    this.oceanMesh = new THREE.Mesh(oceanGeometry, createOceanMaterial());
    this.oceanMesh.position.set(0, 0, 0);
    this.scene.add(this.oceanMesh);
    this.scene.add(this.mapRoot);

    this.setupEvents();
    this.resize();
  }

  public setBaseData(baseData: EditorBaseData): void {
    this.baseData = baseData;
    this.spatialIndex = new SpatialGridIndex(baseData.provinces);
    this.slotByProvinceId.clear();
    baseData.provinces.forEach((f, slot) => this.slotByProvinceId.set(f.id, slot));

    this.buildMeshes();
    this.rebuildPalette();
    this.rebuildBoundaries();
    this.rebuildHighlight();
    this.render();
  }

  public setProject(project: EditorProject): void {
    this.project = project;
    this.rebuildPalette();
    this.rebuildBoundaries();
    this.rebuildHighlight();
    this.render();
  }

  private buildMeshes(): void {
    if (!this.baseData) return;
    this.tileTemplate.clear();

    const meshData = triangulateBaseProvinces(this.baseData.provinces);
    const count = this.baseData.provinces.length;

    this.paletteBytes = new Uint8Array(count * 4);
    this.paletteTexture = new THREE.DataTexture(this.paletteBytes, count, 1, THREE.RGBAFormat);
    this.paletteTexture.magFilter = THREE.NearestFilter;
    this.paletteTexture.minFilter = THREE.NearestFilter;

    this.highlightBytes = new Uint8Array(count * 4);
    this.highlightTexture = new THREE.DataTexture(this.highlightBytes, count, 1, THREE.RGBAFormat);
    this.highlightTexture.magFilter = THREE.NearestFilter;
    this.highlightTexture.minFilter = THREE.NearestFilter;

    const landMaterial = createLandMaterial(this.paletteTexture, this.highlightTexture, count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(meshData.positions, 3));
    geometry.setAttribute("provinceSlot", new THREE.BufferAttribute(meshData.provinceSlots, 1));
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geometry.computeBoundingBox();

    this.landMesh = new THREE.Mesh(geometry, landMaterial);
    this.landMesh.position.z = LAND_Z;
    this.tileTemplate.add(this.landMesh);

    const coastPos: number[] = [];
    for (const coast of this.baseData.coastlines) {
      pushLineSegments(coastPos, coast.coordinates, COUNTRY_LINE_Z);
    }
    this.coastLines = makeWideLines(coastPos, COAST, COAST_BORDER_WIDTH, COAST_BORDER_OPACITY);
    this.provinceLines = makeWideLines(
      [],
      PROVINCE_BORDER,
      PROVINCE_BORDER_WIDTH,
      PROVINCE_BORDER_OPACITY,
      1
    );
    this.groupLines = makeWideLines([], GROUP_BORDER, GROUP_BORDER_WIDTH, GROUP_BORDER_OPACITY, 2);
    this.countryLines = makeWideLines(
      [],
      COUNTRY_BORDER,
      COUNTRY_BORDER_WIDTH,
      COUNTRY_BORDER_OPACITY,
      3
    );

    this.tileTemplate.add(
      this.coastLines,
      this.provinceLines,
      this.groupLines,
      this.countryLines
    );

    this.mapRoot.clear();
    for (const offset of TILE_OFFSETS) {
      const tile = this.tileTemplate.clone(true);
      tile.position.x = offset;
      this.mapRoot.add(tile);
    }
    this.applyLineResolutions();
  }

  public rebuildPalette(): void {
    if (!this.baseData || !this.paletteBytes || !this.paletteTexture) return;
    const memberToGroup = new Map<string, ProjectGroup>();
    if (this.project) {
      for (const g of this.project.groups) {
        for (const m of g.members) {
          memberToGroup.set(m, g);
        }
      }
    }

    for (let slot = 0; slot < this.baseData.provinces.length; slot++) {
      const p = this.baseData.provinces[slot]!;
      const group = memberToGroup.get(p.id);
      const color = group
        ? groupColor(group.id, group.countryId)
        : countryFillColor(p.countryId);

      this.paletteBytes[slot * 4] = Math.round(color.r * 255);
      this.paletteBytes[slot * 4 + 1] = Math.round(color.g * 255);
      this.paletteBytes[slot * 4 + 2] = Math.round(color.b * 255);
      this.paletteBytes[slot * 4 + 3] = 255;
    }
    this.paletteTexture.needsUpdate = true;
  }

  public rebuildBoundaries(): void {
    if (!this.baseData) return;
    const provToCountry = new Map<string, string>();
    for (const p of this.baseData.provinces) {
      provToCountry.set(p.id, p.countryId);
    }

    const memberToGroup = new Map<string, string>();
    if (this.project) {
      for (const g of this.project.groups) {
        for (const m of g.members) {
          memberToGroup.set(m, g.id);
        }
      }
    }

    const provPos: number[] = [];
    const groupPos: number[] = [];
    const countryPos: number[] = [];

    for (const b of this.baseData.boundaries) {
      const leftCountry = provToCountry.get(b.leftProvinceId) ?? "";
      const rightCountry = b.rightProvinceId ? provToCountry.get(b.rightProvinceId) ?? "" : "";
      const isCountryBorder = b.rightProvinceId === null || leftCountry !== rightCountry;

      if (isCountryBorder) {
        // 国界（最粗、最深、顶层）
        pushLineSegments(countryPos, b.coordinates, COUNTRY_LINE_Z);
      } else {
        const leftG = memberToGroup.get(b.leftProvinceId) ?? b.leftProvinceId;
        const rightG = b.rightProvinceId ? memberToGroup.get(b.rightProvinceId) ?? b.rightProvinceId : null;
        const isGroupBorder = rightG !== null && leftG !== rightG;

        if (isGroupBorder) {
          // 组界（中等粗细，比国界细，比省界明显）
          pushLineSegments(groupPos, b.coordinates, GROUP_LINE_Z);
        } else {
          // 省界（最细、淡雅细线）
          pushLineSegments(provPos, b.coordinates, PROV_LINE_Z);
        }
      }
    }

    if (this.provinceLines) {
      this.tileTemplate.remove(this.provinceLines);
      this.provinceLines.geometry.dispose();
      this.provinceLines.material.dispose();
    }
    if (this.groupLines) {
      this.tileTemplate.remove(this.groupLines);
      this.groupLines.geometry.dispose();
      this.groupLines.material.dispose();
    }
    if (this.countryLines) {
      this.tileTemplate.remove(this.countryLines);
      this.countryLines.geometry.dispose();
      this.countryLines.material.dispose();
    }

    this.provinceLines = makeWideLines(
      provPos,
      PROVINCE_BORDER,
      PROVINCE_BORDER_WIDTH,
      PROVINCE_BORDER_OPACITY,
      1
    );
    this.groupLines = makeWideLines(
      groupPos,
      GROUP_BORDER,
      GROUP_BORDER_WIDTH,
      GROUP_BORDER_OPACITY,
      2
    );
    this.countryLines = makeWideLines(
      countryPos,
      COUNTRY_BORDER,
      COUNTRY_BORDER_WIDTH,
      COUNTRY_BORDER_OPACITY,
      3
    );
    this.tileTemplate.add(this.provinceLines, this.groupLines, this.countryLines);

    this.mapRoot.clear();
    for (const offset of TILE_OFFSETS) {
      const tile = this.tileTemplate.clone(true);
      tile.position.x = offset;
      this.mapRoot.add(tile);
    }
    this.applyLineResolutions();
  }

  public rebuildHighlight(): void {
    if (!this.highlightBytes || !this.highlightTexture || !this.baseData) return;
    this.highlightBytes.fill(0);

    const memberToGroup = new Map<string, string>();
    if (this.project) {
      for (const g of this.project.groups) {
        for (const m of g.members) {
          memberToGroup.set(m, g.id);
        }
      }
    }

    if (this.hoveredProvinceId) {
      const slot = this.slotByProvinceId.get(this.hoveredProvinceId);
      if (slot !== undefined) this.highlightBytes[slot * 4] = 1;
    }

    for (const gid of this.selectedGroupIds) {
      const group = this.project?.groups.find((g) => g.id === gid);
      if (group) {
        for (const m of group.members) {
          const slot = this.slotByProvinceId.get(m);
          if (slot !== undefined) this.highlightBytes[slot * 4] = 2;
        }
      }
    }

    this.highlightTexture.needsUpdate = true;
  }

  public focusBBox(bbox: LonLatBBox): void {
    const lon = (bbox.minLon + bbox.maxLon) / 2;
    const lat = (bbox.minLat + bbox.maxLat) / 2;
    const latSpan = Math.max(8, (bbox.maxLat - bbox.minLat) * 0.8);
    const lonSpan = Math.max(8, (bbox.maxLon - bbox.minLon) * 0.5);
    const halfH = THREE.MathUtils.clamp(Math.max(latSpan, lonSpan), 6, 80);

    this.camera.position.x = lon;
    this.camera.position.y = THREE.MathUtils.clamp(lat, -90 + halfH, 90 - halfH);
    this.halfHeight = halfH;
    this.applyView();
    this.render();
  }

  public resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.applyView();
    this.applyLineResolutions();
    this.render();
  }

  private applyLineResolutions(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const res = new THREE.Vector2(width, height);
    for (const lines of [this.coastLines, this.provinceLines, this.groupLines, this.countryLines]) {
      if (lines?.material && lines.material instanceof LineMaterial) {
        lines.material.resolution.copy(res);
      }
    }
    this.mapRoot.traverse((obj) => {
      if (obj instanceof LineSegments2 && obj.material instanceof LineMaterial) {
        obj.material.resolution.copy(res);
      }
    });
  }

  private applyView(): void {
    let wrapX = this.camera.position.x;
    while (wrapX > 180) wrapX -= 360;
    while (wrapX < -180) wrapX += 360;
    this.camera.position.x = wrapX;

    const limitY = Math.max(0, 90 - this.halfHeight);
    this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, -limitY, limitY);

    const aspect = Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
    const halfW = this.halfHeight * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = this.halfHeight;
    this.camera.bottom = -this.halfHeight;
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0);
    this.camera.updateProjectionMatrix();
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public screenToLonLat(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);

    const aspect = rect.width / rect.height;
    const halfW = this.halfHeight * aspect;
    const worldX = this.camera.position.x + x * halfW;
    const worldY = this.camera.position.y + y * this.halfHeight;

    let lon = worldX;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return [lon, worldY];
  }

  private setupEvents(): void {
    let pointerMoved = false;

    this.canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      pointerMoved = false;
      this.prevMouse.set(e.clientX, e.clientY, 0);
    });

    window.addEventListener("pointermove", (e) => {
      if (this.dragging) {
        const dx = e.clientX - this.prevMouse.x;
        const dy = e.clientY - this.prevMouse.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pointerMoved = true;

        const rect = this.canvas.getBoundingClientRect();
        const aspect = rect.width / rect.height;
        const halfW = this.halfHeight * aspect;
        const deltaX = (dx / rect.width) * halfW * 2;
        const deltaY = (dy / rect.height) * this.halfHeight * 2;

        this.camera.position.x -= deltaX;
        this.camera.position.y += deltaY;
        this.prevMouse.set(e.clientX, e.clientY, 0);
        this.applyView();
        this.render();
      }
    });

    window.addEventListener("pointerup", () => {
      this.dragging = false;
    });

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 0.87;
      this.halfHeight = THREE.MathUtils.clamp(this.halfHeight * factor, 4, 85);
      this.applyView();
      this.render();
    }, { passive: false });

    window.addEventListener("resize", () => this.resize());
  }
}
