import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  INITIAL_HALF_HEIGHT,
  INITIAL_LAT,
  INITIAL_LON,
  MAP_WRAP,
  MapPanZoomController,
  MAX_HALF_HEIGHT,
  MIN_HALF_HEIGHT,
  clampHalfHeight,
  wrapCameraX
} from "./map-controls.js";

function mockCanvas(width = 800, height = 400): HTMLCanvasElement {
  return { clientWidth: width, clientHeight: height } as HTMLCanvasElement;
}

function createCamera(): THREE.OrthographicCamera {
  return new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
}

describe("map pan/zoom controller", () => {
  it("wraps camera longitude into (-180, 180]", () => {
    expect(wrapCameraX(190)).toBeCloseTo(-170, 8);
    expect(wrapCameraX(-190)).toBeCloseTo(170, 8);
    expect(wrapCameraX(180)).toBe(180);
  });

  it("pans so the grabbed map point stays under the cursor", () => {
    const camera = createCamera();
    const canvas = mockCanvas();
    const controller = new MapPanZoomController(camera, canvas, 0, 0, 90);
    const startX = canvas.clientWidth / 2;
    const startY = canvas.clientHeight / 2;
    const originX = camera.position.x;
    const originY = camera.position.y;

    controller.beginDrag(startX, startY);
    controller.drag(startX + 80, startY);
    expect(camera.position.x).not.toBeCloseTo(originX, 4);
    expect(camera.position.y).toBeCloseTo(originY, 4);
  });

  it("wraps the camera when panning across the antimeridian", () => {
    const camera = createCamera();
    const canvas = mockCanvas();
    const controller = new MapPanZoomController(camera, canvas, 170, 0, 40);
    controller.beginDrag(400, 200);
    controller.drag(100, 200);
    expect(camera.position.x).toBeGreaterThan(-MAP_WRAP / 2);
    expect(camera.position.x).toBeLessThanOrEqual(MAP_WRAP / 2);
  });

  it("zooms toward the cursor without leaving the rest pitch spring", () => {
    const camera = createCamera();
    const canvas = mockCanvas();
    const controller = new MapPanZoomController(
      camera,
      canvas,
      INITIAL_LON,
      INITIAL_LAT,
      INITIAL_HALF_HEIGHT
    );
    const x = canvas.clientWidth * 0.75;
    const y = canvas.clientHeight * 0.25;
    const before = new THREE.Vector3(
      camera.position.x + ((x / canvas.clientWidth) * 2 - 1) * ((camera.right - camera.left) / 2),
      camera.position.y + (1 - (y / canvas.clientHeight) * 2) * ((camera.top - camera.bottom) / 2),
      0
    );
    controller.zoomAt(x, y, 0.5);
    const after = new THREE.Vector3(
      camera.position.x + ((x / canvas.clientWidth) * 2 - 1) * ((camera.right - camera.left) / 2),
      camera.position.y + (1 - (y / canvas.clientHeight) * 2) * ((camera.top - camera.bottom) / 2),
      0
    );
    expect(controller.halfHeight).toBeLessThan(INITIAL_HALF_HEIGHT);
    expect(controller.halfHeight).toBeGreaterThanOrEqual(MIN_HALF_HEIGHT);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
    expect(controller.needsAnimation()).toBe(false);
  });

  it("clamps zoom and latitude so the map cannot leave the world", () => {
    expect(MIN_HALF_HEIGHT).toBe(4);
    expect(clampHalfHeight(1)).toBe(MIN_HALF_HEIGHT);
    expect(clampHalfHeight(400)).toBe(MAX_HALF_HEIGHT);
    const camera = createCamera();
    const canvas = mockCanvas();
    const controller = new MapPanZoomController(camera, canvas, 0, 80, MAX_HALF_HEIGHT);
    expect(camera.position.y).toBeCloseTo(0, 5);
    controller.zoomAt(400, 200, 0.2);
    controller.beginDrag(400, 0);
    controller.drag(400, 400);
    expect(camera.position.y).toBeGreaterThanOrEqual(-90 + controller.halfHeight);
    expect(camera.position.y).toBeLessThanOrEqual(90 - controller.halfHeight);
  });
});
