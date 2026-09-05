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
    strokeColor: 0xffffff,
    strokeOpacity: 1,
    lineWidth: 2.0,
    casingColor: 0xd0d0d0,
    casingWidth: 2.8,
    maxVisibleHalfHeight: 32
  },
  {
    id: ROAD_TYPE_HIGHWAY,
    nameKey: "map.road.highway",
    drawOrder: 1,
    laneIndex: 0,
    strokeColor: 0xffb366,
    strokeOpacity: 1,
    lineWidth: 3.2,
    casingColor: 0xd4893a,
    casingWidth: 4.2,
    maxVisibleHalfHeight: 90
  },
  {
    id: ROAD_TYPE_RAILWAY,
    nameKey: "map.road.railway",
    drawOrder: 2,
    laneIndex: 1,
    strokeColor: 0xffffff,
    strokeOpacity: 1,
    lineWidth: 1.8,
    casingColor: 0x666666,
    casingWidth: 2.8,
    dashSize: 6,
    gapSize: 6,
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
