import {
  pricePointsToResolvedSeries,
  type PricePointsToResolvedSeriesOptions,
} from "../../../../components/chart/composite";
import type { ResolvedSeries } from "../../../../time-series/types";
import type { PricePoint, Quote } from "../../../../types/financials";

function patchHistoryLastClose(
  history: readonly PricePoint[],
  quote: Quote | null | undefined,
): readonly PricePoint[] {
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return history;
  const last = history.at(-1);
  if (!last) return history;
  if (last.close === quote.price) return history;
  return [
    ...history.slice(0, -1),
    {
      ...last,
      close: quote.price,
      high: last.high != null ? Math.max(last.high, quote.price) : last.high,
      low: last.low != null ? Math.min(last.low, quote.price) : last.low,
    },
  ];
}

function canPatchLastBar(
  previous: ResolvedSeries,
  liveHistory: readonly PricePoint[],
  options: PricePointsToResolvedSeriesOptions,
): boolean {
  if (previous.id !== options.id) return false;
  if (previous.points.length !== liveHistory.length || liveHistory.length === 0) return false;
  const lastPrev = previous.points.at(-1);
  const lastLive = liveHistory.at(-1);
  if (!lastPrev || !lastLive) return false;
  const liveTime = lastLive.date instanceof Date ? lastLive.date.getTime() : new Date(lastLive.date).getTime();
  return lastPrev.date.getTime() === liveTime;
}

function patchLastBar(
  previous: ResolvedSeries,
  liveHistory: readonly PricePoint[],
  options: PricePointsToResolvedSeriesOptions,
): ResolvedSeries {
  const lastLive = liveHistory.at(-1)!;
  const lastPrev = previous.points.at(-1)!;
  const close = lastLive.close;
  const open = lastLive.open ?? lastPrev.open;
  const high = lastLive.high ?? lastPrev.high;
  const low = lastLive.low ?? lastPrev.low;
  const volume = lastLive.volume ?? lastPrev.volume;
  const unchanged = lastPrev.close === close
    && lastPrev.value === close
    && lastPrev.open === (open ?? null)
    && lastPrev.high === (high ?? null)
    && lastPrev.low === (low ?? null)
    && lastPrev.volume === (volume ?? null)
    && previous.color === options.color
    && previous.label === options.label
    && previous.unit === options.unit;
  if (unchanged) return previous;
  return {
    ...previous,
    color: options.color,
    label: options.label,
    unit: options.unit,
    points: [
      ...previous.points.slice(0, -1),
      {
        ...lastPrev,
        value: close,
        open: open ?? null,
        high: high ?? null,
        low: low ?? null,
        close,
        volume: volume ?? null,
      },
    ],
  };
}

/** Resolve overview price history, patching only the live last bar when possible. */
export function resolveOverviewPriceSeries(
  history: readonly PricePoint[],
  quote: Quote | null | undefined,
  options: PricePointsToResolvedSeriesOptions,
  previous: ResolvedSeries | null,
): ResolvedSeries {
  const liveHistory = patchHistoryLastClose(history, quote);
  if (previous && canPatchLastBar(previous, liveHistory, options)) {
    return patchLastBar(previous, liveHistory, options);
  }
  return pricePointsToResolvedSeries(liveHistory as PricePoint[], options);
}
