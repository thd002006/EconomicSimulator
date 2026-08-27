import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@economic-simulator/simulation-protocol";
import { SimulationRequestHandler } from "../src";

const miniScenario = {
  mapId: "test",
  provinces: [
    {
      id: "A",
      ownerCountryId: "AAA",
      demographics: {
        pop: 1000,
        male: 500,
        female: 500,
        age: {
          child_0_14: 240,
          youth_15_24: 120,
          prime_25_44: 300,
          mature_45_64: 220,
          senior_65_plus: 120
        },
        education15Plus: { basic: 400, secondary: 350, tertiary: 180, advanced: 70 }
      }
    },
    {
      id: "B",
      ownerCountryId: "BBB",
      demographics: {
        pop: 200,
        male: 100,
        female: 100,
        age: {
          child_0_14: 48,
          youth_15_24: 24,
          prime_25_44: 60,
          mature_45_64: 44,
          senior_65_plus: 24
        },
        education15Plus: { basic: 80, secondary: 70, tertiary: 36, advanced: 14 }
      }
    }
  ]
};

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

  it("answers population and ownership queries after scenario bootstrap", () => {
    const host = new SimulationRequestHandler();
    host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "init",
      kind: "initialize",
      payload: { simulationId: "world-test", seed: 7, scenario: miniScenario }
    });

    const owners = host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "owners",
      simulationId: "world-test",
      kind: "query-ownership-table",
      payload: {}
    });
    expect(owners.kind).toBe("result");
    if (owners.kind === "result") {
      expect(owners.payload).toEqual({ A: "AAA", B: "BBB" });
    }

    const province = host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "province",
      simulationId: "world-test",
      kind: "query-province-population",
      payload: { provinceId: "A" }
    });
    expect(province.kind).toBe("result");
    if (province.kind === "result") {
      expect((province.payload as { summary: { populationPersons: number } }).summary.populationPersons).toBe(
        1000
      );
    }

    const country = host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "country",
      simulationId: "world-test",
      kind: "query-country-population",
      payload: { countryId: "AAA" }
    });
    expect(country.kind).toBe("result");
    if (country.kind === "result") {
      expect((country.payload as { populationPersons: number }).populationPersons).toBe(1000);
    }
  });
});
