import type { PricePoint } from "../../types/financials";
import type { TimeRange } from "../../time-series/range";
import {
  normalizeChartResolutionSupport,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../../time-series/resolution";
import { aggregateTo4h } from "../../time-series/aggregate";

export const COINGECKO_RESOLUTION_SUPPORT = normalizeChartResolutionSupport([
  { resolution: "5m", maxRange: "1D" },
  { resolution: "1h", maxRange: "3M" },
  { resolution: "4h", maxRange: "3M" },
  { resolution: "1d", maxRange: "ALL" },
  { resolution: "1wk", maxRange: "ALL" },
  { resolution: "1mo", maxRange: "ALL" },
]);

export function getCoinGeckoChartResolutionSupport(): ChartResolutionSupport[] {
  return COINGECKO_RESOLUTION_SUPPORT;
}

const RANGE_DAYS: Record<TimeRange, string> = {
  "1D": "1",
  "1W": "7",
  "1M": "30",
  "3M": "90",
  "6M": "180",
  "1Y": "365",
  "5Y": "max",
  "ALL": "max",
};

export function coinGeckoDaysForRange(range: TimeRange): string {
  return RANGE_DAYS[range];
}

export function coinGeckoDaysForResolution(
  bufferRange: TimeRange,
  resolution: ManualChartResolution,
): string {
  if (resolution === "5m" || resolution === "15m" || resolution === "30m" || resolution === "45m") {
    return "1";
  }
  if (resolution === "1h" || resolution === "4h") {
    return bufferRange === "1D" || bufferRange === "1W" || bufferRange === "1M"
      ? RANGE_DAYS[bufferRange]
      : "90";
  }
  return RANGE_DAYS[bufferRange];
}

export function mapCoinGeckoMarketChart(
  prices: ReadonlyArray<readonly [number, number]>,
  volumes?: ReadonlyArray<readonly [number, number]>,
): PricePoint[] {
  const volumeByTs = new Map<number, number>();
  for (const point of volumes ?? []) {
    const ts = point[0];
    const volume = point[1];
    if (Number.isFinite(ts) && Number.isFinite(volume)) volumeByTs.set(ts, volume);
  }
  const history: PricePoint[] = [];
  for (const point of prices) {
    const ts = point[0];
    const close = point[1];
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    history.push({
      date: new Date(ts),
      open: close,
      high: close,
      low: close,
      close,
      volume: volumeByTs.get(ts),
    });
  }
  history.sort((left, right) => left.date.getTime() - right.date.getTime());
  return history;
}

export function mapCoinGeckoOhlc(
  rows: ReadonlyArray<readonly [number, number, number, number, number]>,
): PricePoint[] {
  const history: PricePoint[] = [];
  for (const row of rows) {
    const [ts, open, high, low, close] = row;
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    history.push({
      date: new Date(ts),
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
    });
  }
  history.sort((left, right) => left.date.getTime() - right.date.getTime());
  return history;
}

function periodKey(date: Date, resolution: "1wk" | "1mo"): string {
  const year = date.getUTCFullYear();
  if (resolution === "1mo") return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const monday = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
  const weekday = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return monday.toISOString().slice(0, 10);
}

export function aggregateCoinGeckoHistory(
  points: readonly PricePoint[],
  resolution: ManualChartResolution,
): PricePoint[] {
  if (resolution === "4h") return aggregateTo4h(points);
  if (resolution !== "1wk" && resolution !== "1mo") return [...points];
  const groups = new Map<string, PricePoint[]>();
  for (const point of points) {
    const key = periodKey(point.date, resolution);
    const bucket = groups.get(key) ?? [];
    bucket.push(point);
    groups.set(key, bucket);
  }
  const aggregated: PricePoint[] = [];
  for (const bucket of groups.values()) {
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    let high = first.high ?? first.close;
    let low = first.low ?? first.close;
    let volume = 0;
    let hasVolume = false;
    for (const point of bucket) {
      high = Math.max(high, point.high ?? point.close);
      low = Math.min(low, point.low ?? point.close);
      if (point.volume != null) {
        volume += point.volume;
        hasVolume = true;
      }
    }
    aggregated.push({
      date: last.date,
      open: first.open ?? first.close,
      high,
      low,
      close: last.close,
      volume: hasVolume ? volume : undefined,
    });
  }
  aggregated.sort((left, right) => left.date.getTime() - right.date.getTime());
  return aggregated;
}
