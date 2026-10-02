import type { AdjacentClient } from "./client";
import { TIME_RANGES, type TimeRange } from "../../../time-series/range";
import type { ChartResolutionSupport } from "../../../time-series/resolution";

export type AdjacentPriceTier = "public" | "keyed";

export interface AdjacentPriceWindow {
  interval: "1hour" | "1d";
  start?: string;
  end?: string;
  perPage?: number;
  order?: "asc" | "desc";
}

const DAY_MS = 86_400_000;

const TIME_RANGE_DAYS: Record<TimeRange, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "5Y": 1825,
  "ALL": 7300,
};

const HOURLY_MAX_DAYS = 30;

const PUBLIC_START_FLOOR_DAYS: Record<AdjacentPriceWindow["interval"], number> = {
  "1hour": 30,
  "1d": 90,
};

const PUBLIC_RANGES: TimeRange[] = ["1D", "1W", "1M", "3M"];

const PUBLIC_RESOLUTIONS: ChartResolutionSupport[] = [
  { resolution: "1h", maxRange: "1M" },
  { resolution: "1d", maxRange: "3M" },
];

const KEYED_RESOLUTIONS: ChartResolutionSupport[] = [
  { resolution: "1h", maxRange: "1M" },
  { resolution: "1d", maxRange: "ALL" },
];

export function adjacentPriceTier(client: Pick<AdjacentClient, "requestApiKey">): AdjacentPriceTier {
  return client.requestApiKey ? "keyed" : "public";
}

export function adjacentPriceWindow(
  range: TimeRange,
  tier: AdjacentPriceTier,
  bounds?: { start: number | null; end: number | null } | null,
): AdjacentPriceWindow {
  const now = Date.now();
  const rangeStart = bounds?.start ?? null;
  const rangeEnd = bounds?.end ?? null;
  const fromBounds = rangeStart !== null && rangeEnd !== null && rangeStart <= rangeEnd;
  const spanMs = fromBounds ? rangeEnd - rangeStart : TIME_RANGE_DAYS[range] * DAY_MS;
  const interval: AdjacentPriceWindow["interval"] = spanMs < HOURLY_MAX_DAYS * DAY_MS
    ? "1hour"
    : "1d";
  let startMs = fromBounds ? rangeStart : now - spanMs;
  if (tier === "public") {
    const floor = now - PUBLIC_START_FLOOR_DAYS[interval] * DAY_MS;
    if (startMs < floor) startMs = floor;
  }
  const window: AdjacentPriceWindow = {
    interval,
    start: new Date(startMs).toISOString(),
    perPage: 1000,
    order: "asc",
  };
  if (fromBounds) window.end = new Date(rangeEnd).toISOString();
  return window;
}

export function adjacentRangeSupport(tier: AdjacentPriceTier): TimeRange[] {
  return tier === "public" ? [...PUBLIC_RANGES] : [...TIME_RANGES];
}

export function adjacentResolutionSupport(tier: AdjacentPriceTier): ChartResolutionSupport[] {
  const support = tier === "public" ? PUBLIC_RESOLUTIONS : KEYED_RESOLUTIONS;
  return support.map((entry) => ({ ...entry }));
}
