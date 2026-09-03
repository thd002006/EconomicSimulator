import {
  lonLatToMapXY,
  mapXYToLonLat,
  wrapLongitude,
  buildRoadDrawBatches,
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
const COUNTRY_BORDER = 0x2a1c12;
const CAPITAL = 0x5a4030;
const HOVER_FILL = new THREE.Color("#c4a060");
const SELECT_FILL = new THREE.Color("#a07840");
const LAND_Z = 0.02;
const LINE_Z = 0.04;
const ROAD_Z = 0.045;
const CAPITAL_Z = 0.06;
const CAPITAL_POINT_SIZE = 7;
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

function createCapitalRingTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Unable to create capital marker canvas.");
  }
  context.clearRect(0, 0, size, size);
  const center = size / 2;
  const radius = size * 0.32;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.strokeStyle = "#5a4030";
  context.lineWidth = size * 0.08;
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
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
  renderOrder = 0
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
    depthWrite: false
  });
  const lines = new LineSegments2(geometry, material);
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
  private readonly capitalPoints: THREE.Points;
  private readonly ocean: THREE.Mesh;
  private readonly labels: MapLabelLayer;
  private coastLines: LineSegments2;
  private provinceLines: LineSegments2;
  private countryLines: LineSegments2;
  private readonly roadLineEntries: Array<{
    typeId: string;
    maxVisibleHalfHeight: number;
    lines: LineSegments2;
  }> = [];
  private provinceLineHasGeometry = false;
  private ownerLookup: (provinceId: string) => string | undefined;
  private hoveredSelection: MapSelection | undefined;
  private selectedSelection: MapSelection | undefined;
  private readonly lineResolution = new THREE.Vector2();

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
    if (authoredLod === undefined) throw new Error("Map pack is missing the source-resolution mesh.");
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
    this.countryLines = makeWideLines(
      [],
      COUNTRY_BORDER,
      COUNTRY_BORDER_WIDTH,
      COUNTRY_BORDER_OPACITY,
      COUNTRY_RENDER_ORDER
    );
    this.tileTemplate.add(this.coastLines, this.provinceLines, this.countryLines);
    this.rebuildBoundaries();
    this.buildRoadLines();

    const capitalPositions = new Float32Array(model.provinces.length * 3);
    for (const [index, feature] of model.provinces.entries()) {
      const [x, y] = lonLatToMapXY(
        feature.properties.capital.coordinates[0],
        feature.properties.capital.coordinates[1]
      );
      capitalPositions.set([x, y, CAPITAL_Z], index * 3);
    }
    const capitalGeometry = new THREE.BufferGeometry();
    capitalGeometry.setAttribute("position", new THREE.BufferAttribute(capitalPositions, 3));
    this.capitalPoints = new THREE.Points(
      capitalGeometry,
      new THREE.PointsMaterial({
        color: CAPITAL,
        map: createCapitalRingTexture(),
        size: CAPITAL_POINT_SIZE,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.62,
        alphaTest: 0.05
      })
    );
    this.capitalPoints.renderOrder = CAPITAL_RENDER_ORDER;
    this.tileTemplate.add(this.capitalPoints);
    this.refreshTiles();
    this.rebuildLabels();
    this.updateDetailVisibility();
    this.resize();
  }

  private buildRoadLines(): void {
    const capitals = new Map(
      this.model.provinces.map((province) => [
        province.id,
        province.properties.capital.coordinates
      ] as const)
    );
    const batches = buildRoadDrawBatches(this.model.roads.segments, {
      capitals,
      boundaries: this.model.boundaries,
      provinceGeometryById: new Map(
        this.model.provinces.map((province) => [province.id, province.geometry] as const)
      )
    });
    const batchByType = new Map(batches.map((batch) => [batch.typeId, batch]));

    for (const typeDef of roadTypesSortedByDrawOrder()) {
      const batch = batchByType.get(typeDef.id);
      const positions: number[] = [];
      if (batch !== undefined) {
        for (const polyline of batch.polylines) {
          pushLineSegments(positions, polyline, ROAD_Z);
        }
      }

      if (typeDef.casingColor !== undefined && typeDef.casingWidth !== undefined) {
        const casing = makeWideLines(
          positions,
          typeDef.casingColor,
          typeDef.casingWidth,
          Math.min(1, typeDef.strokeOpacity + 0.1),
          ROAD_RENDER_ORDER
        );
        casing.userData.hasRoadGeometry = positions.length > 0;
        this.roadLineEntries.push({
          typeId: typeDef.id,
          maxVisibleHalfHeight: typeDef.maxVisibleHalfHeight,
          lines: casing
        });
        this.tileTemplate.add(casing);
      }

      const stroke = makeWideLines(
        positions,
        typeDef.strokeColor,
        typeDef.lineWidth,
        typeDef.strokeOpacity,
        ROAD_RENDER_ORDER
      );
      stroke.userData.hasRoadGeometry = positions.length > 0;
      if (
        typeDef.dashSize !== undefined &&
        typeDef.gapSize !== undefined &&
        !Array.isArray(stroke.material) &&
        stroke.material instanceof LineMaterial
      ) {
        stroke.material.dashed = true;
        stroke.material.dashSize = typeDef.dashSize;
        stroke.material.gapSize = typeDef.gapSize;
        stroke.computeLineDistances();
      }
      this.roadLineEntries.push({
        typeId: typeDef.id,
        maxVisibleHalfHeight: typeDef.maxVisibleHalfHeight,
        lines: stroke
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
    const showProvinces = this.provinceLineHasGeometry && showProvinceBorders(halfHeight);
    this.provinceLines.visible = showProvinces;
    this.capitalPoints.visible = showProvinceBorders(halfHeight);

    const roadVisibility = new Map<LineMaterial, boolean>();
    for (const entry of this.roadLineEntries) {
      const material = entry.lines.material;
      if (!Array.isArray(material) && material instanceof LineMaterial) {
        roadVisibility.set(
          material,
          entry.lines.userData.hasRoadGeometry === true &&
            halfHeight <= entry.maxVisibleHalfHeight
        );
      }
    }

    this.mapRoot.traverse((object) => {
      if (object === this.provinceLines || object === this.capitalPoints) return;
      if (object instanceof LineSegments2 && object.material === this.provinceLines.material) {
        object.visible = showProvinces;
        return;
      }
      if (object instanceof THREE.Points && object.material === this.capitalPoints.material) {
        object.visible = showProvinceBorders(halfHeight);
        return;
      }
      if (object instanceof LineSegments2) {
        const material = object.material;
        if (!Array.isArray(material) && material instanceof LineMaterial) {
          const showRoad = roadVisibility.get(material);
          if (showRoad !== undefined) {
            object.visible = showRoad;
          }
        }
      }
    });
    this.updateLabels();
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
      const color =
        fill === undefined
          ? countryFill(this.ownerLookup(id) ?? feature?.properties.adm0A3)
          : new THREE.Color(fill);
      this.paletteBytes[slot * 4] = Math.round(color.r * 255);
      this.paletteBytes[slot * 4 + 1] = Math.round(color.g * 255);
      this.paletteBytes[slot * 4 + 2] = Math.round(color.b * 255);
      this.paletteBytes[slot * 4 + 3] = 255;
    }
    this.palette.needsUpdate = true;
  }

  private rebuildBoundaries(): void {
    const provincePositions: number[] = [];
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
      pushLineSegments(
        isCountry ? countryPositions : provincePositions,
        boundary.coordinates,
        LINE_Z
      );
    }
    this.tileTemplate.remove(this.provinceLines, this.countryLines);
    disposeWideLines(this.provinceLines);
    disposeWideLines(this.countryLines);
    this.provinceLines = makeWideLines(
      provincePositions,
      PROVINCE_BORDER,
      PROVINCE_BORDER_WIDTH,
      PROVINCE_BORDER_OPACITY,
      1
    );
    this.provinceLineHasGeometry = provincePositions.length > 0;
    this.countryLines = makeWideLines(
      countryPositions,
      COUNTRY_BORDER,
      COUNTRY_BORDER_WIDTH,
      COUNTRY_BORDER_OPACITY,
      COUNTRY_RENDER_ORDER
    );
    this.applyLineResolutions();
    this.tileTemplate.add(this.provinceLines, this.countryLines);
    this.refreshTiles();
  }

  private applyLineResolutions(): void {
    this.renderer.getDrawingBufferSize(this.lineResolution);
    const width = Math.max(1, Math.floor(this.lineResolution.x));
    const height = Math.max(1, Math.floor(this.lineResolution.y));
    const allLines = [
      this.coastLines,
      this.provinceLines,
      this.countryLines,
      ...this.roadLineEntries.map((entry) => entry.lines)
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
    disposeWideLines(this.countryLines);
    for (const entry of this.roadLineEntries) {
      disposeWideLines(entry.lines);
    }
    this.capitalPoints.geometry.dispose();
    const capitalMaterial = this.capitalPoints.material;
    if (!Array.isArray(capitalMaterial) && capitalMaterial instanceof THREE.PointsMaterial) {
      capitalMaterial.map?.dispose();
      capitalMaterial.dispose();
    } else if (Array.isArray(capitalMaterial)) {
      for (const entry of capitalMaterial) entry.dispose();
    } else {
      capitalMaterial.dispose();
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
