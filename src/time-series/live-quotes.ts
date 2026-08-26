import { canonicalTimeSeriesFieldId, isMarketFieldId } from "./field-catalog";
import type { DataProvider, QuoteSubscriptionTarget } from "../types/data-provider";
import type { PricePoint, Quote } from "../types/financials";
import type { BrokerContractRef } from "../types/instrument";
import {
  type ChartResolutionResult,
  type ChartSeriesSpec,
  type ChartSpec,
  type ResolvedSeries,
  type SecuritySeriesSource,
  type TimeSeriesPoint,
} from "./types";
import { activeStudyInputSeriesIds } from "./studies";
import { valuationSeriesUsesLiveQuote } from "./fundamentals";
import { appendLiveQuotePoint } from "./chart-data";
import {
  CHART_RESOLUTION_STEP_MS,
  type ManualChartResolution,
} from "./resolution";

export const LIVE_CHART_REFRESH_INTERVAL_MS = 5_000;

function normalized(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function quoteIdentityKey(identity: {
  symbol: string;
  exchange?: string;
  brokerId?: string;
  brokerInstanceId?: string;
  instrument?: BrokerContractRef | null;
}): string {
  const contractKey = identity.instrument?.conId
    ?? identity.instrument?.localSymbol
    ?? identity.instrument?.symbol
    ?? "";
  return [
    normalized(identity.symbol),
    normalized(identity.exchange),
    identity.brokerId ?? "",
    identity.brokerInstanceId ?? "",
    contractKey,
  ].join("|");
}

export function chartQuoteOverrideKeyForSource(source: SecuritySeriesSource): string {
  return quoteIdentityKey({
    symbol: source.instrument.symbol,
    exchange: source.instrument.exchange,
    brokerId: source.instrument.brokerId,
    brokerInstanceId: source.instrument.brokerInstanceId,
    instrument: source.instrument.instrument,
  });
}

export function chartQuoteOverrideKeyForTarget(target: QuoteSubscriptionTarget): string {
  return quoteIdentityKey({
    symbol: target.symbol,
    exchange: target.exchange,
    brokerId: target.context?.brokerId,
    brokerInstanceId: target.context?.brokerInstanceId,
    instrument: target.context?.instrument,
  });
}

function supportsLiveQuote(
  series: ChartSeriesSpec,
  activeStudyInputs: ReadonlySet<string>,
): series is ChartSeriesSpec & {
  source: SecuritySeriesSource;
} {
  if ((series.visible === false && !activeStudyInputs.has(series.id)) || series.source.kind !== "security") {
    return false;
  }
  const fieldId = canonicalTimeSeriesFieldId(series.source.fieldId);
  return isMarketFieldId(fieldId) || valuationSeriesUsesLiveQuote(fieldId);
}

/** Displayed or study-required quote-sensitive instruments, deduplicated by routing identity. */
export function getLiveChartQuoteTargets(spec: ChartSpec): QuoteSubscriptionTarget[] {
  const targets = new Map<string, QuoteSubscriptionTarget>();
  const activeStudyInputs = activeStudyInputSeriesIds(spec.studies);
  for (const series of spec.series) {
    if (!supportsLiveQuote(series, activeStudyInputs)) continue;
    const target: QuoteSubscriptionTarget = {
      symbol: series.source.instrument.symbol,
      exchange: series.source.instrument.exchange,
      context: {
        brokerId: series.source.instrument.brokerId,
        brokerInstanceId: series.source.instrument.brokerInstanceId,
        instrument: series.source.instrument.instrument ?? null,
      },
      surface: "detail",
      visible: true,
      weight: 1,
    };
    targets.set(chartQuoteOverrideKeyForTarget(target), target);
  }
  return [...targets.values()];
}

export function liveChartQuoteTargetSignature(spec: ChartSpec): string {
  return getLiveChartQuoteTargets(spec)
    .map(chartQuoteOverrideKeyForTarget)
    .sort()
    .join("\n");
}

function isNewerQuote(next: Quote, current: Quote | undefined): boolean {
  if (!current) return true;
  if (next.lastUpdated !== current.lastUpdated) return next.lastUpdated > current.lastUpdated;
  return (next.receivedAt ?? 0) > (current.receivedAt ?? 0);
}

function hasResolutionRelevantChange(next: Quote, current: Quote | undefined): boolean {
  if (!current) return true;
  return next.lastUpdated !== current.lastUpdated
    || next.price !== current.price
    || next.currency !== current.currency
    || next.providerId !== current.providerId
    || next.marketState !== current.marketState
    || next.preMarketPrice !== current.preMarketPrice
    || next.postMarketPrice !== current.postMarketPrice
    || next.exchangeName !== current.exchangeName
    || next.listingExchangeName !== current.listingExchangeName;
}

function livePriceFieldId(fieldId: string): string | null {
  const canonical = canonicalTimeSeriesFieldId(fieldId);
  if (
    canonical === "market.ohlcv"
    || canonical === "market.open"
    || canonical === "market.high"
    || canonical === "market.low"
    || canonical === "market.close"
  ) {
    return canonical;
  }
  return null;
}

function resolutionForCadence(cadenceMs: number): ManualChartResolution | undefined {
  for (const [resolution, step] of Object.entries(CHART_RESOLUTION_STEP_MS) as Array<
    [ManualChartResolution, number]
  >) {
    if (step === cadenceMs) return resolution;
  }
  return undefined;
}

function patchResolution(
  spec: ChartSpec,
  series: ResolvedSeries,
): ManualChartResolution | undefined {
  if (series.timeBasis?.cadenceMs != null) {
    const matched = resolutionForCadence(series.timeBasis.cadenceMs);
    if (matched) return matched;
  }
  return spec.viewport.resolution === "auto" ? undefined : spec.viewport.resolution;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toPricePoint(point: TimeSeriesPoint): PricePoint | null {
  const close = finiteNumber(point.close)
    ? point.close
    : finiteNumber(point.value)
      ? point.value
      : null;
  if (close == null) return null;
  return {
    date: point.date,
    ...(finiteNumber(point.open) ? { open: point.open } : {}),
    ...(finiteNumber(point.high) ? { high: point.high } : {}),
    ...(finiteNumber(point.low) ? { low: point.low } : {}),
    close,
    ...(finiteNumber(point.volume) ? { volume: point.volume } : {}),
  };
}

function fieldValue(fieldId: string, point: PricePoint): number {
  if (fieldId === "market.open") return finiteNumber(point.open) ? point.open : point.close;
  if (fieldId === "market.high") return finiteNumber(point.high) ? point.high : point.close;
  if (fieldId === "market.low") return finiteNumber(point.low) ? point.low : point.close;
  return point.close;
}

function withLivePrice(
  point: TimeSeriesPoint,
  next: PricePoint,
  fieldId: string,
): TimeSeriesPoint {
  return {
    ...point,
    value: fieldValue(fieldId, next),
    open: finiteNumber(next.open) ? next.open : point.open ?? null,
    high: finiteNumber(next.high) ? next.high : point.high ?? null,
    low: finiteNumber(next.low) ? next.low : point.low ?? null,
    close: next.close,
    volume: finiteNumber(next.volume) ? next.volume : point.volume,
  };
}

function lastBarUnchanged(current: TimeSeriesPoint, next: TimeSeriesPoint): boolean {
  return current.value === next.value
    && current.open === next.open
    && current.high === next.high
    && current.low === next.low
    && current.close === next.close;
}

function liveTailSeries(
  result: ChartResolutionResult,
  seriesId: string,
): ResolvedSeries | undefined {
  return (result.bufferedSeries ?? result.series).find((entry) => entry.id === seriesId)
    ?? result.series.find((entry) => entry.id === seriesId);
}

function patchablePriceSeries(spec: ChartSpec): ChartSeriesSpec[] | null {
  if (spec.studies.some((study) => study.kind !== "volume")) return null;
  const patchable: ChartSeriesSpec[] = [];
  for (const series of spec.series) {
    if (series.source.kind !== "security") {
      if (series.visible !== false) return null;
      continue;
    }
    const fieldId = canonicalTimeSeriesFieldId(series.source.fieldId);
    if (valuationSeriesUsesLiveQuote(fieldId)) return null;
    if (fieldId === "market.volume" || fieldId === "market.dividends") continue;
    const priceField = livePriceFieldId(fieldId);
    if (!priceField) {
      if (series.visible !== false) return null;
      continue;
    }
    if (series.transform !== "raw") return null;
    if (series.visible === false) continue;
    patchable.push(series);
  }
  return patchable.length > 0 ? patchable : null;
}

function applyLastBarPatch(
  seriesList: readonly ResolvedSeries[] | undefined,
  seriesId: string,
  lastTime: number,
  fieldId: string,
  price: PricePoint,
  latestChangePercent: number | undefined,
): ResolvedSeries[] | undefined {
  if (!seriesList) return undefined;
  let changed = false;
  const next = seriesList.map((entry) => {
    if (entry.id !== seriesId) return entry;
    const last = entry.points.at(-1);
    const nextChange = finiteNumber(latestChangePercent)
      ? latestChangePercent
      : entry.latestChangePercent;
    if (last == null || last.date.getTime() !== lastTime) {
      if (nextChange === entry.latestChangePercent) return entry;
      changed = true;
      return { ...entry, latestChangePercent: nextChange };
    }
    const nextPoint = withLivePrice(last, price, fieldId);
    if (lastBarUnchanged(last, nextPoint) && nextChange === entry.latestChangePercent) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      latestChangePercent: nextChange,
      points: [...entry.points.slice(0, -1), nextPoint],
    };
  });
  return changed ? next : seriesList as ResolvedSeries[];
}

/**
 * Updates the last bar/print from a live quote when studies and transforms
 * would not change. Returns the same result if nothing changed, or null when
 * the full resolver must rebuild.
 */
export function patchResolvedChartWithLiveQuotes(
  result: ChartResolutionResult,
  spec: ChartSpec,
  quoteOverrides: ReadonlyMap<string, Quote>,
  now: number,
): ChartResolutionResult | null {
  if (result.loading || quoteOverrides.size === 0) return null;
  const patchable = patchablePriceSeries(spec);
  if (!patchable) return null;

  let next: ChartResolutionResult = result;
  let changed = false;
  for (const seriesSpec of patchable) {
    if (seriesSpec.source.kind !== "security") continue;
    const fieldId = livePriceFieldId(seriesSpec.source.fieldId);
    if (!fieldId) continue;
    const quote = quoteOverrides.get(chartQuoteOverrideKeyForSource(seriesSpec.source));
    if (!quote) continue;
    const tail = liveTailSeries(next, seriesSpec.id);
    if (!tail || tail.points.length === 0) return null;
    const resolution = patchResolution(spec, tail);
    if (!resolution) return null;
    const last = tail.points.at(-1);
    const previous = tail.points.at(-2);
    if (!last) return null;
    const lastPrice = toPricePoint(last);
    const previousPrice = previous ? toPricePoint(previous) : null;
    if (!lastPrice || (previous && !previousPrice)) return null;
    const history = previousPrice ? [previousPrice, lastPrice] : [lastPrice];
    const extended = appendLiveQuotePoint(history, quote, {
      now,
      mode: "ohlc",
      resolution,
    });
    if (extended.length !== history.length) return null;
    const nextPrice = extended.at(-1);
    if (!nextPrice) return null;
    const lastTime = last.date.getTime();
    const latestChangePercent = finiteNumber(quote.changePercent)
      ? quote.changePercent
      : undefined;
    const series = applyLastBarPatch(
      next.series,
      seriesSpec.id,
      lastTime,
      fieldId,
      nextPrice,
      latestChangePercent,
    );
    const bufferedSeries = applyLastBarPatch(
      next.bufferedSeries,
      seriesSpec.id,
      lastTime,
      fieldId,
      nextPrice,
      latestChangePercent,
    );
    const legendSeries = applyLastBarPatch(
      next.legendSeries,
      seriesSpec.id,
      lastTime,
      fieldId,
      nextPrice,
      latestChangePercent,
    );
    const timelineSeries = applyLastBarPatch(
      next.timelineSeries,
      seriesSpec.id,
      lastTime,
      fieldId,
      nextPrice,
      latestChangePercent,
    );
    if (
      series === next.series
      && bufferedSeries === next.bufferedSeries
      && legendSeries === next.legendSeries
      && timelineSeries === next.timelineSeries
    ) {
      continue;
    }
    changed = true;
    next = {
      ...next,
      series: series ?? next.series,
      ...(bufferedSeries ? { bufferedSeries } : {}),
      ...(legendSeries ? { legendSeries } : {}),
      ...(timelineSeries ? { timelineSeries } : {}),
    };
  }
  return changed ? next : result;
}

export interface LiveChartQuoteSubscriptionOptions {
  spec: ChartSpec;
  dataProvider: DataProvider | null;
  onRefresh: (quoteOverrides: ReadonlyMap<string, Quote>) => Promise<void> | void;
  refreshIntervalMs?: number;
}

/**
 * Coalesces streaming quote bursts and serializes engine refreshes. A slow
 * refresh can have at most one follow-up queued, using the latest quote per
 * instrument, so streaming never fans out into overlapping history requests.
 */
export function subscribeToLiveChartQuotes({
  spec,
  dataProvider,
  onRefresh,
  refreshIntervalMs = LIVE_CHART_REFRESH_INTERVAL_MS,
}: LiveChartQuoteSubscriptionOptions): () => void {
  const targets = getLiveChartQuoteTargets(spec);
  if (!dataProvider?.subscribeQuotes || targets.length === 0) return () => {};

  const subscribedKeys = new Set(targets.map(chartQuoteOverrideKeyForTarget));
  const quoteOverrides = new Map<string, Quote>();
  const interval = Math.max(0, refreshIntervalMs);
  let disposed = false;
  let pending = false;
  let inFlight = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (disposed || inFlight || timer !== null || !pending) return;
    const delay = Math.max(0, interval - (Date.now() - lastStartedAt));
    timer = setTimeout(() => {
      timer = null;
      if (disposed || inFlight || !pending) return;
      pending = false;
      inFlight = true;
      lastStartedAt = Date.now();
      const snapshot = new Map(quoteOverrides);
      Promise.resolve()
        .then(() => onRefresh(snapshot))
        .catch(() => {
          // A background refresh failure must not stop the live subscription.
        })
        .finally(() => {
          inFlight = false;
          if (pending) schedule();
        });
    }, delay);
  };

  let unsubscribe: () => void;
  try {
    unsubscribe = dataProvider.subscribeQuotes(targets, (target, quote) => {
      if (disposed) return;
      const key = chartQuoteOverrideKeyForTarget(target);
      const previous = quoteOverrides.get(key);
      if (!subscribedKeys.has(key) || !isNewerQuote(quote, previous)) return;
      quoteOverrides.set(key, quote);
      // receivedAt-only updates keep freshness metadata current without
      // rebuilding unchanged series, studies, and chart bitmaps.
      if (!hasResolutionRelevantChange(quote, previous)) return;
      pending = true;
      schedule();
    });
  } catch {
    disposed = true;
    pending = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    return () => {};
  }

  return () => {
    if (disposed) return;
    disposed = true;
    pending = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    try {
      unsubscribe();
    } catch {
      // Cleanup remains idempotent even if a provider has already torn down.
    }
  };
}
