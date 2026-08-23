import {
  lonLatToUnitVector,
  unitVectorToLonLat,
  type GeoJsonGeometry,
  type LonLat,
  type MapBoundary,
  type MapFeature,
  type MapViewModel,
  type ProvinceFeature
} from "@economic-simulator/map-runtime";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

const OCEAN = 0x0b1c2c;
const COAST = 0x7eb6c9;
const PROVINCE_BORDER = 0x3d5a6e;
const COUNTRY_BORDER = 0xd7e6f2;
const CAPITAL = 0xd7e8f5;
const HOVER_FILL = new THREE.Color("#3a6f88");
const SELECT_FILL = new THREE.Color("#4f8fad");
const LAND_RADIUS = 1.006;
const LINE_RADIUS = LAND_RADIUS + 0.00035;
const CAPITAL_RADIUS = LAND_RADIUS + 0.0005;
const ATMOSPHERE_RADIUS = 1.016;
const INITIAL_CAMERA_DISTANCE = 3.6;
const MAX_DRAWING_PIXELS = 3840 * 2160;
const PROVINCE_DETAIL_DISTANCE = 2.0;

export interface GlobeRuntimeModel extends MapViewModel {
  hitTest(lon: number, lat: number): ProvinceFeature | undefined;
  findProvince(id: string): ProvinceFeature | undefined;
  getProvinceOwner(provinceId: string): string | undefined;
}

export function showProvinceBorders(distance: number): boolean {
  return distance <= PROVINCE_DETAIL_DISTANCE;
}

function countryFill(adm0A3: string | undefined): THREE.Color {
  if (adm0A3 === undefined || adm0A3.length === 0) return new THREE.Color("#1a3348");
  let hash = 0;
  for (let index = 0; index < adm0A3.length; index += 1) {
    hash = (hash * 33 + adm0A3.charCodeAt(index)) >>> 0;
  }
  return new THREE.Color().setHSL(
    (hash % 360) / 360,
    (28 + (hash % 18)) / 100,
    (28 + (hash % 10)) / 100,
    THREE.SRGBColorSpace
  );
}

function pushLineSegments(target: number[], coordinates: readonly LonLat[], radius: number): void {
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = lonLatToUnitVector(
      coordinates[index - 1]![0],
      coordinates[index - 1]![1],
      radius
    );
    const current = lonLatToUnitVector(coordinates[index]![0], coordinates[index]![1], radius);
    target.push(...previous, ...current);
  }
}

function addGeometryLines(target: number[], geometry: GeoJsonGeometry, radius: number): void {
  if (geometry.type === "LineString") {
    pushLineSegments(target, geometry.coordinates, radius);
  } else if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) pushLineSegments(target, line, radius);
  }
}

function makeWideLines(positions: number[], color: number, width: number): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions.length === 0 ? [0, 0, 0, 0, 0, 0] : positions);
  const material = new LineMaterial({
    color,
    linewidth: width,
    worldUnits: false,
    alphaToCoverage: true,
    depthTest: true,
    depthWrite: false
  });
  const lines = new LineSegments2(geometry, material);
  lines.frustumCulled = false;
  lines.visible = positions.length > 0;
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

function createLandMaterial(palette: THREE.DataTexture, paletteSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      palette: { value: palette },
      paletteSize: { value: paletteSize },
      hoveredSlot: { value: -1 },
      selectedSlot: { value: -1 },
      hoverColor: { value: HOVER_FILL },
      selectedColor: { value: SELECT_FILL }
    },
    vertexShader: `
      attribute float provinceSlot;
      varying float vProvinceSlot;
      varying vec3 vNormal;
      void main() {
        vProvinceSlot = provinceSlot;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D palette;
      uniform float paletteSize;
      uniform float hoveredSlot;
      uniform float selectedSlot;
      uniform vec3 hoverColor;
      uniform vec3 selectedColor;
      varying float vProvinceSlot;
      varying vec3 vNormal;
      void main() {
        vec2 uv = vec2((vProvinceSlot + 0.5) / paletteSize, 0.5);
        vec3 color = texture2D(palette, uv).rgb;
        if (abs(vProvinceSlot - selectedSlot) < 0.25) {
          color = selectedColor;
        } else if (abs(vProvinceSlot - hoveredSlot) < 0.25) {
          color = hoverColor;
        }
        float light = 0.62 + 0.38 * max(dot(normalize(vNormal), normalize(vec3(-0.25, 0.4, 1.0))), 0.0);
        gl_FragColor = vec4(color * light, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true
  });
}

function createAtmosphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float horizon = max(0.0, 0.62 - dot(vWorldNormal, viewDirection));
        float glow = min(pow(horizon, 4.0) * 0.16, 0.14);
        gl_FragColor = vec4(0.24, 0.58, 0.76, glow);
      }
    `
  });
}

export class GlobeRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 20);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pickSphere = new THREE.Sphere(new THREE.Vector3(), LAND_RADIUS);
  private readonly paletteBytes: Uint8Array;
  private readonly palette: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly landMeshes: THREE.Mesh[] = [];
  private readonly slotByProvinceId = new Map<string, number>();
  private readonly capitalPoints: THREE.Points;
  private readonly ocean: THREE.Mesh;
  private readonly atmosphere: THREE.Mesh;
  private coastLines: LineSegments2;
  private provinceLines: LineSegments2;
  private countryLines: LineSegments2;
  private provinceLineHasGeometry = false;
  private ownerLookup: (provinceId: string) => string | undefined;

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
    this.renderer.setClearColor(0x071018, 1);

    const initial = lonLatToUnitVector(10, 20, INITIAL_CAMERA_DISTANCE);
    this.camera.position.set(...initial);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = false;
    this.controls.minDistance = 1.15;
    this.controls.maxDistance = 6;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener("change", this.onControlsChange);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const light = new THREE.DirectionalLight(0xbfe4ff, 1.25);
    light.position.set(-2, 3, 4);
    this.camera.add(light);
    this.scene.add(this.camera);

    this.ocean = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 96),
      new THREE.MeshPhongMaterial({ color: OCEAN, shininess: 18, specular: 0x31546b })
    );
    this.scene.add(this.ocean);

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
    model.globeMesh.provinceIds.forEach((id, slot) => this.slotByProvinceId.set(id, slot));
    this.material = createLandMaterial(this.palette, model.globeMesh.provinceIds.length);
    this.rebuildPalette();

    const authoredLod = model.globeMesh.lods.at(-1);
    if (authoredLod === undefined) throw new Error("地球仪缺少原始精度网格。");
    for (const lod of [authoredLod]) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(lod.positions, 3));
      geometry.setAttribute("provinceSlot", new THREE.BufferAttribute(lod.provinceSlots, 1));
      const normals = new Float32Array(lod.positions.length);
      for (let index = 0; index < lod.positions.length; index += 3) {
        const length = Math.hypot(
          lod.positions[index]!,
          lod.positions[index + 1]!,
          lod.positions[index + 2]!
        );
        normals[index] = lod.positions[index]! / length;
        normals[index + 1] = lod.positions[index + 1]! / length;
        normals[index + 2] = lod.positions[index + 2]! / length;
      }
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(lod.indices, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.visible = false;
      this.landMeshes.push(mesh);
      this.scene.add(mesh);
    }

    const coastPositions: number[] = [];
    for (const feature of model.coastlines) {
      addGeometryLines(coastPositions, feature.geometry, LINE_RADIUS);
    }
    this.coastLines = makeWideLines(coastPositions, COAST, 0.9);
    this.provinceLines = makeWideLines([], PROVINCE_BORDER, 0.65);
    this.countryLines = makeWideLines([], COUNTRY_BORDER, 1.45);
    this.scene.add(this.coastLines, this.provinceLines, this.countryLines);
    this.rebuildBoundaries();

    const capitalPositions = new Float32Array(model.provinces.length * 3);
    for (const [index, feature] of model.provinces.entries()) {
      capitalPositions.set(
        lonLatToUnitVector(
          feature.properties.capital.coordinates[0],
          feature.properties.capital.coordinates[1],
          CAPITAL_RADIUS
        ),
        index * 3
      );
    }
    const capitalGeometry = new THREE.BufferGeometry();
    capitalGeometry.setAttribute("position", new THREE.BufferAttribute(capitalPositions, 3));
    this.capitalPoints = new THREE.Points(
      capitalGeometry,
      new THREE.PointsMaterial({
        color: CAPITAL,
        size: 3.2,
        sizeAttenuation: false,
        depthTest: true,
        depthWrite: false
      })
    );
    this.scene.add(this.capitalPoints);

    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 64),
      createAtmosphereMaterial()
    );
    this.scene.add(this.atmosphere);
    this.updateDetailVisibility();
    this.resize();
  }

  private readonly onControlsChange = (): void => {
    this.updateDetailVisibility();
    this.requestRender();
  };

  private updateDetailVisibility(): void {
    const distance = this.camera.position.length();
    this.landMeshes.forEach((mesh, index) => {
      mesh.visible = index === this.landMeshes.length - 1;
    });
    this.provinceLines.visible = this.provinceLineHasGeometry && showProvinceBorders(distance);
    this.capitalPoints.visible = showProvinceBorders(distance);
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
        LINE_RADIUS
      );
    }
    this.scene.remove(this.provinceLines, this.countryLines);
    disposeWideLines(this.provinceLines);
    disposeWideLines(this.countryLines);
    this.provinceLines = makeWideLines(provincePositions, PROVINCE_BORDER, 0.65);
    this.provinceLineHasGeometry = provincePositions.length > 0;
    this.countryLines = makeWideLines(countryPositions, COUNTRY_BORDER, 1.45);
    this.scene.add(this.provinceLines, this.countryLines);
  }

  updateOwners(
    ownerLookup: (provinceId: string) => string | undefined,
    changedProvinceIds?: readonly string[]
  ): void {
    this.ownerLookup = ownerLookup;
    this.rebuildPalette(changedProvinceIds);
    this.rebuildBoundaries();
    this.updateDetailVisibility();
    this.requestRender();
  }

  setHovered(provinceId: string | undefined): void {
    this.material.uniforms.hoveredSlot!.value =
      provinceId === undefined ? -1 : (this.slotByProvinceId.get(provinceId) ?? -1);
    this.requestRender();
  }

  setSelected(provinceId: string | undefined): void {
    this.material.uniforms.selectedSlot!.value =
      provinceId === undefined ? -1 : (this.slotByProvinceId.get(provinceId) ?? -1);
    this.requestRender();
  }

  pick(x: number, y: number): ProvinceFeature | undefined {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.raycaster.setFromCamera(
      new THREE.Vector2((x / width) * 2 - 1, 1 - (y / height) * 2),
      this.camera
    );
    const intersection = this.raycaster.ray.intersectSphere(this.pickSphere, new THREE.Vector3());
    if (intersection === null) return undefined;
    const [lon, lat] = unitVectorToLonLat([intersection.x, intersection.y, intersection.z]);
    return this.model.hitTest(lon, lat);
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
    this.camera.aspect = cssWidth / cssHeight;
    this.camera.updateProjectionMatrix();
    for (const lines of [this.coastLines, this.provinceLines, this.countryLines]) {
      const material = lines.material;
      if (!Array.isArray(material) && material instanceof LineMaterial) {
        material.resolution.set(width, height);
      }
    }
    this.requestRender();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.controls.removeEventListener("change", this.onControlsChange);
    this.controls.dispose();
    for (const mesh of this.landMeshes) mesh.geometry.dispose();
    this.material.dispose();
    this.palette.dispose();
    disposeWideLines(this.coastLines);
    disposeWideLines(this.provinceLines);
    disposeWideLines(this.countryLines);
    this.capitalPoints.geometry.dispose();
    (this.capitalPoints.material as THREE.Material).dispose();
    this.ocean.geometry.dispose();
    (this.ocean.material as THREE.Material).dispose();
    this.atmosphere.geometry.dispose();
    (this.atmosphere.material as THREE.Material).dispose();
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
