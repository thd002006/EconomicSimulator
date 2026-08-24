import { lonLatToUnitVector } from "@economic-simulator/map-runtime";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  computeInitialOrientation,
  extractPitch,
  extractYaw,
  GlobeDragController,
  INITIAL_LAT,
  INITIAL_LON,
  intersectUnitSphere,
  PITCH_MAX,
  PITCH_MIN
} from "./globe-controls.js";

function mockCanvas(width = 800, height = 600): HTMLCanvasElement {
  return { clientWidth: width, clientHeight: height } as HTMLCanvasElement;
}

function createTestCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(40, 800 / 600, 0.01, 20);
  camera.position.set(0, 0, 3.6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function localHitAt(
  controller: GlobeDragController,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  x: number,
  y: number
): THREE.Vector3 | undefined {
  const pointer = new THREE.Vector2(
    (x / canvas.clientWidth) * 2 - 1,
    1 - (y / canvas.clientHeight) * 2
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const inverse = controller.orientation.clone().invert();
  const origin = raycaster.ray.origin.clone().applyQuaternion(inverse);
  const direction = raycaster.ray.direction.clone().applyQuaternion(inverse);
  return intersectUnitSphere(origin, direction);
}

describe("globe drag controller", () => {
  it("computes an initial orientation that faces the default lon/lat toward the camera", () => {
    const orientation = computeInitialOrientation(INITIAL_LON, INITIAL_LAT);
    const localPoint = new THREE.Vector3(...lonLatToUnitVector(INITIAL_LON, INITIAL_LAT, 1));
    localPoint.applyQuaternion(orientation);
    expect(localPoint.z).toBeCloseTo(1, 4);
    expect(localPoint.length()).toBeCloseTo(1, 5);
  });

  it("intersects a unit sphere from a forward ray", () => {
    const hit = intersectUnitSphere(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    expect(hit).toBeDefined();
    expect(hit!.length()).toBeCloseTo(1, 5);
    expect(hit!.z).toBeCloseTo(1, 5);
  });

  it("keeps the grabbed surface point under the cursor during drag", () => {
    const camera = createTestCamera();
    const canvas = mockCanvas();
    const controller = new GlobeDragController(camera, canvas, INITIAL_LON, INITIAL_LAT);
    const startX = canvas.clientWidth / 2;
    const startY = canvas.clientHeight / 2;
    const endX = startX + 120;
    const endY = startY + 40;

    controller.beginDrag(startX, startY);
    const grabbed = localHitAt(controller, camera, canvas, startX, startY);
    expect(grabbed).toBeDefined();

    controller.drag(endX, endY);
    const hitAtEnd = localHitAt(controller, camera, canvas, endX, endY);
    expect(hitAtEnd).toBeDefined();
    expect(grabbed!.dot(hitAtEnd!)).toBeCloseTo(1, 2);
  });

  it("springs pitch back to default while preserving yaw after drag ends", () => {
    const camera = createTestCamera();
    const canvas = mockCanvas();
    const controller = new GlobeDragController(camera, canvas, INITIAL_LON, INITIAL_LAT);
    const defaultPitch = extractPitch(controller.orientation);
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;

    controller.beginDrag(centerX, centerY);
    controller.drag(centerX, centerY - 180);
    const yawAfterDrag = extractYaw(controller.orientation);
    expect(extractPitch(controller.orientation)).not.toBeCloseTo(defaultPitch, 2);

    controller.endDrag();
    for (let step = 0; step < 720; step += 1) {
      controller.update(1 / 60);
      if (!controller.needsAnimation()) break;
    }

    expect(extractPitch(controller.orientation)).toBeCloseTo(defaultPitch, 2);
    expect(extractYaw(controller.orientation)).toBeCloseTo(yawAfterDrag, 2);
    expect(controller.needsAnimation()).toBe(false);
  });

  it("clamps extreme pitch during drag", () => {
    const camera = createTestCamera();
    const canvas = mockCanvas();
    const controller = new GlobeDragController(camera, canvas, INITIAL_LON, INITIAL_LAT);
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;

    controller.beginDrag(centerX, centerY);
    for (let index = 0; index < 30; index += 1) {
      controller.drag(centerX, centerY - index * 40);
    }

    const pitch = extractPitch(controller.orientation);
    expect(pitch).toBeGreaterThanOrEqual(PITCH_MIN);
    expect(pitch).toBeLessThanOrEqual(PITCH_MAX);
  });
});
