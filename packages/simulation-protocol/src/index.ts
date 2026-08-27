import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

const RequestBaseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string().min(1),
  simulationId: z.string().min(1).optional(),
  expectedTick: z.number().int().nonnegative().optional()
});

const ScenarioProvinceDemographicsSchema = z.object({
  pop: z.number().finite(),
  male: z.number().finite(),
  female: z.number().finite(),
  age: z.record(z.string(), z.number().finite()),
  education15Plus: z.record(z.string(), z.number().finite())
});

const ScenarioProvinceBootstrapSchema = z.object({
  id: z.string().min(1),
  ownerCountryId: z.string().min(1),
  demographics: ScenarioProvinceDemographicsSchema.optional()
});

const ScenarioBootstrapSchema = z.object({
  mapId: z.string().min(1),
  provinces: z.array(ScenarioProvinceBootstrapSchema).min(1)
});

export const WorkerRequestSchema = z.discriminatedUnion("kind", [
  RequestBaseSchema.extend({
    kind: z.literal("initialize"),
    payload: z.object({
      simulationId: z.string().min(1),
      seed: z.number().finite(),
      scenario: ScenarioBootstrapSchema.optional()
    })
  }),
  RequestBaseSchema.extend({
    kind: z.literal("advance"),
    payload: z.object({ tickCount: z.number().int().min(0).max(1_000_000) })
  }),
  RequestBaseSchema.extend({
    kind: z.literal("query-summary"),
    payload: z.object({})
  }),
  RequestBaseSchema.extend({
    kind: z.literal("query-province-population"),
    payload: z.object({ provinceId: z.string().min(1) })
  }),
  RequestBaseSchema.extend({
    kind: z.literal("query-country-population"),
    payload: z.object({ countryId: z.string().min(1) })
  }),
  RequestBaseSchema.extend({
    kind: z.literal("query-province-owner"),
    payload: z.object({ provinceId: z.string().min(1) })
  }),
  RequestBaseSchema.extend({
    kind: z.literal("query-ownership-table"),
    payload: z.object({})
  }),
  RequestBaseSchema.extend({
    kind: z.literal("create-snapshot"),
    payload: z.object({})
  }),
  RequestBaseSchema.extend({
    kind: z.literal("restore-snapshot"),
    payload: z.object({ snapshot: z.unknown() })
  })
]);

export type WorkerRequest = z.infer<typeof WorkerRequestSchema>;
export type WorkerRequestKind = WorkerRequest["kind"];

export interface WorkerResultResponse<T = unknown> {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "result";
  readonly simulationId: string;
  readonly simulationTick: number;
  readonly payload: T;
}

export interface WorkerErrorResponse {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "error";
  readonly simulationId?: string;
  readonly simulationTick?: number;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

export interface WorkerEventResponse<T = unknown> {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly kind: "event";
  readonly simulationId: string;
  readonly simulationTick: number;
  readonly eventType: string;
  readonly payload: T;
}

export type WorkerResponse = WorkerResultResponse | WorkerErrorResponse | WorkerEventResponse;

export function parseWorkerRequest(input: unknown): WorkerRequest {
  return WorkerRequestSchema.parse(input);
}
