import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@economic-simulator/simulation-protocol";
import { SimulationRequestHandler } from "../src";

describe("SimulationRequestHandler", () => {
  it("requires initialization before commands", () => {
    const host = new SimulationRequestHandler();
    const response = host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "before-init",
      kind: "query-summary",
      payload: {}
    });

    expect(response.kind).toBe("error");
    if (response.kind === "error") {
      expect(response.error.code).toBe("NOT_INITIALIZED");
    }
  });

  it("initializes and advances through the versioned protocol", () => {
    const host = new SimulationRequestHandler();
    host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "init",
      kind: "initialize",
      payload: { simulationId: "worker-test", seed: 42 }
    });

    const response = host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "advance",
      simulationId: "worker-test",
      expectedTick: 0,
      kind: "advance",
      payload: { tickCount: 10 }
    });

    expect(response.kind).toBe("result");
    expect(response.simulationTick).toBe(10);
  });
});
