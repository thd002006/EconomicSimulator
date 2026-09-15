import {
  lonLatToMapXY,
  mapXYToLonLat,
  wrapLongitude,
  buildRoadDrawBatches,
  buildRoadRibbonMesh,
  ROAD_STYLE_MAP_SCALE,
  roadTypesSortedByDrawOrder,
  type CountryAggregate,
  type GeoJsonGeometry,
  type LonLat,
  type MapBoundary,
  type MapFeature,
  type MapViewModel,
  type ProvinceFeature
} from "@economic-simulator/map-runtime";
import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import {
  INITIAL_HALF_HEIGHT,
  INITIAL_LAT,
  INITIAL_LON,
  MAP_WRAP,
  MapPanZoomController
} from "./map-controls.js";
import { buildCountryLabelAnchors, buildProvinceLabels, MapLabelLayer } from "./map-labels.js";
import type { MapSelection } from "../ui/selection.js";

const CLEAR = 0xc8b898;
const OCEAN = 0x9eb5b0;
const COAST = 0x3a2a1a;
const PROVINCE_BORDER = 0x5a4030;
const DISPUTED_BORDER = 0x8a3a1a;
const DISPUTED_BORDER_WIDTH = 1.6;
const DISPUTED_BORDER_OPACITY = 0.72;
/** Short dash + gap so disputed borders read as a bead chain, not long dashes. */
const DISPUTED_BORDER_DASH = 0.07;
const DISPUTED_BORDER_GAP = 0.11;
/** How far to bleach disputed fills toward white (1 = pure white). */
const DISPUTED_FILL_BLEACH = 0.5;
const COUNTRY_BORDER = 0x2a1c12;
const CAPITAL_DARK_RED = 0x7a1f1f;
const HOVER_FILL = new THREE.Color("#c4a060");
const SELECT_FILL = new THREE.Color("#a07840");
const LAND_Z = 0.02;
const LINE_Z = 0.04;
const ROAD_Z = 0.045;
const CAPITAL_Z = 0.06;
// World-unit radii (same space as roads: mapXY degrees, via ROAD_STYLE_MAP_SCALE)
// Halved from 0.18/0.14/0.05/0.065. White disc is now INSIDE the dark-red ring
// (no white halo beyond the outer ring) — white touches ring inner edge.
const CAPITAL_WHITE_RADIUS = 0.06;
const CAPITAL_RING_RADIUS = 0.075;
const CAPITAL_RING_WIDTH = 0.028;
const CAPITAL_DOT_RADIUS = 0.032;
const MAX_DRAWING_PIXELS = 3840 * 2160;
const PROVINCE_DETAIL_HALF_HEIGHT = 32;
const TILE_OFFSETS = [-MAP_WRAP, 0, MAP_WRAP] as const;
const PROVINCE_BORDER_WIDTH = 1.35;
const PROVINCE_BORDER_OPACITY = 0.38;
const COUNTRY_BORDER_WIDTH = 1.5;
const COUNTRY_BORDER_OPACITY = 0.82;
const COAST_BORDER_WIDTH = 1.1;
const COAST_BORDER_OPACITY = 0.78;
const ROAD_RENDER_ORDER = 2;
const COUNTRY_RENDER_ORDER = 3;
const CAPITAL_RENDER_ORDER = 4;

export interface MapLayerVisibility {
  readonly labels: boolean;
  readonly capitals: boolean;
  readonly roads: boolean;
  readonly countryBorders: boolean;
  readonly provinceBorders: boolean;
}

export const DEFAULT_MAP_LAYER_VISIBILITY: MapLayerVisibility = {
  labels: true,
  capitals: true,
  roads: true,
  countryBorders: true,
  provinceBorders: true
};

export interface GlobeRuntimeModel extends MapViewModel {
  hitTest(lon: number, lat: number): ProvinceFeature | undefined;
  findProvince(id: string): ProvinceFeature | undefined;
  getProvinceOwner(provinceId: string): string | undefined;
  getCountryName(ownerId: string): string | undefined;
  getCountryAggregate(ownerId: string): CountryAggregate | undefined;
}

export function showProvinceBorders(halfHeight: number): boolean {
  return halfHeight <= PROVINCE_DETAIL_HALF_HEIGHT;
}

function createCapitalInstancedMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  positions: Array<readonly [number, number, number]>
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = CAPITAL_RENDER_ORDER;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < positions.length; index += 1) {
    const pos = positions[index]!;
    dummy.position.set(pos[0], pos[1], pos[2]);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function countryFill(adm0A3: string | undefined): THREE.Color {
  if (adm0A3 === undefined || adm0A3.length === 0) return new THREE.Color("#d4cbb8");
  let hash = 0;
  for (let index = 0; index < adm0A3.length; index += 1) {
    hash = (hash * 33 + adm0A3.charCodeAt(index)) >>> 0;
  }
  return new THREE.Color().setHSL(
    (hash % 360) / 360,
    (18 + (hash % 15)) / 100,
    (58 + (hash % 15)) / 100,
    THREE.SRGBColorSpace
  );
}

function disputedFill(base: THREE.Color): THREE.Color {
  return base.clone().lerp(new THREE.Color("#ffffff"), DISPUTED_FILL_BLEACH);
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

function pushLineSegments(target: number[], coordinates: readonly LonLat[], z: number): void {
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

function addGeometryLines(target: number[], geometry: GeoJsonGeometry, z: number): void {
  if (geometry.type === "LineString") {
    pushLineSegments(target, geometry.coordinates, z);
  } else if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) pushLineSegments(target, line, z);
  }
}

function makeWideLines(
  positions: number[],
  color: number,
  width: number,
  opacity = 1,
  renderOrder = 0,
  dash?: { dashSize: number; gapSize: number }
): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions.length === 0 ? [0, 0, 0, 0, 0, 0] : positions);
  const translucent = opacity < 1;
  const material = new LineMaterial({
    color,
    linewidth: width,
    worldUnits: false,
    transparent: translucent,
    opacity,
    // A2C + low opacity becomes a screen-door stipple that reads as dotted ink.
    alphaToCoverage: !translucent,
    depthTest: true,
    depthWrite: false,
    ...(dash === undefined
      ? {}
      : { dashed: true, dashSize: dash.dashSize, gapSize: dash.gapSize })
  });
  const lines = new LineSegments2(geometry, material);
  if (dash !== undefined) lines.computeLineDistances();
  lines.frustumCulled = false;
  lines.visible = positions.length > 0;
  lines.renderOrder = renderOrder;
  return lines;
}

function disposeWideLines(lines: LineSegments2): void {
  lines.geometry.dispose();
  const material = lines.material;
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}

function makeRoadMesh(
  polylines: readonly (readonly LonLat[])[],
  width: number,
  color: number,
  opacity: number,
  z: number,
  dashSize?: number,
  gapSize?: number
): THREE.Mesh {
  const meshData = buildRoadRibbonMesh(polylines, {
    width,
    ...(dashSize === undefined ? {} : { dashSize }),
    ...(gapSize === undefined ? {} : { gapSize })
  });
  const positions = new Float32Array(meshData.vertices.length * 3);
  for (const [index, [x, y]] of meshData.vertices.entries()) {
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([...meshData.indices]);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthTest: true,
      depthWrite: false
    })
  );
  mesh.frustumCulled = false;
  mesh.visible = meshData.indices.length > 0;
  mesh.renderOrder = ROAD_RENDER_ORDER;
  return mesh;
}

function disposeRoadMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
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

      // Continuous value noise so zoom never reveals blocky floor() cells.
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
        // Screen-space grain stays ~1px at every zoom; soft map-space wash avoids mosaics.
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
        float grain = hash21(gl_FragCoord.xy) * 0.028 - 0.014;
        float wash = (valueNoise(vMapPos * 0.4) - 0.5) * 0.02;
        color += grain + wash;
        float gx = abs(fract(vMapPos.x / 15.0) - 0.5);
        float gy = abs(fract(vMapPos.y / 15.0) - 0.5);
        float line = 1.0 - smoothstep(0.0, 0.018, min(gx, gy));
        color = mix(color, inkColor, line * 0.06);
        float edgeWash = smoothstep(70.0, 88.0, abs(vMapPos.y)) * 0.06;
        color = mix(color, vec3(0.8, 0.74, 0.62), edgeWash);
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

export class GlobeRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly mapRoot = new THREE.Group();
  private readonly tileTemplate = new THREE.Group();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly panZoom: MapPanZoomController;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pickPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly pickPoint = new THREE.Vector3();
  private readonly paletteBytes: Uint8Array;
  private readonly palette: THREE.DataTexture;
  private readonly highlightBytes: Uint8Array;
  private readonly highlight: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly oceanMaterial: THREE.ShaderMaterial;
  private readonly landMesh: THREE.Mesh;
  private readonly slotByProvinceId = new Map<string, number>();
  private readonly capitalGroup: THREE.Group;
  private readonly capitalWhiteMesh: THREE.InstancedMesh;
  private readonly capitalRingMesh: THREE.InstancedMesh;
  private readonly capitalDotMesh: THREE.InstancedMesh;
  private readonly ocean: THREE.Mesh;
  private readonly labels: MapLabelLayer;
  private coastLines: LineSegments2;
  private provinceLines: LineSegments2;
  private disputedProvinceLines: LineSegments2;
  private countryLines: LineSegments2;
  private readonly roadMeshEntries: Array<{
    typeId: string;
    maxVisibleHalfHeight: number;
    mesh: THREE.Mesh;
  }> = [];
  private provinceLineHasGeometry = false;
  private disputedProvinceLineHasGeometry = false;
  private ownerLookup: (provinceId: string) => string | undefined;
  private hoveredSelection: MapSelection | undefined;
  private selectedSelection: MapSelection | undefined;
  private readonly lineResolution = new THREE.Vector2();
  private layerVisibility: MapLayerVisibility = DEFAULT_MAP_LAYER_VISIBILITY;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly model: GlobeRuntimeModel,
    ownerLookup: (provinceId: string) => string | undefined,
    private readonly requestRender: () => void
  ) {
    this.ownerLookup = ownerLookup;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(CLEAR, 1);

    this.panZoom = new MapPanZoomController(
      this.camera,
      canvas,
      INITIAL_LON,
      INITIAL_LAT,
      INITIAL_HALF_HEIGHT
    );

    const labelHost = canvas.parentElement ?? canvas;
    this.labels = new MapLabelLayer(labelHost);
    this.scene.add(this.labels.sceneRoot);

    this.oceanMaterial = createOceanMaterial();
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(MAP_WRAP * 3, 180), this.oceanMaterial);
    this.ocean.position.z = -0.05;
    this.scene.add(this.ocean);
    this.scene.add(this.mapRoot);

    this.paletteBytes = new Uint8Array(model.globeMesh.provinceIds.length * 4);
    this.palette = new THREE.DataTexture(
      this.paletteBytes,
      model.globeMesh.provinceIds.length,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.palette.magFilter = THREE.NearestFilter;
    this.palette.minFilter = THREE.NearestFilter;
    this.palette.generateMipmaps = false;
    this.highlightBytes = new Uint8Array(model.globeMesh.provinceIds.length * 4);
    this.highlight = new THREE.DataTexture(
      this.highlightBytes,
      model.globeMesh.provinceIds.length,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.highlight.magFilter = THREE.NearestFilter;
    this.highlight.minFilter = THREE.NearestFilter;
    this.highlight.generateMipmaps = false;
    model.globeMesh.provinceIds.forEach((id, slot) => this.slotByProvinceId.set(id, slot));
    this.material = createLandMaterial(
      this.palette,
      this.highlight,
      model.globeMesh.provinceIds.length
    );
    this.rebuildPalette();

    const authoredLod = model.globeMesh.lods.at(-1);
    if (authoredLod === undefined)
      throw new Error("Map pack is missing the source-resolution mesh.");
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(authoredLod.positions, 3));
    geometry.setAttribute("provinceSlot", new THREE.BufferAttribute(authoredLod.provinceSlots, 1));
    const normals = new Float32Array(authoredLod.positions.length);
    for (let index = 2; index < normals.length; index += 3) normals[index] = 1;
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(authoredLod.indices, 1));
    geometry.computeBoundingBox();
    this.landMesh = new THREE.Mesh(geometry, this.material);
    this.landMesh.position.z = LAND_Z;
    this.tileTemplate.add(this.landMesh);

    const coastPositions: number[] = [];
    for (const feature of model.coastlines) {
      addGeometryLines(coastPositions, feature.geometry, LINE_Z);
    }
    this.coastLines = makeWideLines(
      coastPositions,
      COAST,
      COAST_BORDER_WIDTH,
      COAST_BORDER_OPACITY
    );
    this.provinceLines = makeWideLines(
      [],
      PROVINCE_BORDER,
      PROVINCE_BORDER_WIDTH,
      PROVINCE_BORDER_OPACITY,
      1
    );
    this.disputedProvinceLines = makeWideLines(
      [],
      PROVINCE_BORDER,
      PROVINCE_BORDER_WIDTH * 1.5,
      PROVINCE_BORDER_OPACITY,
      1
    );
    this.countryLines = makeWideLines(
      [],
      COUNTRY_BORDER,
      COUNTRY_BORDER_WIDTH,
      COUNTRY_BORDER_OPACITY,
      COUNTRY_RENDER_ORDER
    );
    this.tileTemplate.add(this.coastLines, this.provinceLines, this.disputedProvinceLines, this.countryLines);
    this.rebuildBoundaries();
    this.buildRoadMeshes();

    // Capitals in world units (same space as roads) — simple dark-red target: white base + dark-red ring + dark-red dot
    const capitalXY: Array<readonly [number, number, number]> = model.provinces.map((feature) => {
      const [x, y] = lonLatToMapXY(
        feature.properties.capital.coordinates[0],
        feature.properties.capital.coordinates[1]
      );
      return [x, y, CAPITAL_Z] as const;
    });
    const whiteGeometry = new THREE.CircleGeometry(CAPITAL_WHITE_RADIUS, 32);
    const ringGeometry = new THREE.RingGeometry(
      CAPITAL_RING_RADIUS - CAPITAL_RING_WIDTH / 2,
      CAPITAL_RING_RADIUS + CAPITAL_RING_WIDTH / 2,
      32
    );
    const dotGeometry = new THREE.CircleGeometry(CAPITAL_DOT_RADIUS, 32);
    const whiteMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: CAPITAL_DARK_RED,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    const dotMaterial = new THREE.MeshBasicMaterial({
      color: CAPITAL_DARK_RED,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    // Slight z offsets inside group avoid z-fighting while staying at CAPITAL_Z
    const whitePositions = capitalXY;
    const ringPositions: Array<readonly [number, number, number]> = capitalXY.map(
      ([x, y]) => [x, y, CAPITAL_Z + 0.0005] as const
    );
    const dotPositions: Array<readonly [number, number, number]> = capitalXY.map(
      ([x, y]) => [x, y, CAPITAL_Z + 0.001] as const
    );
    this.capitalWhiteMesh = createCapitalInstancedMesh(whiteGeometry, whiteMaterial, whitePositions);
    this.capitalRingMesh = createCapitalInstancedMesh(ringGeometry, ringMaterial, ringPositions);
    this.capitalDotMesh = createCapitalInstancedMesh(dotGeometry, dotMaterial, dotPositions);
    this.capitalGroup = new THREE.Group();
    this.capitalGroup.add(this.capitalWhiteMesh, this.capitalRingMesh, this.capitalDotMesh);
    this.capitalGroup.renderOrder = CAPITAL_RENDER_ORDER;
    // Tag for clone traversal
    this.capitalGroup.userData.isCapitalGroup = true;
    this.capitalWhiteMesh.userData.isCapitalMember = true;
    this.capitalRingMesh.userData.isCapitalMember = true;
    this.capitalDotMesh.userData.isCapitalMember = true;
    this.tileTemplate.add(this.capitalGroup);
    this.refreshTiles();
    this.rebuildLabels();
    this.updateDetailVisibility();
    this.resize();
  }

  private buildRoadMeshes(): void {
    const batches = buildRoadDrawBatches(this.model.roads.segments, {
      pairRoutes: this.model.roads.pairRoutes
    });
    const batchByType = new Map(batches.map((batch) => [batch.typeId, batch]));

    for (const typeDef of roadTypesSortedByDrawOrder()) {
      const batch = batchByType.get(typeDef.id);
      const polylines = batch?.polylines ?? [];

      if (typeDef.casingColor !== undefined && typeDef.casingWidth !== undefined) {
        const casing = makeRoadMesh(
          polylines,
          typeDef.casingWidth * ROAD_STYLE_MAP_SCALE,
          typeDef.casingColor,
          Math.min(1, typeDef.strokeOpacity + 0.1),
          ROAD_Z
        );
        casing.userData.hasRoadGeometry = polylines.length > 0;
        this.roadMeshEntries.push({
          typeId: typeDef.id,
          maxVisibleHalfHeight: typeDef.maxVisibleHalfHeight,
          mesh: casing
        });
        this.tileTemplate.add(casing);
      }

      const stroke = makeRoadMesh(
        polylines,
        typeDef.lineWidth * ROAD_STYLE_MAP_SCALE,
        typeDef.strokeColor,
        typeDef.strokeOpacity,
        ROAD_Z + 0.0005,
        typeDef.dashSize === undefined ? undefined : typeDef.dashSize * ROAD_STYLE_MAP_SCALE,
        typeDef.gapSize === undefined ? undefined : typeDef.gapSize * ROAD_STYLE_MAP_SCALE
      );
      stroke.userData.hasRoadGeometry = polylines.length > 0;
      this.roadMeshEntries.push({
        typeId: typeDef.id,
        maxVisibleHalfHeight: typeDef.maxVisibleHalfHeight,
        mesh: stroke
      });
      this.tileTemplate.add(stroke);
    }
  }

  private refreshTiles(): void {
    this.mapRoot.clear();
    for (const offset of TILE_OFFSETS) {
      const tile = this.tileTemplate.clone(true);
      tile.position.x = offset;
      this.mapRoot.add(tile);
    }
  }

  private updateDetailVisibility(): void {
    const halfHeight = this.panZoom.halfHeight;
    const showProvinces =
      this.layerVisibility.provinceBorders &&
      this.provinceLineHasGeometry &&
      showProvinceBorders(halfHeight);
    const showDisputedProvinces =
      this.layerVisibility.provinceBorders &&
      this.disputedProvinceLineHasGeometry &&
      showProvinceBorders(halfHeight);
    const showCapitals = this.layerVisibility.capitals && showProvinceBorders(halfHeight);
    this.provinceLines.visible = showProvinces;
    this.disputedProvinceLines.visible = showDisputedProvinces;
    this.countryLines.visible = this.layerVisibility.countryBorders;
    this.capitalGroup.visible = showCapitals;
    this.labels.setVisible(this.layerVisibility.labels);

    const roadVisibility = new Map<THREE.Material, boolean>();
    for (const entry of this.roadMeshEntries) {
      const material = entry.mesh.material;
      if (!Array.isArray(material)) {
        roadVisibility.set(
          material,
          this.layerVisibility.roads &&
            entry.mesh.userData.hasRoadGeometry === true &&
            halfHeight <= entry.maxVisibleHalfHeight
        );
      }
    }

    this.mapRoot.traverse((object) => {
      if (object === this.provinceLines || object === this.capitalGroup) return;
      if (object instanceof LineSegments2 && object.material === this.provinceLines.material) {
        object.visible = showProvinces;
        return;
      }
      if (object instanceof LineSegments2 && object.material === this.disputedProvinceLines.material) {
        object.visible = showDisputedProvinces;
        return;
      }
      if (object.userData.isCapitalGroup === true || object.userData.isCapitalMember === true) {
        object.visible = showCapitals;
        return;
      }
      if (object instanceof LineSegments2 && object.material === this.countryLines.material) {
        object.visible = this.layerVisibility.countryBorders;
        return;
      }
      if (object instanceof THREE.Mesh) {
        const material = object.material;
        if (!Array.isArray(material)) {
          const showRoad = roadVisibility.get(material);
          if (showRoad !== undefined) {
            object.visible = showRoad;
          }
        }
      }
    });
    this.updateLabels();
  }

  setLayerVisibility(visibility: MapLayerVisibility): void {
    this.layerVisibility = visibility;
    this.updateDetailVisibility();
    this.requestRender();
  }

  private rebuildLabels(): void {
    const countryLabels = buildCountryLabelAnchors(
      this.model.provinces,
      this.ownerLookup,
      this.model.countries
    );
    const provinceLabels = buildProvinceLabels(this.model.provinces);
    this.labels.setLabels([...countryLabels, ...provinceLabels]);
    this.updateLabels();
  }

  private updateLabels(): void {
    const halfWidth = (this.camera.right - this.camera.left) / 2;
    this.labels.update(
      this.panZoom.halfHeight,
      this.camera.position.x,
      this.camera.position.y,
      halfWidth
    );
  }

  private rebuildPalette(changedProvinceIds?: readonly string[]): void {
    const ids = changedProvinceIds ?? this.model.globeMesh.provinceIds;
    for (const id of ids) {
      const slot = this.slotByProvinceId.get(id);
      if (slot === undefined) continue;
      const feature = this.model.findProvince(id);
      const fill = this.model.hooks.getProvinceFill?.(id);
      let color =
        fill === undefined
          ? countryFill(this.ownerLookup(id) ?? feature?.properties.adm0A3)
          : new THREE.Color(fill);
      if (feature?.properties.disputed !== undefined) {
        color = disputedFill(color);
      }
      this.paletteBytes[slot * 4] = Math.round(color.r * 255);
      this.paletteBytes[slot * 4 + 1] = Math.round(color.g * 255);
      this.paletteBytes[slot * 4 + 2] = Math.round(color.b * 255);
      this.paletteBytes[slot * 4 + 3] = 255;
    }
    this.palette.needsUpdate = true;
  }

  private rebuildBoundaries(): void {
    const provincePositions: number[] = [];
    const disputedProvincePositions: number[] = [];
    const countryPositions: number[] = [];
    for (const boundary of this.model.boundaries) {
      const leftOwner = this.ownerLookup(boundary.leftProvinceId);
      const rightOwner =
        boundary.rightProvinceId === null ? undefined : this.ownerLookup(boundary.rightProvinceId);
      const isCountry =
        boundary.rightProvinceId === null ||
        leftOwner === undefined ||
        rightOwner === undefined ||
        leftOwner !== rightOwner;
      const leftFeature = this.model.findProvince(boundary.leftProvinceId);
      const rightFeature =
        boundary.rightProvinceId === null
          ? undefined
          : this.model.findProvince(boundary.rightProvinceId);
      const isDisputed =
        leftFeature?.properties.disputed !== undefined ||
        rightFeature?.properties.disputed !== undefined;
      if (isCountry) {
        pushLineSegments(countryPositions, boundary.coordinates, LINE_Z);
      } else if (isDisputed) {
        pushLineSegments(disputedProvincePositions, boundary.coordinates, LINE_Z);
      } else {
        pushLineSegments(provincePositions, boundary.coordinates, LINE_Z);
      }
    }
    this.tileTemplate.remove(this.provinceLines, this.disputedProvinceLines, this.countryLines);
    disposeWideLines(this.provinceLines);
    disposeWideLines(this.disputedProvinceLines);
    disposeWideLines(this.countryLines);
    this.provinceLines = makeWideLines(
      provincePositions,
      PROVINCE_BORDER,
      PROVINCE_BORDER_WIDTH,
      PROVINCE_BORDER_OPACITY,
      1
    );
    this.disputedProvinceLines = makeWideLines(
      disputedProvincePositions,
      DISPUTED_BORDER,
      DISPUTED_BORDER_WIDTH,
      DISPUTED_BORDER_OPACITY,
      1,
      { dashSize: DISPUTED_BORDER_DASH, gapSize: DISPUTED_BORDER_GAP }
    );
    this.countryLines = makeWideLines(
      countryPositions,
      COUNTRY_BORDER,
      COUNTRY_BORDER_WIDTH,
      COUNTRY_BORDER_OPACITY,
      COUNTRY_RENDER_ORDER
    );
    this.provinceLineHasGeometry = provincePositions.length > 0;
    this.disputedProvinceLineHasGeometry = disputedProvincePositions.length > 0;
    this.applyLineResolutions();
    this.tileTemplate.add(this.provinceLines, this.disputedProvinceLines, this.countryLines);
    this.refreshTiles();
  }


  private applyLineResolutions(): void {
    this.renderer.getDrawingBufferSize(this.lineResolution);
    const width = Math.max(1, Math.floor(this.lineResolution.x));
    const height = Math.max(1, Math.floor(this.lineResolution.y));
    const allLines = [
      this.coastLines,
      this.provinceLines,
      this.disputedProvinceLines,
      this.countryLines
    ];
    for (const lines of allLines) {
      const material = lines.material;
      if (!Array.isArray(material) && material instanceof LineMaterial) {
        material.resolution.set(width, height);
      }
    }
  }

  updateOwners(
    ownerLookup: (provinceId: string) => string | undefined,
    changedProvinceIds?: readonly string[]
  ): void {
    this.ownerLookup = ownerLookup;
    this.rebuildPalette(changedProvinceIds);
    this.rebuildBoundaries();
    this.rebuildLabels();
    this.rebuildHighlight();
    this.updateDetailVisibility();
    this.requestRender();
  }

  private applyMark(selection: MapSelection | undefined, value: number): void {
    if (selection === undefined) return;
    const write = (slot: number): void => {
      this.highlightBytes[slot * 4] = value;
    };
    if (selection.kind === "province") {
      const slot = this.slotByProvinceId.get(selection.id);
      if (slot !== undefined) write(slot);
      return;
    }
    for (const [provinceId, slot] of this.slotByProvinceId) {
      if (this.ownerLookup(provinceId) === selection.id) {
        write(slot);
      }
    }
  }

  private rebuildHighlight(): void {
    this.highlightBytes.fill(0);
    this.applyMark(this.hoveredSelection, 1);
    this.applyMark(this.selectedSelection, 2);
    this.highlight.needsUpdate = true;
  }

  setHovered(selection: MapSelection | undefined): void {
    this.hoveredSelection = selection;
    this.rebuildHighlight();
    this.requestRender();
  }

  setSelected(selection: MapSelection | undefined): void {
    this.selectedSelection = selection;
    this.rebuildHighlight();
    this.requestRender();
  }

  getHalfHeight(): number {
    return this.panZoom.halfHeight;
  }

  beginDrag(x: number, y: number): void {
    this.panZoom.beginDrag(x, y);
  }

  drag(x: number, y: number): void {
    if (this.panZoom.drag(x, y)) {
      this.updateLabels();
      this.requestRender();
    }
  }

  endDrag(): void {
    this.panZoom.endDrag();
  }

  zoomAt(x: number, y: number, factor: number): void {
    this.panZoom.zoomAt(x, y, factor);
    this.updateDetailVisibility();
    this.requestRender();
  }

  update(): boolean {
    this.panZoom.applyView();
    this.updateLabels();
    return this.panZoom.needsAnimation();
  }

  needsAnimation(): boolean {
    return this.panZoom.needsAnimation();
  }

  pick(x: number, y: number): ProvinceFeature | undefined {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.raycaster.setFromCamera(
      new THREE.Vector2((x / width) * 2 - 1, 1 - (y / height) * 2),
      this.camera
    );
    const intersection = this.raycaster.ray.intersectPlane(this.pickPlane, this.pickPoint);
    if (intersection === null) return undefined;
    if (intersection.y < -90 || intersection.y > 90) return undefined;
    const [lon, lat] = mapXYToLonLat(intersection.x, intersection.y);
    return this.model.hitTest(wrapLongitude(lon), lat);
  }

  resize(): void {
    const cssWidth = Math.max(1, Math.floor(this.canvas.clientWidth));
    const cssHeight = Math.max(1, Math.floor(this.canvas.clientHeight));
    const requestedRatio = Math.min(window.devicePixelRatio || 1, 2);
    let width = Math.floor(cssWidth * requestedRatio);
    let height = Math.floor(cssHeight * requestedRatio);
    const pixels = width * height;
    if (pixels > MAX_DRAWING_PIXELS) {
      const scale = Math.sqrt(MAX_DRAWING_PIXELS / pixels);
      width = Math.floor(width * scale);
      height = Math.floor(height * scale);
    }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.labels.resize(cssWidth, cssHeight);
    this.panZoom.applyView();
    this.applyLineResolutions();
    this.updateLabels();
    this.requestRender();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  dispose(): void {
    this.mapRoot.clear();
    this.labels.dispose();
    this.landMesh.geometry.dispose();
    this.material.dispose();
    this.palette.dispose();
    this.highlight.dispose();
    disposeWideLines(this.coastLines);
    disposeWideLines(this.provinceLines);
    disposeWideLines(this.disputedProvinceLines);
    disposeWideLines(this.countryLines);
    for (const entry of this.roadMeshEntries) {
      disposeRoadMesh(entry.mesh);
    }
    for (const mesh of [this.capitalWhiteMesh, this.capitalRingMesh, this.capitalDotMesh]) {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const entry of material) entry.dispose();
      } else {
        material.dispose();
      }
    }
    this.ocean.geometry.dispose();
    this.oceanMaterial.dispose();
    this.renderer.dispose();
  }
}

export function provinceLabel(feature: MapFeature | undefined): string {
  if (feature === undefined) return "—";
  return feature.properties.nameEn ?? feature.properties.name ?? feature.id;
}

export function boundaryOwnerChanges(
  previous: Readonly<Record<string, string>> | undefined,
  next: Readonly<Record<string, string>> | undefined
): readonly string[] | undefined {
  if (previous === undefined || next === undefined) return undefined;
  const changed: string[] = [];
  const ids = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const id of ids) if (previous[id] !== next[id]) changed.push(id);
  return changed;
}

export function boundaryIsCountry(
  boundary: MapBoundary,
  ownerLookup: (provinceId: string) => string | undefined
): boolean {
  if (boundary.rightProvinceId === null) return true;
  const left = ownerLookup(boundary.leftProvinceId);
  const right = ownerLookup(boundary.rightProvinceId);
  return left === undefined || right === undefined || left !== right;
}
