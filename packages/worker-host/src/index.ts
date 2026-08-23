import {
  DeterministicSimulationEngine,
  type SimulationEngine,
  type SimulationSummary
} from "@economic-simulator/simulation-core";
import {
  PROTOCOL_VERSION,
  parseWorkerRequest,
  type WorkerErrorResponse,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerResultResponse
} from "@economic-simulator/simulation-protocol";

function readRequestId(input: unknown): string {
  if (typeof input === "object" && input !== null && "requestId" in input) {
    const requestId = (input as { requestId?: unknown }).requestId;
    if (typeof requestId === "string" && requestId.length > 0) {
      return requestId;
    }
  }
  return "unknown";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown worker host error.";
}

export class SimulationRequestHandler {
  private engine: SimulationEngine | undefined;

  public handle(input: unknown): WorkerResponse {
    let request: WorkerRequest;
    try {
      request = parseWorkerRequest(input);
    } catch (error) {
      return this.error(readRequestId(input), "INVALID_REQUEST", errorMessage(error));
    }

    try {
      if (request.kind === "initialize") {
        this.engine = new DeterministicSimulationEngine(request.payload);
        return this.result(request.requestId, this.engine.getSummary());
      }

      const engine = this.engine;
      if (engine === undefined) {
        return this.error(request.requestId, "NOT_INITIALIZED", "Simulation is not initialized.");
      }

      const targetError = this.validateTarget(request, engine.getSummary());
      if (targetError !== undefined) {
        return targetError;
      }

      switch (request.kind) {
        case "advance":
          return this.result(request.requestId, engine.advance(request.payload.tickCount));
        case "query-summary":
          return this.result(request.requestId, engine.getSummary());
        case "create-snapshot":
          return this.result(request.requestId, engine.createSnapshot());
        case "restore-snapshot":
          return this.result(request.requestId, engine.restoreSnapshot(request.payload.snapshot));
      }
    } catch (error) {
      return this.error(request.requestId, "SIMULATION_ERROR", errorMessage(error));
    }
  }

  private validateTarget(
    request: Exclude<WorkerRequest, { kind: "initialize" }>,
    summary: SimulationSummary
  ): WorkerErrorResponse | undefined {
    if (request.simulationId !== undefined && request.simulationId !== summary.simulationId) {
      return this.error(
        request.requestId,
        "SIMULATION_ID_MISMATCH",
        `Request targeted ${request.simulationId}, active simulation is ${summary.simulationId}.`
      );
    }

    if (request.expectedTick !== undefined && request.expectedTick !== summary.tick) {
      return this.error(
        request.requestId,
        "TICK_MISMATCH",
        `Expected tick ${request.expectedTick}, active tick is ${summary.tick}.`
      );
    }

    return undefined;
  }

  private result<T>(requestId: string, payload: T): WorkerResultResponse<T> {
    const summary = this.requireEngine().getSummary();
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      kind: "result",
      simulationId: summary.simulationId,
      simulationTick: summary.tick,
      payload
    };
  }

  private error(requestId: string, code: string, message: string): WorkerErrorResponse {
    const summary = this.engine?.getSummary();
    if (summary === undefined) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        kind: "error",
        error: { code, message }
      };
    }

    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      kind: "error",
      simulationId: summary.simulationId,
      simulationTick: summary.tick,
      error: { code, message }
    };
  }

  private requireEngine(): SimulationEngine {
    if (this.engine === undefined) {
      throw new Error("Simulation is not initialized.");
    }
    return this.engine;
  }
}
