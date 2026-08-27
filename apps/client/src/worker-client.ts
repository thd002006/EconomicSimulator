import {
  PROTOCOL_VERSION,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerResultResponse
} from "@economic-simulator/simulation-protocol";
import type {
  CountryPopulationSummary,
  ProvincePopulationQueryResult,
  ScenarioBootstrap
} from "@economic-simulator/simulation-core";

interface PendingRequest {
  readonly resolve: (response: WorkerResultResponse) => void;
  readonly reject: (error: Error) => void;
}

export class SimulationWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();

  public constructor() {
    this.worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), {
      type: "module",
      name: "economic-simulation-worker"
    });
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onWorkerError);
  }

  public initialize(
    simulationId: string,
    seed: number,
    scenario?: ScenarioBootstrap
  ): Promise<WorkerResultResponse> {
    const payload = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      kind: "initialize" as const,
      payload: {
        simulationId,
        seed,
        ...(scenario === undefined
          ? {}
          : { scenario: structuredClone(scenario) as ScenarioBootstrap })
      }
    };
    return this.send(payload as WorkerRequest);
  }

  public advance(
    simulationId: string,
    expectedTick: number,
    tickCount: number
  ): Promise<WorkerResultResponse> {
    return this.send({
      protocolVersion: PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      simulationId,
      expectedTick,
      kind: "advance",
      payload: { tickCount }
    });
  }

  public queryProvincePopulation(
    simulationId: string,
    provinceId: string
  ): Promise<WorkerResultResponse<ProvincePopulationQueryResult>> {
    return this.send({
      protocolVersion: PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      simulationId,
      kind: "query-province-population",
      payload: { provinceId }
    }) as Promise<WorkerResultResponse<ProvincePopulationQueryResult>>;
  }

  public queryCountryPopulation(
    simulationId: string,
    countryId: string
  ): Promise<WorkerResultResponse<CountryPopulationSummary>> {
    return this.send({
      protocolVersion: PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      simulationId,
      kind: "query-country-population",
      payload: { countryId }
    }) as Promise<WorkerResultResponse<CountryPopulationSummary>>;
  }

  public queryProvinceOwner(
    simulationId: string,
    provinceId: string
  ): Promise<WorkerResultResponse<{ ownerCountryId: string | undefined }>> {
    return this.send({
      protocolVersion: PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      simulationId,
      kind: "query-province-owner",
      payload: { provinceId }
    }) as Promise<WorkerResultResponse<{ ownerCountryId: string | undefined }>>;
  }

  public queryOwnershipTable(
    simulationId: string
  ): Promise<WorkerResultResponse<Readonly<Record<string, string>>>> {
    return this.send({
      protocolVersion: PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      simulationId,
      kind: "query-ownership-table",
      payload: {}
    }) as Promise<WorkerResultResponse<Readonly<Record<string, string>>>>;
  }

  public createSnapshot(simulationId: string): Promise<WorkerResultResponse> {
    return this.send({
      protocolVersion: PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      simulationId,
      kind: "create-snapshot",
      payload: {}
    });
  }

  public restoreSnapshot(simulationId: string, snapshot: unknown): Promise<WorkerResultResponse> {
    return this.send({
      protocolVersion: PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      simulationId,
      kind: "restore-snapshot",
      payload: { snapshot }
    });
  }

  public terminate(): void {
    this.worker.terminate();
    for (const request of this.pending.values()) {
      request.reject(new Error("Simulation worker terminated."));
    }
    this.pending.clear();
  }

  private send(request: WorkerRequest): Promise<WorkerResultResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private readonly onMessage = (event: MessageEvent<WorkerResponse>): void => {
    const response = event.data;
    if (response.kind === "event") {
      return;
    }

    const request = this.pending.get(response.requestId);
    if (request === undefined) {
      return;
    }
    this.pending.delete(response.requestId);

    if (response.kind === "error") {
      request.reject(new Error(`${response.error.code}: ${response.error.message}`));
      return;
    }
    request.resolve(response);
  };

  private readonly onWorkerError = (event: ErrorEvent): void => {
    const error = new Error(event.message || "Simulation worker failed.");
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  };
}
