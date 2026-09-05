import { wrapLongitude } from "@economic-simulator/map-runtime";
import * as THREE from "three";

export const INITIAL_LON = 10;
export const INITIAL_LAT = 20;
export const MIN_HALF_HEIGHT = 4;
export const MAX_HALF_HEIGHT = 90;
export const INITIAL_HALF_HEIGHT = 70;
export const MAP_WRAP = 360;

export function wrapCameraX(x: number): number {
  return wrapLongitude(x);
}

export function clampCameraY(y: number, halfHeight: number): number {
  const limit = Math.max(0, 90 - halfHeight);
  return THREE.MathUtils.clamp(y, -limit, limit);
}

export function clampHalfHeight(halfHeight: number): number {
  return THREE.MathUtils.clamp(halfHeight, MIN_HALF_HEIGHT, MAX_HALF_HEIGHT);
}

export class MapPanZoomController {
  halfHeight: number;
  private readonly camera: THREE.OrthographicCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly ndc = new THREE.Vector2();
  private readonly prevWorld = new THREE.Vector3();
  private readonly nextWorld = new THREE.Vector3();
  private dragging = false;

  constructor(
    camera: THREE.OrthographicCamera,
    canvas: HTMLCanvasElement,
    lon = INITIAL_LON,
    lat = INITIAL_LAT,
    halfHeight = INITIAL_HALF_HEIGHT
  ) {
    this.camera = camera;
    this.canvas = canvas;
    this.halfHeight = clampHalfHeight(halfHeight);
    this.camera.position.set(wrapCameraX(lon), clampCameraY(lat, this.halfHeight), 10);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0);
    this.applyView();
  }

  beginDrag(x: number, y: number): void {
    this.screenToWorld(x, y, this.prevWorld);
    this.dragging = true;
  }

  drag(x: number, y: number): boolean {
    if (!this.dragging) return false;
    this.screenToWorld(x, y, this.nextWorld);
    this.camera.position.x += this.prevWorld.x - this.nextWorld.x;
    this.camera.position.y += this.prevWorld.y - this.nextWorld.y;
    this.applyView();
    this.screenToWorld(x, y, this.prevWorld);
    return true;
  }

  endDrag(): void {
    this.dragging = false;
  }

  zoomAt(x: number, y: number, factor: number): void {
    this.screenToWorld(x, y, this.prevWorld);
    this.halfHeight = clampHalfHeight(this.halfHeight * factor);
    this.applyView();
    this.screenToWorld(x, y, this.nextWorld);
    this.camera.position.x += this.prevWorld.x - this.nextWorld.x;
    this.camera.position.y += this.prevWorld.y - this.nextWorld.y;
    this.applyView();
  }

  needsAnimation(): boolean {
    return false;
  }

  applyView(): void {
    this.camera.position.x = wrapCameraX(this.camera.position.x);
    this.camera.position.y = clampCameraY(this.camera.position.y, this.halfHeight);
    const aspect = Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
    const halfWidth = this.halfHeight * aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = this.halfHeight;
    this.camera.bottom = -this.halfHeight;
    this.camera.near = 0.1;
    this.camera.far = 100;
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private screenToWorld(x: number, y: number, target: THREE.Vector3): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.ndc.set((x / width) * 2 - 1, 1 - (y / height) * 2);
    const halfWidth = (this.camera.right - this.camera.left) / 2;
    const halfHeight = (this.camera.top - this.camera.bottom) / 2;
    target.set(
      this.camera.position.x + this.ndc.x * halfWidth,
      this.camera.position.y + this.ndc.y * halfHeight,
      0
    );
  }
}
