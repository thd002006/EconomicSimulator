import type { RoadTypeDefinition, RoadTypeId } from "./types.js";

export const ROAD_TYPE_LOCAL = "local_road";
export const ROAD_TYPE_HIGHWAY = "highway";
export const ROAD_TYPE_RAILWAY = "railway";

export const ROAD_TYPE_DEFINITIONS: readonly RoadTypeDefinition[] = [
  {
    id: ROAD_TYPE_LOCAL,
    nameKey: "map.road.local",
    drawOrder: 0,
    laneIndex: -1,
    laneSpacingScale: 1,
    strokeColor: 0x6b5340,
    strokeOpacity: 0.55,
    lineWidth: 1.6,
    maxVisibleHalfHeight: 32
  },
  {
    id: ROAD_TYPE_HIGHWAY,
    nameKey: "map.road.highway",
    drawOrder: 1,
    laneIndex: 0,
    laneSpacingScale: 1,
    strokeColor: 0x4a3428,
    strokeOpacity: 0.72,
    lineWidth: 2.2,
    maxVisibleHalfHeight: 90
  },
  {
    id: ROAD_TYPE_RAILWAY,
    nameKey: "map.road.railway",
    drawOrder: 2,
    laneIndex: 1,
    laneSpacingScale: 1,
    strokeColor: 0x2a1c12,
    strokeOpacity: 0.85,
    lineWidth: 1.8,
    casingColor: 0x2a1c12,
    casingWidth: 3.2,
    dashSize: 4,
    gapSize: 3,
    maxVisibleHalfHeight: 90
  }
];

const BY_ID = new Map(ROAD_TYPE_DEFINITIONS.map((type) => [type.id, type]));

export function getRoadTypeDefinition(typeId: RoadTypeId): RoadTypeDefinition | undefined {
  return BY_ID.get(typeId);
}

export function isKnownRoadTypeId(typeId: string): boolean {
  return BY_ID.has(typeId);
}

export function roadTypesSortedByDrawOrder(): readonly RoadTypeDefinition[] {
  return [...ROAD_TYPE_DEFINITIONS].sort((a, b) => a.drawOrder - b.drawOrder);
}
