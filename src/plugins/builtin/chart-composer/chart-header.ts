import { formatChartLegendValue, formatOhlcvHud } from "../../../components/chart/composite/format";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";

export interface ChartHeaderStudy {
  id: string;
  label: string;
  value: number;
}

export interface ChartHeaderLevel {
  id: string;
  price: number;
}

export interface ChartHeaderSelection {
  priceSeriesId: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  /** Newest close, or the live quote when the loaded bar is older than that quote. */
  close: number | null;
  volume: number | null;
  studies: ChartHeaderStudy[];
  levels: ChartHeaderLevel[];
  text: string;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function latestPoint(series: ResolvedSeries): TimeSeriesPoint | null {
  let best: TimeSeriesPoint | null = null;
  for (const point of series.points) {
    const value = finite(point.close) ? point.close : finite(point.value) ? point.value : null;
    if (value === null) continue;
    if (!best || point.date.getTime() >= best.date.getTime()) best = point;
  }
  return best;
}

function pointClose(point: TimeSeriesPoint): number | null {
  if (finite(point.close)) return point.close;
  return finite(point.value) ? point.value : null;
}

/**
 * The quote the chart was given, reconstructed as previous close plus the
 * session change. A date window that ends in the past still carries this on
 * the series, and it is the price an alert will be judged on.
 */
function quotePrice(series: ResolvedSeries): number | null {
  if (!finite(series.previousClose) || !finite(series.latestChange)) return null;
  const price = series.previousClose + series.latestChange;
  return Number.isFinite(price) ? price : null;
}

function samePrice(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-6, Math.abs(left) * 1e-8);
}

function pickPriceSeries(
  series: readonly ResolvedSeries[],
  baseSeriesIds: ReadonlySet<string>,
): ResolvedSeries | null {
  const base = series.filter((entry) => baseSeriesIds.has(entry.id));
  const visible = base.filter((entry) => !entry.hidden);
  const pool = visible.length > 0 ? visible : base;
  return pool.find((entry) => entry.dataShape === "ohlcv")
    ?? pool.find((entry) => entry.points.some((point) => (
      finite(point.open) || finite(point.high) || finite(point.low) || finite(point.close)
    )))
    ?? pool[0]
    ?? null;
}

function formatStudy(study: ChartHeaderStudy, series: ResolvedSeries): string {
  return `${study.label} ${formatChartLegendValue(study.value, series.unit, series.unitGroup)}`;
}

/**
 * The numbers our own feed contributes above a chart: the latest OHLC (the
 * live quote when it is newer than the loaded bar) and the latest value of
 * each enabled study. Levels are listed only where they cannot be drawn.
 */
export function selectChartHeader(input: {
  series: readonly ResolvedSeries[];
  baseSeriesIds: ReadonlySet<string>;
  levels?: readonly ChartHeaderLevel[];
  includeLevels?: boolean;
}): ChartHeaderSelection {
  const price = pickPriceSeries(input.series, input.baseSeriesIds);
  const point = price ? latestPoint(price) : null;
  const barClose = point ? pointClose(point) : null;
  const quote = price ? quotePrice(price) : null;
  const close = quote ?? barClose;
  const barMatchesQuote = close !== null && barClose !== null && (quote === null || samePrice(quote, barClose));
  const open = barMatchesQuote && point && finite(point.open) ? point.open : null;
  const high = barMatchesQuote && point && finite(point.high) ? point.high : null;
  const low = barMatchesQuote && point && finite(point.low) ? point.low : null;
  const volume = barMatchesQuote && point && finite(point.volume) && point.volume >= 0 ? point.volume : null;

  const studies: ChartHeaderStudy[] = [];
  for (const series of input.series) {
    if (series.hidden || input.baseSeriesIds.has(series.id)) continue;
    const latest = latestPoint(series);
    if (!latest) continue;
    const value = finite(latest.value) ? latest.value : pointClose(latest);
    if (value === null) continue;
    studies.push({ id: series.id, label: series.label, value });
  }

  const levels = input.includeLevels
    ? [...(input.levels ?? [])]
      .filter((level) => Number.isFinite(level.price))
      .sort((left, right) => left.price - right.price || left.id.localeCompare(right.id))
    : [];

  const parts: string[] = [];
  if (price && close !== null) {
    const hud = barMatchesQuote
      ? formatOhlcvHud({
        open,
        high,
        low,
        close,
        volume,
        value: close,
      }, price.unit, price.unitGroup)
      : null;
    parts.push(hud ?? `C ${formatChartLegendValue(close, price.unit, price.unitGroup)}`);
  }
  const studySeries = new Map(input.series.map((series) => [series.id, series]));
  for (const study of studies) {
    const series = studySeries.get(study.id);
    if (series) parts.push(formatStudy(study, series));
  }
  if (price) {
    for (const level of levels) {
      parts.push(`Lvl ${formatChartLegendValue(level.price, price.unit, price.unitGroup)}`);
    }
  }

  return {
    priceSeriesId: price?.id ?? null,
    open,
    high,
    low,
    close,
    volume,
    studies,
    levels,
    text: parts.join("  "),
  };
}
