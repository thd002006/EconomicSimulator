import { useCallback, useEffect, useRef, useState } from "react";
import { loadMapPack, type LoadedMapPack } from "@economic-simulator/map-runtime";
import { buildScenarioBootstrap } from "./scenario-bootstrap";
import { MapView } from "./components/MapView";
import { TimeControls, type PlaySpeed } from "./components/TimeControls";
import type { MapDisplayLookups } from "./ui/game-lookups";
import { EntitySelectionPanel } from "./ui/selection-panel-model";
import type { MapSelection } from "./ui/selection";
import { useGameUiLookups } from "./ui/use-game-ui-lookups";
import { SimulationWorkerClient } from "./worker-client";

type ConnectionState = "starting" | "ready" | "error";

const GAME_ID = "world-campaign";
const MAP_ID = "world-modern";
const START_YEAR = 1900;

function formatGameDate(tick: number): string {
  const date = new Date(Date.UTC(START_YEAR, 0, 1 + tick));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function App(): React.JSX.Element {
  const clientRef = useRef<SimulationWorkerClient | undefined>(undefined);
  const tickRef = useRef(0);
  const advancingRef = useRef(false);

  const [connection, setConnection] = useState<ConnectionState>("starting");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [simulationId, setSimulationId] = useState(GAME_ID);
  const [tick, setTick] = useState(0);
  const [speed, setSpeed] = useState<PlaySpeed>(0);
  const [selection, setSelection] = useState<MapSelection | undefined>(undefined);
  const [hovered, setHovered] = useState<MapSelection | undefined>(undefined);
  const [mapDisplay, setMapDisplay] = useState<MapDisplayLookups | undefined>(undefined);
  const [provinceOwners, setProvinceOwners] = useState<Readonly<Record<string, string>>>({});
  const [mapPack, setMapPack] = useState<LoadedMapPack | undefined>(undefined);
  const [workerClient, setWorkerClient] = useState<SimulationWorkerClient | undefined>(undefined);

  const gameLookups = useGameUiLookups(
    workerClient,
    connection === "ready" ? simulationId : undefined,
    mapDisplay,
    provinceOwners,
    mapPack?.demographics,
    selection,
    hovered
  );

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    const client = new SimulationWorkerClient();
    clientRef.current = client;
    setWorkerClient(client);
    let cancelled = false;

    void loadMapPack(`${import.meta.env.BASE_URL}maps/${MAP_ID}`)
      .then(async (pack) => {
        if (cancelled) return;
        setMapPack(pack);
        const scenario = buildScenarioBootstrap(pack);
        const init = await client.initialize(GAME_ID, START_YEAR, scenario);
        if (cancelled) return;
        const owners = (await client.queryOwnershipTable(GAME_ID)).payload;
        if (cancelled) return;
        setProvinceOwners(owners);
        setSimulationId(init.simulationId);
        setTick(init.simulationTick);
        tickRef.current = init.simulationTick;
        setConnection("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setConnection("error");
        setErrorMessage(error instanceof Error ? error.message : "Failed to initialize simulation.");
      });

    return () => {
      cancelled = true;
      client.terminate();
      setWorkerClient(undefined);
    };
  }, []);

  const advanceTicks = useCallback(
    async (count: number): Promise<void> => {
      const client = clientRef.current;
      if (client === undefined || advancingRef.current || connection !== "ready") {
        return;
      }
      advancingRef.current = true;
      try {
        const response = await client.advance(simulationId, tickRef.current, count);
        setTick(response.simulationTick);
        tickRef.current = response.simulationTick;
      } catch (error) {
        setSpeed(0);
        setConnection("error");
        setErrorMessage(error instanceof Error ? error.message : "Failed to advance time.");
      } finally {
        advancingRef.current = false;
      }
    },
    [connection, simulationId]
  );

  useEffect(() => {
    if (connection !== "ready" || speed === 0) {
      return;
    }
    const intervalMs = speed === 1 ? 700 : speed === 5 ? 220 : 80;
    const ticksPerPulse = speed === 30 ? 3 : 1;
    const timer = window.setInterval(() => {
      void advanceTicks(ticksPerPulse);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [advanceTicks, connection, speed]);

  const onSelect = useCallback((next: MapSelection | undefined) => {
    setSelection(next);
  }, []);

  const mapProps = {
    mapId: MAP_ID,
    fill: true as const,
    provinceOwners,
    ...(selection === undefined ? {} : { selection }),
    onSelect,
    onHoverChange: setHovered,
    onMapDisplayChange: setMapDisplay,
    ...(gameLookups === undefined ? {} : { uiLookups: gameLookups })
  };

  return (
    <div className="game-root">
      <header className="game-topbar">
        <div className="game-brand">
          <p className="eyebrow">Economic Simulator</p>
          <h1>World Management</h1>
        </div>

        <TimeControls
          dateLabel={formatGameDate(tick)}
          tick={tick}
          speed={speed}
          disabled={connection !== "ready"}
          onPause={() => setSpeed(0)}
          onPlay={() => setSpeed((current) => (current === 0 ? 1 : current))}
          onSetSpeed={setSpeed}
          onStep={() => void advanceTicks(1)}
        />

        <div className="game-topbar-status" aria-live="polite">
          {connection === "starting" ? "Loading simulation…" : null}
          {connection === "ready" ? "Running" : null}
          {connection === "error" ? (errorMessage ?? "Connection error") : null}
        </div>
      </header>

      <div className="game-main">
        <EntitySelectionPanel
          selection={selection}
          lookups={gameLookups}
          gameDate={formatGameDate(tick)}
          onClose={() => setSelection(undefined)}
        />
        {mapPack === undefined ? (
          <section className="map-panel map-panel-fill" aria-label="World map">
            <p className="map-overlay">Loading world map…</p>
          </section>
        ) : (
          <MapView pack={mapPack} {...mapProps} />
        )}
      </div>
    </div>
  );
}
