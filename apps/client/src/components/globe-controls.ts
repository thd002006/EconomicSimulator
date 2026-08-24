import { lonLatToUnitVector } from "@economic-simulator/map-runtime";
import * as THREE from "three";

export const INITIAL_LON = 10;
export const INITIAL_LAT = 20;
export const SPRING_STIFFNESS = 8;
export const SPRING_DAMPING = 0.85;
export const SPRING_EPSILON = 0.0005;
export const PITCH_MIN = (-80 * Math.PI) / 180;
export const PITCH_MAX = (80 * Math.PI) / 180;

export function computeInitialOrientation(lon: number, lat: number): THREE.Quaternion {
  const target = new THREE.Vector3(...lonLatToUnitVector(lon, lat, 1));
  return new THREE.Quaternion().setFromUnitVectors(target, new THREE.Vector3(0, 0, 1));
}

export function extractPitch(orientation: THREE.Quaternion): number {
  return new THREE.Euler().setFromQuaternion(orientation, "YXZ").x;
}

export function extractYaw(orientation: THREE.Quaternion): number {
  return new THREE.Euler().setFromQuaternion(orientation, "YXZ").y;
}

export function intersectUnitSphere(
  origin: THREE.Vector3,
  direction: THREE.Vector3
): THREE.Vector3 | undefined {
  const rayDirection = direction.clone().normalize();
  const b = origin.dot(rayDirection);
  const c = origin.dot(origin) - 1;
  const discriminant = b * b - c;
  if (discriminant < 0) return undefined;
  const distance = -b - Math.sqrt(discriminant);
  if (distance < 0) return undefined;
  return origin.clone().addScaledVector(rayDirection, distance).normalize();
}

export class GlobeDragController {
  readonly orientation: THREE.Quaternion;
  private readonly defaultPitch: number;
  private readonly camera: THREE.Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly prevHit = new THREE.Vector3();
  private readonly localOrigin = new THREE.Vector3();
  private readonly localDirection = new THREE.Vector3();
  private readonly inverseOrientation = new THREE.Quaternion();
  private readonly deltaRotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private isDragging = false;
  private hasPrevHit = false;
  private springActive = false;
  private pitchVelocity = 0;
  private springYaw = 0;

  constructor(
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    lon = INITIAL_LON,
    lat = INITIAL_LAT
  ) {
    this.camera = camera;
    this.canvas = canvas;
    this.orientation = computeInitialOrientation(lon, lat);
    this.defaultPitch = extractPitch(this.orientation);
  }

  beginDrag(x: number, y: number): void {
    const hit = this.pointerToLocalHit(x, y);
    if (hit === undefined) return;
    this.prevHit.copy(hit);
    this.hasPrevHit = true;
    this.isDragging = true;
    this.springActive = false;
    this.pitchVelocity = 0;
  }

  drag(x: number, y: number): boolean {
    if (!this.isDragging || !this.hasPrevHit) return false;
    const hit = this.pointerToLocalHit(x, y);
    if (hit === undefined) return false;
    this.deltaRotation.setFromUnitVectors(this.prevHit, hit);
    this.orientation.premultiply(this.deltaRotation);
    this.clampPitch();
    this.prevHit.copy(hit);
    return true;
  }

  endDrag(): void {
    this.isDragging = false;
    this.hasPrevHit = false;
    this.springActive = true;
    this.pitchVelocity = 0;
    this.springYaw = extractYaw(this.orientation);
  }

  update(deltaSeconds: number): boolean {
    if (this.springActive) {
      this.euler.setFromQuaternion(this.orientation, "YXZ");
      const pitchError = this.defaultPitch - this.euler.x;
      if (Math.abs(pitchError) < 0.01 && Math.abs(this.pitchVelocity) < 0.01) {
        this.euler.x = this.defaultPitch;
        this.euler.y = this.springYaw;
        this.euler.z = 0;
        this.orientation.setFromEuler(this.euler);
        this.springActive = false;
        this.pitchVelocity = 0;
        return this.needsAnimation();
      }
      this.pitchVelocity += pitchError * SPRING_STIFFNESS * deltaSeconds;
      this.pitchVelocity *= Math.exp(-SPRING_DAMPING * deltaSeconds);
      const nextPitch = this.euler.x + this.pitchVelocity * deltaSeconds;
      this.euler.x = THREE.MathUtils.clamp(nextPitch, PITCH_MIN, PITCH_MAX);
      if (Math.abs(this.euler.x - nextPitch) > 1e-6) {
        this.pitchVelocity = 0;
      }
      this.euler.y = this.springYaw;
      this.euler.z = 0;
      this.orientation.setFromEuler(this.euler);
      const settledPitchError = this.defaultPitch - this.euler.x;
      if (
        Math.abs(settledPitchError) < SPRING_EPSILON &&
        Math.abs(this.pitchVelocity) < SPRING_EPSILON
      ) {
        this.euler.x = this.defaultPitch;
        this.euler.y = this.springYaw;
        this.euler.z = 0;
        this.orientation.setFromEuler(this.euler);
        this.springActive = false;
        this.pitchVelocity = 0;
      }
    }
    return this.needsAnimation();
  }

  needsAnimation(): boolean {
    return this.isDragging || this.springActive;
  }

  private pointerToLocalHit(x: number, y: number): THREE.Vector3 | undefined {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.pointer.set((x / width) * 2 - 1, 1 - (y / height) * 2);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.inverseOrientation.copy(this.orientation).invert();
    this.localOrigin.copy(this.raycaster.ray.origin).applyQuaternion(this.inverseOrientation);
    this.localDirection.copy(this.raycaster.ray.direction).applyQuaternion(this.inverseOrientation);
    return intersectUnitSphere(this.localOrigin, this.localDirection);
  }

  private clampPitch(): void {
    this.euler.setFromQuaternion(this.orientation, "YXZ");
    this.euler.x = THREE.MathUtils.clamp(this.euler.x, PITCH_MIN, PITCH_MAX);
    this.orientation.setFromEuler(this.euler);
  }
}
