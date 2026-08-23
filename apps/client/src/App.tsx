import { useCallback, useEffect, useRef, useState } from "react";
import {
  PROTOCOL_VERSION,
  type WorkerResultResponse
} from "@economic-simulator/simulation-protocol";
import { SimulationWorkerClient } from "./worker-client";

type ConnectionState = "starting" | "online" | "error";

function payloadFingerprint(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "stateFingerprint" in payload) {
    const value = (payload as { stateFingerprint?: unknown }).stateFingerprint;
    return typeof value === "string" ? value : "—";
  }
  if (typeof payload === "object" && payload !== null && "summary" in payload) {
    return payloadFingerprint((payload as { summary?: unknown }).summary);
  }
  return "—";
}

export function App(): React.JSX.Element {
  const clientRef = useRef<SimulationWorkerClient | undefined>(undefined);
  const snapshotRef = useRef<unknown>(undefined);
  const [connection, setConnection] = useState<ConnectionState>("starting");
  const [simulationId, setSimulationId] = useState("architecture-probe");
  const [tick, setTick] = useState(0);
  const [fingerprint, setFingerprint] = useState("—");
  const [message, setMessage] = useState("正在启动独立模拟线程…");
  const [busy, setBusy] = useState(false);

  const applyResponse = useCallback((response: WorkerResultResponse) => {
    setSimulationId(response.simulationId);
    setTick(response.simulationTick);
    const nextFingerprint = payloadFingerprint(response.payload);
    if (nextFingerprint !== "—") {
      setFingerprint(nextFingerprint);
    }
  }, []);

  useEffect(() => {
    const client = new SimulationWorkerClient();
    clientRef.current = client;
    void client
      .initialize("architecture-probe", 42)
      .then((response) => {
        applyResponse(response);
        setConnection("online");
        setMessage("Worker、协议与 Simulation Core 已贯通。");
      })
      .catch((error: unknown) => {
        setConnection("error");
        setMessage(error instanceof Error ? error.message : "初始化失败。");
      });

    return () => client.terminate();
  }, [applyResponse]);

  const run = useCallback(
    async (
      operation: (client: SimulationWorkerClient) => Promise<WorkerResultResponse>,
      label: string
    ) => {
      const client = clientRef.current;
      if (client === undefined) {
        return;
      }
      setBusy(true);
      try {
        const response = await operation(client);
        applyResponse(response);
        setMessage(label);
      } catch (error) {
        setConnection("error");
        setMessage(error instanceof Error ? error.message : "操作失败。");
      } finally {
        setBusy(false);
      }
    },
    [applyResponse]
  );

  const createSnapshot = useCallback(() => {
    void run(async (client) => {
      const response = await client.createSnapshot(simulationId);
      snapshotRef.current = response.payload;
      return response;
    }, "内存快照已创建。");
  }, [run, simulationId]);

  const restoreSnapshot = useCallback(() => {
    if (snapshotRef.current === undefined) {
      setMessage("请先创建快照。");
      return;
    }
    void run(
      (client) => client.restoreSnapshot(simulationId, snapshotRef.current),
      "快照已恢复，确定性状态边界有效。"
    );
  }, [run, simulationId]);

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">ECONOMIC SIMULATOR</p>
        <h1>架构探针</h1>
        <p className="intro">当前页面只验证基础设施，不包含任何经济玩法。</p>
      </header>

      <section className="status-grid" aria-label="架构状态">
        <article className="status-card">
          <span>Simulation Worker</span>
          <strong className={`status-${connection}`}>
            {connection === "online" ? "ONLINE" : connection.toUpperCase()}
          </strong>
        </article>
        <article className="status-card">
          <span>Protocol</span>
          <strong>v{PROTOCOL_VERSION}</strong>
        </article>
        <article className="status-card">
          <span>Simulation ID</span>
          <strong>{simulationId}</strong>
        </article>
        <article className="status-card">
          <span>Current Tick</span>
          <strong>{tick.toLocaleString()}</strong>
        </article>
      </section>

      <section className="probe-panel">
        <div>
          <p className="label">状态指纹</p>
          <code>{fingerprint}</code>
        </div>
        <div className="actions">
          <button
            disabled={busy || connection !== "online"}
            onClick={() =>
              void run((client) => client.advance(simulationId, tick, 1), "已推进 1 Tick。")
            }
          >
            +1 Tick
          </button>
          <button
            disabled={busy || connection !== "online"}
            onClick={() =>
              void run((client) => client.advance(simulationId, tick, 100), "已推进 100 Tick。")
            }
          >
            +100 Ticks
          </button>
          <button disabled={busy || connection !== "online"} onClick={createSnapshot}>
            创建快照
          </button>
          <button disabled={busy || connection !== "online"} onClick={restoreSnapshot}>
            恢复快照
          </button>
        </div>
        <p className={`message message-${connection}`}>{message}</p>
      </section>

      <footer>React UI → Versioned Protocol → Web Worker Host → Pure TypeScript Core</footer>
    </main>
  );
}
