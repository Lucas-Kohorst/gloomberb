import type { PricePoint } from "../types/financials";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function bucketStartMs(timestampMs: number): number {
  return Math.floor(timestampMs / FOUR_HOURS_MS) * FOUR_HOURS_MS;
}

export function aggregateTo4h(points: readonly PricePoint[]): PricePoint[] {
  if (points.length === 0) return [];
  const buckets = new Map<number, PricePoint[]>();
  for (const point of points) {
    const ts = point.date.getTime();
    if (!Number.isFinite(ts)) continue;
    const key = bucketStartMs(ts);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }
  const result: PricePoint[] = [];
  for (const [bucketMs, bucket] of buckets) {
    bucket.sort((left, right) => left.date.getTime() - right.date.getTime());
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
    result.push({
      date: new Date(bucketMs),
      open: first.open ?? first.close,
      high,
      low,
      close: last.close,
      volume: hasVolume ? volume : undefined,
    });
  }
  result.sort((left, right) => left.date.getTime() - right.date.getTime());
  return result;
}
