export type KalshiStrikeType = "less" | "greater" | "between" | string;

export interface WeatherImpliedBucket {
  yesPrice: number | null;
  strikeType?: KalshiStrikeType | null;
  floorStrike?: number | null;
  capStrike?: number | null;
}

export interface WeatherImpliedForecast {
  implied: number;
  weightSum: number;
  buckets: number;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Integer °F midpoint for a mutually exclusive Kalshi temperature bucket. */
export function impliedBucketMidpoint(bucket: WeatherImpliedBucket): number | null {
  const floor = finite(bucket.floorStrike) ? bucket.floorStrike : null;
  const cap = finite(bucket.capStrike) ? bucket.capStrike : null;
  const kind = bucket.strikeType?.trim().toLowerCase();
  if (kind === "less") {
    if (cap == null) return null;
    return cap - 1;
  }
  if (kind === "greater") {
    if (floor == null) return null;
    return floor + 1;
  }
  if (floor != null && cap != null) return (floor + cap) / 2;
  if (floor != null) return floor;
  if (cap != null) return cap;
  return null;
}

/**
 * Probability-weighted expected temperature. Open events use live yes-prices;
 * settled 0/1 books collapse to the paying bucket.
 */
export function kalshiWeightedImpliedTemp(
  buckets: readonly WeatherImpliedBucket[],
): WeatherImpliedForecast | null {
  let weighted = 0;
  let weightSum = 0;
  let used = 0;
  for (const bucket of buckets) {
    const midpoint = impliedBucketMidpoint(bucket);
    const weight = finite(bucket.yesPrice) ? Math.max(0, bucket.yesPrice) : 0;
    if (midpoint == null || weight <= 0) continue;
    weighted += weight * midpoint;
    weightSum += weight;
    used += 1;
  }
  if (used === 0 || weightSum <= 0) return null;
  return {
    implied: weighted / weightSum,
    weightSum,
    buckets: used,
  };
}

export function roundImpliedTemp(value: number): number {
  return Math.round(value);
}

/** Max bucket share of total yes-weight that still counts as a live book. */
export const SETTLED_IMPLIED_DOMINANCE = 0.9;

/** True when one bucket holds essentially all the weight (settled 0/1). */
export function impliedBookLooksSettled(buckets: readonly WeatherImpliedBucket[]): boolean {
  let max = 0;
  let sum = 0;
  for (const bucket of buckets) {
    const weight = finite(bucket.yesPrice) ? Math.max(0, bucket.yesPrice) : 0;
    if (weight <= 0) continue;
    max = Math.max(max, weight);
    sum += weight;
  }
  return sum <= 0 || max / sum >= SETTLED_IMPLIED_DOMINANCE;
}
