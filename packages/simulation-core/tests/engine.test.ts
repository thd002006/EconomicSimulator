import { describe, expect, it } from "vitest";
import { DeterministicSimulationEngine } from "../src";

describe("DeterministicSimulationEngine", () => {
  it("produces the same state for the same seed and command sequence", () => {
    const first = new DeterministicSimulationEngine({ simulationId: "test", seed: 42 });
    const second = new DeterministicSimulationEngine({ simulationId: "test", seed: 42 });

    first.advance(10);
    first.advance(15);
    second.advance(25);

    expect(first.getSummary()).toEqual(second.getSummary());
  });

  it("continues identically after a snapshot round trip", () => {
    const uninterrupted = new DeterministicSimulationEngine({ simulationId: "test", seed: 7 });
    uninterrupted.advance(100);
    const snapshot = uninterrupted.createSnapshot();

    const restored = new DeterministicSimulationEngine({ simulationId: "placeholder", seed: 1 });
    restored.restoreSnapshot(snapshot);

    uninterrupted.advance(50);
    restored.advance(50);

    expect(restored.getSummary()).toEqual(uninterrupted.getSummary());
  });
});
