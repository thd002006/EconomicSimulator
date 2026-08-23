import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, parseWorkerRequest } from "../src";

describe("simulation protocol", () => {
  it("accepts a valid initialize request", () => {
    expect(
      parseWorkerRequest({
        protocolVersion: PROTOCOL_VERSION,
        requestId: "1",
        kind: "initialize",
        payload: { simulationId: "probe", seed: 42 }
      }).kind
    ).toBe("initialize");
  });

  it("rejects incompatible protocol versions", () => {
    expect(() =>
      parseWorkerRequest({
        protocolVersion: 999,
        requestId: "1",
        kind: "query-summary",
        payload: {}
      })
    ).toThrow();
  });
});
