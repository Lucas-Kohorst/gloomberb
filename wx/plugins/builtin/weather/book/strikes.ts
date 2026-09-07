import { impliedBucketMidpoint } from "../../../../../src/plugins/builtin/weather/implied";
import type { FavoriteStrike, StrikeBucket, StrikeInterval, StrikeYesPoint } from "./types";

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function strikeIntervalFromKalshi(input: {
  strikeType?: string | null;
  floorStrike?: number | null;
  capStrike?: number | null;
}): StrikeInterval | null {
  const kind = input.strikeType?.trim().toLowerCase();
  if (kind === "less" && finite(input.capStrike)) return { kind: "less", cap: input.capStrike };
  if (kind === "greater" && finite(input.floorStrike)) return { kind: "greater", floor: input.floorStrike };
  if (finite(input.floorStrike) && finite(input.capStrike)) {
    return { kind: "between", floor: input.floorStrike, cap: input.capStrike };
  }
  return null;
}

export function strikeLabel(interval: StrikeInterval): string {
  switch (interval.kind) {
    case "less":
      return `≤${interval.cap}`;
    case "greater":
      return `>${interval.floor}`;
    case "between":
      return `${interval.floor}–${interval.cap}`;
  }
}

/**
 * Kalshi daily-high buckets: less is ≤ cap, greater is > floor,
 * between is (floor, cap]. Integer 79 settles in B78.5 (78–79), not T79.
 */
export function strikeContainsTempF(interval: StrikeInterval, tempF: number): boolean {
  if (!Number.isFinite(tempF)) return false;
  switch (interval.kind) {
    case "less":
      return tempF <= interval.cap;
    case "greater":
      return tempF > interval.floor;
    case "between":
      return tempF > interval.floor && tempF <= interval.cap;
  }
}

export function yesPriceAtCutoff(
  path: readonly StrikeYesPoint[],
  cutoffSec: number,
): { yes: number; t: number } | null {
  let best: { yes: number; t: number } | null = null;
  for (const point of path) {
    if (!Number.isFinite(point.t) || !Number.isFinite(point.yes)) continue;
    if (point.t > cutoffSec) continue;
    if (!best || point.t > best.t) best = { yes: point.yes, t: point.t };
  }
  return best;
}

function intervalWidth(interval: StrikeInterval): number {
  if (interval.kind === "between") return interval.cap - interval.floor;
  return Number.POSITIVE_INFINITY;
}

export function favoriteStrikeAtCutoff(
  strikes: readonly StrikeBucket[],
  paths: readonly (readonly StrikeYesPoint[])[],
  cutoffSec: number,
): FavoriteStrike | null {
  let favorite: FavoriteStrike | null = null;
  for (let i = 0; i < strikes.length; i += 1) {
    const bucket = strikes[i];
    const priced = yesPriceAtCutoff(paths[i] ?? [], cutoffSec);
    if (!bucket || !priced || bucket.midpointF == null) continue;
    const candidate: FavoriteStrike = {
      bucket,
      yesPrice: priced.yes,
      midpointF: bucket.midpointF,
      pricedAtSec: priced.t,
    };
    if (!favorite) {
      favorite = candidate;
      continue;
    }
    if (candidate.yesPrice > favorite.yesPrice) {
      favorite = candidate;
      continue;
    }
    if (candidate.yesPrice < favorite.yesPrice) continue;
    const tighter = intervalWidth(candidate.bucket.interval) - intervalWidth(favorite.bucket.interval);
    if (tighter < 0 || (tighter === 0 && candidate.midpointF < favorite.midpointF)) {
      favorite = candidate;
    }
  }
  return favorite;
}

export function favoriteContainsSettlement(favorite: FavoriteStrike, settlementF: number): boolean {
  return strikeContainsTempF(favorite.bucket.interval, settlementF);
}

export function bucketFromMarket(input: {
  ticker: string;
  strikeType?: string | null;
  floorStrike?: number | null;
  capStrike?: number | null;
  result?: string | null;
}): StrikeBucket | null {
  const interval = strikeIntervalFromKalshi(input);
  if (!interval) return null;
  const midpointF = impliedBucketMidpoint({
    yesPrice: 1,
    strikeType: interval.kind,
    floorStrike: interval.kind === "less" ? null : interval.floor,
    capStrike: interval.kind === "greater" ? null : interval.cap,
  });
  const resultRaw = input.result?.trim().toLowerCase();
  const result = resultRaw === "yes" || resultRaw === "no" || resultRaw === "void" ? resultRaw : null;
  return {
    ticker: input.ticker,
    label: strikeLabel(interval),
    interval,
    midpointF,
    result,
  };
}
