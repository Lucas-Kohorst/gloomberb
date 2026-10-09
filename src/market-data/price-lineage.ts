import type { PricePoint } from "../types/financials";

/** A year with no bars is a reused ticker, not a trading halt. */
const LINEAGE_GAP_MS = 366 * 24 * 60 * 60 * 1000;

function pointTime(value: Date | string | number): number | null {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * The first bar of the current instrument when an older series shares the ticker.
 * The latest gap longer than a year wins. A continuous history returns null.
 */
export function priceLineageStartMs(points: readonly { date: Date | string | number }[]): number | null {
  const times = points
    .map((point) => pointTime(point.date))
    .filter((time): time is number => time != null)
    .sort((left, right) => left - right);
  let start: number | null = null;
  for (let index = 1; index < times.length; index += 1) {
    if (times[index]! - times[index - 1]! >= LINEAGE_GAP_MS) start = times[index]!;
  }
  return start;
}

export function clipPriceHistoryToLineage<T extends { date: Date | string | number }>(points: readonly T[]): T[] {
  const start = priceLineageStartMs(points);
  if (start == null) return [...points];
  return points.filter((point) => {
    const time = pointTime(point.date);
    return time != null && time >= start;
  });
}

export function priceHistoryLineageStart(points: readonly PricePoint[]): number | null {
  return priceLineageStartMs(points);
}
