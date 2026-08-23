import { describe, expect, it } from "vitest";
import { DeterministicSimulationEngine } from "@economic-simulator/simulation-core";
import { decodeSave, encodeSave } from "../src";

const metadata = {
  gameVersion: "0.1.0",
  simulationVersion: "0.1.0",
  protocolVersion: 1,
  dataPackVersion: "dev",
  savedAt: "2026-01-01T00:00:00.000Z"
};

describe("save codec", () => {
  it("round-trips a versioned simulation snapshot", () => {
    const engine = new DeterministicSimulationEngine({ simulationId: "save-test", seed: 3 });
    engine.advance(12);

    const save = decodeSave(encodeSave(engine.createSnapshot(), metadata));
    expect(save.snapshot).toEqual(engine.createSnapshot());
  });

  it("detects tampered content", () => {
    const engine = new DeterministicSimulationEngine({ simulationId: "save-test", seed: 3 });
    const encoded = encodeSave(engine.createSnapshot(), metadata);

    expect(() => decodeSave(encoded.replace('"tick":0', '"tick":1'))).toThrow(/checksum/i);
  });
});
