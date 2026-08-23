const FALLBACK_SEED = 0x6d2b79f5;

export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new Error("Seed must be a finite number.");
  }

  const normalized = Math.trunc(seed) >>> 0;
  return normalized === 0 ? FALLBACK_SEED : normalized;
}

export function nextXorShift32(state: number): number {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}
