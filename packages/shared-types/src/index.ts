export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type SimulationId = Brand<string, "SimulationId">;
export type EntityId = Brand<string, "EntityId">;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface StructuredError {
  readonly code: string;
  readonly message: string;
  readonly details?: JsonValue;
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
