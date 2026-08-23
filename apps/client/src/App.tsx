import { useCallback, useEffect, useRef, useState } from "react";
import type { ProvinceFeature } from "@economic-simulator/map-runtime";
import { MapView } from "./components/MapView";
import { ProvinceInspector } from "./components/ProvinceInspector";
import { TimeControls, type PlaySpeed } from "./components/TimeControls";
import { SimulationWorkerClient } from "./worker-client";

type ConnectionState = "starting" | "ready" | "error";

const GAME_ID = "world-campaign";
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
  const [selectedProvince, setSelectedProvince] = useState<ProvinceFeature | undefined>(undefined);
  const [provinceOwners] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    const client = new SimulationWorkerClient();
    clientRef.current = client;
    void client
      .initialize(GAME_ID, START_YEAR)
      .then((response) => {
        setSimulationId(response.simulationId);
        setTick(response.simulationTick);
        tickRef.current = response.simulationTick;
        setConnection("ready");
      })
      .catch((error: unknown) => {
        setConnection("error");
        setErrorMessage(error instanceof Error ? error.message : "模拟初始化失败。");
      });

    return () => client.terminate();
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
        setErrorMessage(error instanceof Error ? error.message : "时间推进失败。");
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

  const onSelectProvince = useCallback(
    (_provinceId: string | undefined, feature: ProvinceFeature | undefined) => {
      setSelectedProvince(feature);
    },
    []
  );

  const selectedOwner =
    selectedProvince === undefined
      ? undefined
      : (provinceOwners[selectedProvince.id] ?? selectedProvince.properties.adm0A3);

  const mapProps =
    selectedProvince === undefined
      ? {
          mapId: "world-modern" as const,
          fill: true as const,
          provinceOwners,
          onSelectProvince
        }
      : {
          mapId: "world-modern" as const,
          fill: true as const,
          provinceOwners,
          selectedProvinceId: selectedProvince.id,
          onSelectProvince
        };

  return (
    <div className="game-root">
      <header className="game-topbar">
        <div className="game-brand">
          <p className="eyebrow">Economic Simulator</p>
          <h1>世界经营</h1>
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
          {connection === "starting" ? "正在载入模拟…" : null}
          {connection === "ready" ? "运行中" : null}
          {connection === "error" ? (errorMessage ?? "连接异常") : null}
        </div>
      </header>

      <div className="game-main">
        <MapView {...mapProps} />
        <ProvinceInspector
          feature={selectedProvince}
          {...(selectedOwner === undefined ? {} : { ownerId: selectedOwner })}
          gameDate={formatGameDate(tick)}
        />
      </div>
    </div>
  );
}
