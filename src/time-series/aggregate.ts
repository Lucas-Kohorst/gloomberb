import type { PricePoint } from "../types/financials";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/** An exchange timezone keeps four-hour equity candles aligned across DST. */
export function aggregateTo4h(points: readonly PricePoint[], timeZone?: string): PricePoint[] {
  const clock = timeZone ? new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }) : null;
  const bucketStartMs = (timestampMs: number): number => {
    if (!clock) return Math.floor(timestampMs / FOUR_HOURS_MS) * FOUR_HOURS_MS;
    const parts = clock.formatToParts(timestampMs);
    const hour = Number(parts.find((part) => part.type === "hour")!.value);
    const minute = Number(parts.find((part) => part.type === "minute")!.value);
    return Math.floor(timestampMs / 60_000) * 60_000 - ((hour * 60 + minute) % 240) * 60_000;
  };
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
