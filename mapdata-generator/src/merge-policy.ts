import { readFile } from "node:fs/promises";

export interface MergeParameters {
  readonly baseMinimumProvinceAreaKm2: number;
  readonly maximumMinimumProvinceAreaKm2: number;
  readonly fullScaleCountryAreaKm2: number;
  readonly maximumArchipelagoGapKm: number;
  readonly defaultRetainedArcFraction: number;
}

function positiveNumber(value: unknown, key: keyof MergeParameters): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Merge parameter ${key} must be a positive number.`);
  }
  return value;
}

export async function loadMergePolicy(path: string): Promise<MergeParameters> {
  const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const parameters: MergeParameters = {
    baseMinimumProvinceAreaKm2: positiveNumber(
      value.baseMinimumProvinceAreaKm2,
      "baseMinimumProvinceAreaKm2"
    ),
    maximumMinimumProvinceAreaKm2: positiveNumber(
      value.maximumMinimumProvinceAreaKm2,
      "maximumMinimumProvinceAreaKm2"
    ),
    fullScaleCountryAreaKm2: positiveNumber(
      value.fullScaleCountryAreaKm2,
      "fullScaleCountryAreaKm2"
    ),
    maximumArchipelagoGapKm: positiveNumber(
      value.maximumArchipelagoGapKm,
      "maximumArchipelagoGapKm"
    ),
    defaultRetainedArcFraction: positiveNumber(
      value.defaultRetainedArcFraction,
      "defaultRetainedArcFraction"
    )
  };
  if (parameters.maximumMinimumProvinceAreaKm2 < parameters.baseMinimumProvinceAreaKm2) {
    throw new Error("Maximum minimum province area cannot be below its base value.");
  }
  if (parameters.defaultRetainedArcFraction > 1) {
    throw new Error("defaultRetainedArcFraction must be no greater than 1.");
  }
  return parameters;
}

export function dynamicMinimumProvinceAreaKm2(
  countryAreaKm2: number,
  parameters: Pick<
    MergeParameters,
    "baseMinimumProvinceAreaKm2" | "maximumMinimumProvinceAreaKm2" | "fullScaleCountryAreaKm2"
  >
): number {
  const progress = Math.min(Math.max(countryAreaKm2, 0) / parameters.fullScaleCountryAreaKm2, 1);
  return (
    parameters.baseMinimumProvinceAreaKm2 +
    (parameters.maximumMinimumProvinceAreaKm2 - parameters.baseMinimumProvinceAreaKm2) * progress
  );
}
