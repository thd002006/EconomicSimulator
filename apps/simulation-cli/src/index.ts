import { DeterministicSimulationEngine } from "@economic-simulator/simulation-core";
import { encodeSave } from "@economic-simulator/save-codec";

function readNumberArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const raw = process.argv[index + 1];
  if (raw === undefined) {
    throw new Error(`${name} requires a value.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  return value;
}

const ticks = readNumberArgument("--ticks", 100);
const seed = readNumberArgument("--seed", 42);
const engine = new DeterministicSimulationEngine({ simulationId: "cli-probe", seed });
const result = engine.advance(ticks);
const save = encodeSave(engine.createSnapshot(), {
  gameVersion: "0.1.0",
  simulationVersion: "0.1.0",
  protocolVersion: 1,
  dataPackVersion: "dev",
  savedAt: new Date(0).toISOString()
});

console.log(
  JSON.stringify(
    {
      mode: "architecture-probe",
      result,
      encodedSaveBytes: Buffer.byteLength(save, "utf8")
    },
    null,
    2
  )
);
