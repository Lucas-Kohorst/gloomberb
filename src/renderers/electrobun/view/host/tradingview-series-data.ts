import { scalarPointValue } from "../../../../time-series/alignment";
import { isOhlcSeriesStyle } from "../../../../time-series/spec";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../../time-series/types";

export type TradingViewSeriesType = "Line" | "Area" | "Candlestick" | "Histogram";

export function utcTimestampSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function hasOhlc(
  point: TimeSeriesPoint,
): point is TimeSeriesPoint & { open: number; high: number; low: number; close: number } {
  return finite(point.open) && finite(point.high) && finite(point.low) && finite(point.close);
}

/**
 * Collapse to one point per UTC second (latest wins). lightweight-charts rejects
 * duplicate and out-of-order timestamps; live quotes merged onto their bar create both.
 */
export function orderedPointsBySecond(
  points: readonly TimeSeriesPoint[],
): Array<[number, TimeSeriesPoint]> {
  const byTime = new Map<number, TimeSeriesPoint>();
  for (const point of points) {
    const time = point.date.getTime();
    if (Number.isFinite(time)) byTime.set(utcTimestampSeconds(time), point);
  }
  return [...byTime.entries()].sort(([left], [right]) => left - right);
}

/** Creation and data-sync must agree; OHLC styles without OHLC bars fall back to Line. */
export function tradingViewSeriesTypeFor(series: ResolvedSeries): TradingViewSeriesType {
  if (series.style === "columns") return "Histogram";
  if (series.style === "area") return "Area";
  if (isOhlcSeriesStyle(series.style) && series.points.some(hasOhlc)) return "Candlestick";
  return "Line";
}

export function tradingViewCandleData(points: readonly TimeSeriesPoint[]) {
  return orderedPointsBySecond(points).flatMap(([time, point]) => (
    hasOhlc(point)
      ? [{ time, open: point.open, high: point.high, low: point.low, close: point.close }]
      : []
  ));
}

export function tradingViewScalarData(points: readonly TimeSeriesPoint[]) {
  return orderedPointsBySecond(points).flatMap(([time, point]) => {
    const value = scalarPointValue(point);
    return value !== null ? [{ time, value }] : [];
  });
}
