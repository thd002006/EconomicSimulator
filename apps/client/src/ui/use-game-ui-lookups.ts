import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CountryPopulationSummary,
  ProvincePopulationQueryResult
} from "@economic-simulator/simulation-core";
import type { SimulationWorkerClient } from "../worker-client";
import {
  mergeGameUiLookups,
  type GameUiLookups,
  type MapDisplayLookups
} from "./game-lookups";
import type { MapSelection } from "./selection";

export function useGameUiLookups(
  client: SimulationWorkerClient | undefined,
  simulationId: string | undefined,
  mapDisplay: MapDisplayLookups | undefined,
  ownership: Readonly<Record<string, string>> | undefined,
  selection: MapSelection | undefined,
  hovered: MapSelection | undefined
): GameUiLookups | undefined {
  const [provincePopulation, setProvincePopulation] = useState<
    Readonly<Record<string, ProvincePopulationQueryResult>>
  >({});
  const [countryPopulation, setCountryPopulation] = useState<
    Readonly<Record<string, CountryPopulationSummary>>
  >({});
  const inflightRef = useRef(new Set<string>());

  const targets = useMemo(() => {
    const next = new Set<string>();
    for (const item of [selection, hovered]) {
      if (item === undefined) continue;
      next.add(item.kind === "province" ? `p:${item.id}` : `c:${item.id}`);
    }
    return next;
  }, [selection, hovered]);

  useEffect(() => {
    if (client === undefined || simulationId === undefined) return;
    for (const key of targets) {
      if (inflightRef.current.has(key)) continue;
      inflightRef.current.add(key);
      const task =
        key.startsWith("p:") ?
          client
            .queryProvincePopulation(simulationId, key.slice(2))
            .then((response) => {
              const provinceId = key.slice(2);
              setProvincePopulation((current) => ({
                ...current,
                [provinceId]: response.payload
              }));
            })
        : client.queryCountryPopulation(simulationId, key.slice(2)).then((response) => {
            const countryId = key.slice(2);
            setCountryPopulation((current) => ({
              ...current,
              [countryId]: response.payload
            }));
          });
      void task
        .catch((error: unknown) => {
          if (import.meta.env.DEV) {
            console.warn("Population query failed:", key, error);
          }
        })
        .finally(() => {
          inflightRef.current.delete(key);
        });
    }
  }, [client, simulationId, targets]);

  if (mapDisplay === undefined || ownership === undefined) {
    return undefined;
  }
  return mergeGameUiLookups(mapDisplay, ownership, provincePopulation, countryPopulation);
}
