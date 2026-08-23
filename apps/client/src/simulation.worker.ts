/// <reference lib="webworker" />

import { SimulationRequestHandler } from "@economic-simulator/worker-host";

const host = new SimulationRequestHandler();
const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  workerScope.postMessage(host.handle(event.data));
});

export {};
