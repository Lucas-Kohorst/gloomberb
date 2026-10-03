import { resolveExchangeTimeZone } from "../../../utils/exchanges";
import type { ChartResolveSources } from "../../../time-series/resolve";
import { ChartResolveCache, resolveChartSpecData } from "../../../time-series/resolve";
import type { DataProvider } from "../../../types/data-provider";
import { subtractTimeRange } from "../../../time-series/date-window";
import type { TimeRange } from "../../../time-series/range";
import {
  DEFAULT_CHART_RESOLUTION_SUPPORT,
  getSupportMaxRange,
  type ManualChartResolution,
} from "../../../time-series/resolution";
import {
  coerceSeriesInterpolationForStyle,
  defaultChartSeriesPresentation,
} from "../../../time-series/spec";
import {
  CHART_SPEC_VERSION,
  type ChartSeriesSource,
  type ChartSpec,
  type TimeSeriesPoint,
} from "../../../time-series/types";
import { libraryAxisUnit, libraryFeedUnits, libraryPriceScale, type LibraryPriceScale } from "./charting-library-options";
import { tradingViewIntervalForSpec, type TradingViewInterval } from "./tradingview-plot";

export const LIBRARY_RESOLUTIONS = ["1", "5", "15", "30", "45", "60", "240", "D", "W", "M"] as const;

export interface LibraryBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface LibrarySearchItem {
  symbol: string;
  description: string;
  exchange: string;
  ticker: string;
  type: string;
}

export interface LibraryDatafeed {
  onReady: (callback: (config: {
    supported_resolutions: string[];
    units?: Record<string, Array<{ id: string; name: string; description: string }>>;
  }) => void) => void;
  searchSymbols: (
    userInput: string,
    exchange: string,
    symbolType: string,
    onResult: (items: LibrarySearchItem[]) => void,
  ) => void;
  resolveSymbol: (
    symbolName: string,
    onResolve: (info: Record<string, unknown>) => void,
    onError: (message: string) => void,
    extension?: { session?: string },
  ) => void;
  getBars: (
    symbolInfo: { ticker?: string; name?: string },
    resolution: string,
    periodParams: { from: number; to: number; countBack: number },
    onResult: (bars: LibraryBar[], meta: { noData?: boolean }) => void,
    onError: (message: string) => void,
  ) => void;
  subscribeBars: (
    symbolInfo: { ticker?: string; name?: string },
    resolution: string,
    onTick: (bar: LibraryBar) => void,
    listenerGuid: string,
    onResetCacheNeededCallback: () => void,
  ) => void;
  unsubscribeBars: (listenerGuid: string) => void;
}

export interface LibraryChartModel {
  symbol: string;
  interval: TradingViewInterval;
  timezone: string;
  compares: string[];
  chartStyle: "candles" | "line" | "step";
  priceScale: LibraryPriceScale;
  directory: Map<string, ChartSeriesSource>;
}

const RESOLUTION_FROM_LIBRARY: Record<string, ManualChartResolution> = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "45": "45m",
  "60": "1h",
  "240": "4h",
  "1D": "1d",
  D: "1d",
  "1W": "1wk",
  W: "1wk",
  "1M": "1mo",
  M: "1mo",
};

export function resolutionFromLibraryInterval(interval: string): ManualChartResolution {
  return RESOLUTION_FROM_LIBRARY[interval] ?? "1d";
}

// TradingView tickers are EXCHANGE:SYMBOL. A second colon or a hyphen is parsed as a spread, and the chart reports an unknown symbol.
const LIBRARY_TICKER_BODY = /[^A-Z0-9._]+/g;

export function librarySafeTicker(ticker: string): string {
  const upper = ticker.trim().toUpperCase();
  const colon = upper.indexOf(":");
  const prefix = colon > 0 ? upper.slice(0, colon).replace(/[^A-Z0-9]/g, "") : "";
  const body = (colon > 0 ? upper.slice(colon + 1) : upper)
    .replace(LIBRARY_TICKER_BODY, "_")
    .replace(/^_+|_+$/g, "");
  if (!body) return "";
  return prefix ? `${prefix}:${body}` : body;
}

export function feedTickerForSource(source: ChartSeriesSource): string | null {
  const ticker = tickerForSource(source);
  if (!ticker?.trim()) return null;
  const upper = ticker.trim().toUpperCase();
  // Futures keep '=' (MGE=F). Sanitizing that would point the datafeed at a different Yahoo symbol. A hyphen is a spread, so every other ticker is library-safe.
  if (source.kind === "security" && upper.includes("=")) return upper;
  return librarySafeTicker(ticker) || null;
}

function tickerForSource(source: ChartSeriesSource): string | null {
  switch (source.kind) {
    case "security": {
      const symbol = source.instrument.symbol.trim();
      if (!symbol) return null;
      const exchange = source.instrument.exchange?.trim();
      return exchange ? `${exchange}:${symbol}` : symbol;
    }
    case "economic":
      return source.seriesId.trim() ? `FRED:${source.seriesId}` : null;
    case "prediction-market":
      return source.marketId.trim() ? `${source.venue}:${source.marketId}` : null;
    case "poll":
      return source.subject.trim() ? `POLL:${source.subject}:${source.choice}` : null;
    case "adjacent-index":
      return source.indexId.trim() ? `ADJ:${source.indexId}` : null;
    case "benchmark":
      return `BENCH:${source.selector}:${source.metric}`;
    case "weather":
      return `WX:${source.provider}:${source.stationId}:${source.metric}`;
    case "owid":
      return `OWID:${source.slug}:${source.entity}`;
    case "capability":
      return `CAP:${source.capabilityId}:${source.seriesId}`;
    case "constant":
      return null;
  }
}

export function libraryChartFromSpec(spec: ChartSpec): LibraryChartModel | null {
  const directory = new Map<string, ChartSeriesSource>();
  const tickers: string[] = [];
  for (const series of spec.series) {
    if (series.visible === false) continue;
    const ticker = feedTickerForSource(series.source);
    if (!ticker || directory.has(ticker)) continue;
    directory.set(ticker, series.source);
    tickers.push(ticker);
  }
  const symbol = tickers[0];
  if (!symbol) return null;
  const primary = directory.get(symbol)!;
  const timezone = primary.kind === "security"
    ? resolveExchangeTimeZone(primary.instrument.exchange) ?? "America/New_York"
    : "America/New_York";
  return {
    symbol,
    interval: tradingViewIntervalForSpec(spec),
    timezone,
    compares: tickers.slice(1),
    chartStyle: primary.kind === "prediction-market" ? "step" : primary.kind === "security" && (primary.fieldId === "market.ohlcv" || primary.fieldId === "market.close")
      ? "candles"
      : "line",
    priceScale: libraryPriceScale(tickers.map((ticker) => defaultChartSeriesPresentation(directory.get(ticker)!).unit)),
    directory,
  };
}

export function barFromPoint(point: TimeSeriesPoint): LibraryBar | null {
  const close = point.close ?? point.value;
  if (close == null || !Number.isFinite(close) || !Number.isFinite(point.date.getTime())) return null;
  const open = finite(point.open) ?? close;
  const high = finite(point.high) ?? Math.max(open, close);
  const low = finite(point.low) ?? Math.min(open, close);
  const volume = finite(point.volume);
  return {
    time: point.date.getTime(),
    open,
    high,
    low,
    close,
    ...(volume == null ? {} : { volume }),
  };
}

export function selectLibraryBars(
  points: readonly TimeSeriesPoint[],
  fromMs: number,
  toMs: number,
  countBack: number,
): LibraryBar[] {
  const bars = points
    .map(barFromPoint)
    .filter((bar): bar is LibraryBar => bar !== null)
    .sort((left, right) => left.time - right.time);
  const beforeEnd = bars.filter((bar) => bar.time < toMs);
  if (beforeEnd.length <= countBack) return beforeEnd;
  const inRange = beforeEnd.filter((bar) => bar.time >= fromMs);
  if (inRange.length >= countBack) return inRange;
  return beforeEnd.slice(beforeEnd.length - Math.max(countBack, 0));
}

export function barsFromCloses(points: readonly { time: number; close: number; open?: number; high?: number; low?: number; volume?: number }[]): LibraryBar[] {
  return points.flatMap((point) => {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.close)) return [];
    const open = point.open ?? point.close;
    const high = point.high ?? Math.max(open, point.close);
    const low = point.low ?? Math.min(open, point.close);
    return [{
      time: point.time,
      open,
      high,
      low,
      close: point.close,
      ...(point.volume == null ? {} : { volume: point.volume }),
    }];
  });
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const LIBRARY_PERIOD_MS: Partial<Record<ManualChartResolution, number>> = {
  "1d": 86_400_000,
  "1wk": 7 * 86_400_000,
  "1mo": 32 * 86_400_000,
};

function historyEndMs(resolution: ManualChartResolution, toMs: number): number {
  return toMs + (LIBRARY_PERIOD_MS[resolution] ?? 0);
}

function periodStartMs(resolution: ManualChartResolution, timeMs: number): number | null {
  if (!LIBRARY_PERIOD_MS[resolution] || !Number.isFinite(timeMs)) return null;
  const date = new Date(timeMs);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  if (resolution === "1d") return Date.UTC(year, month, day);
  if (resolution === "1mo") return Date.UTC(year, month, 1);
  const monday = day - ((date.getUTCDay() + 6) % 7);
  return Date.UTC(year, month, monday);
}

function aggregateLibraryPoints(
  points: readonly TimeSeriesPoint[],
  resolution: ManualChartResolution,
  aggregateIntraday = false,
): readonly TimeSeriesPoint[] {
  const intradayMs = aggregateIntraday ? ({ "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "45m": 2_700_000, "1h": 3_600_000, "4h": 14_400_000 } as Partial<Record<ManualChartResolution, number>>)[resolution] : undefined;
  if (!LIBRARY_PERIOD_MS[resolution] && !intradayMs) return points;
  const groups = new Map<number, TimeSeriesPoint[]>();
  for (const point of points) {
    const start = intradayMs
      ? Math.floor(point.date.getTime() / intradayMs) * intradayMs
      : periodStartMs(resolution, point.date.getTime());
    if (start == null) continue;
    const group = groups.get(start);
    if (group) group.push(point);
    else groups.set(start, [point]);
  }
  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([start, group]) => {
      const sorted = [...group].sort((left, right) => left.date.getTime() - right.date.getTime());
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      const close = last.close ?? last.value;
      const open = first.open ?? first.close ?? first.value;
      let high = Number.NEGATIVE_INFINITY;
      let low = Number.POSITIVE_INFINITY;
      let volume = 0;
      let hasVolume = false;
      for (const point of sorted) {
        const price = point.close ?? point.value;
        const pointHigh = point.high ?? price;
        const pointLow = point.low ?? price;
        if (pointHigh != null && Number.isFinite(pointHigh)) high = Math.max(high, pointHigh);
        if (pointLow != null && Number.isFinite(pointLow)) low = Math.min(low, pointLow);
        if (typeof point.volume === "number" && Number.isFinite(point.volume)) {
          volume += point.volume;
          hasVolume = true;
        }
      }
      const date = new Date(start);
      return {
        date,
        observedAt: last.observedAt,
        value: close,
        open,
        high: Number.isFinite(high) ? high : close,
        low: Number.isFinite(low) ? low : close,
        close,
        ...(hasVolume ? { volume } : {}),
      };
    });
}

function withWeeklyHistoryCap(sources: ChartResolveSources): ChartResolveSources {
  const provider = sources.dataProvider;
  if (!provider?.getPriceHistoryForResolution) return sources;
  const original = provider.getPriceHistoryForResolution.bind(provider);
  const wrapped = Object.create(provider) as DataProvider;
  wrapped.getPriceHistoryForResolution = (ticker, exchange, bufferRange, resolution, context) => (
    original(
      ticker,
      exchange,
      resolution === "1wk" && bufferRange === "ALL" ? "5Y" : bufferRange,
      resolution,
      context,
    )
  );
  return { ...sources, dataProvider: wrapped };
}

function rangeForSpan(spanMs: number): TimeRange {
  const day = 86_400_000;
  if (spanMs <= 2 * day) return "1D";
  if (spanMs <= 10 * day) return "1W";
  if (spanMs <= 40 * day) return "1M";
  if (spanMs <= 100 * day) return "3M";
  if (spanMs <= 200 * day) return "6M";
  if (spanMs <= 400 * day) return "1Y";
  if (spanMs <= 5 * 365 * day) return "5Y";
  return "ALL";
}

// A 1D click asks for 1-minute bars, but the first getBars span is often years wide.
// That span fails the 1-minute support cap, and the resolver substitutes a daily series.
// Keep the requested resolution by clipping the spec window to the cap. Ceil the start
// so it still satisfies isDateWindowWithinTimeRange after the seconds truncation.
function libraryHistoryFromSec(resolution: ManualChartResolution, fromSec: number, toSec: number): number {
  const maxRange = getSupportMaxRange(DEFAULT_CHART_RESOLUTION_SUPPORT, resolution);
  if (!maxRange || maxRange === "ALL") return fromSec;
  const earliestMs = subtractTimeRange(new Date(toSec * 1000), maxRange).getTime();
  return Math.max(fromSec, Math.ceil(earliestMs / 1000));
}

function sourceForTicker(
  ticker: string,
  directory: ReadonlyMap<string, ChartSeriesSource>,
): ChartSeriesSource | null {
  const upper = ticker.trim().toUpperCase();
  if (!upper) return null;
  const known = directory.get(upper) ?? directory.get(ticker.trim());
  if (known) return known;
  for (const [key, source] of directory) {
    if (key.toUpperCase() === upper) return source;
  }
  const safe = librarySafeTicker(upper);
  if (safe && safe !== upper) {
    const mapped = directory.get(safe);
    if (mapped) return mapped;
  }
  if (upper.startsWith("FRED:")) {
    const seriesId = upper.slice("FRED:".length);
    return seriesId ? { kind: "economic", provider: "fred", seriesId } : null;
  }
  if (/^(POLL|ADJ|BENCH|WX|OWID|CAP):/.test(upper)) return null;
  const colon = upper.indexOf(":");
  if (colon > 0) {
    return {
      kind: "security",
      instrument: { exchange: upper.slice(0, colon), symbol: upper.slice(colon + 1) },
      fieldId: "market.ohlcv",
    };
  }
  return {
    kind: "security",
    instrument: { symbol: upper },
    fieldId: "market.ohlcv",
  };
}

function libraryResolutionInfo(): Record<string, unknown> {
  return {
    has_intraday: true,
    intraday_multipliers: ["1", "5", "15", "30", "45", "60", "240"],
    daily_multipliers: ["1"],
    weekly_multipliers: ["1"],
    monthly_multipliers: ["1"],
    has_weekly_and_monthly: true,
    supported_resolutions: [...LIBRARY_RESOLUTIONS],
  };
}

// A cash session on a futures, crypto, or non-New York listing drops the prints that fall outside it.
function symbolSession(type: string, exchange: string, requestedSession = "extended"): Record<string, unknown> {
  if (type !== "stock" || resolveExchangeTimeZone(exchange) !== "America/New_York") {
    return { session: "24x7" };
  }
  return {
    session: requestedSession === "regular" ? "0930-1600" : "0400-2000",
    subsession_id: requestedSession === "regular" ? "regular" : "extended",
    subsessions: [
      { description: "Regular Trading Hours", id: "regular", session: "0930-1600" },
      { description: "Extended Trading Hours", id: "extended", session: "0400-2000" },
      { description: "Pre-market", id: "premarket", session: "0400-0930" },
      { description: "Post-market", id: "postmarket", session: "1600-2000" },
    ],
  };
}

function symbolInfo(ticker: string, source: ChartSeriesSource, timezone: string, session?: string): Record<string, unknown> {
  const colon = ticker.indexOf(":");
  const exchange = colon > 0 ? ticker.slice(0, colon) : "";
  const name = colon > 0 ? ticker.slice(colon + 1) : ticker;
  const pricescale = source.kind === "prediction-market" ? 1000 : 100;
  const presentation = defaultChartSeriesPresentation(source);
  const axisUnit = libraryAxisUnit(presentation.unit);
  const legend = sourceLegend(source);
  const type = source.kind !== "security"
    ? "index"
    : /=F$/.test(name)
      ? "futures"
      : exchange === "CCC" || exchange === "CRYPTO"
        ? "crypto"
        : "stock";
  return {
    ticker,
    name,
    description: legend,
    long_description: legend,
    ...(axisUnit ? { unit_id: axisUnit, original_unit_id: axisUnit } : {}),
    type,
    ...symbolSession(type, exchange, session),
    timezone,
    exchange,
    minmov: 1,
    pricescale,
    visible_plots_set: "ohlcv",
    ...libraryResolutionInfo(),
    volume_precision: 0,
    data_status: "streaming",
    format: "price",
  };
}

function sourceLegend(source: ChartSeriesSource): string {
  switch (source.kind) {
    case "security": {
      const symbol = source.instrument.symbol.trim();
      const exchange = source.instrument.exchange?.trim();
      return exchange ? `${exchange} ${symbol}` : symbol;
    }
    case "economic":
      return source.seriesId;
    case "prediction-market":
      return `${source.venue} ${source.marketId}`;
    case "poll":
      return `${source.subject} ${source.choice}`.trim();
    case "adjacent-index":
      return source.indexId;
    case "benchmark":
      return `${source.selector} ${source.metric}`;
    case "weather":
      return `${source.stationId} ${source.metric}`;
    case "owid":
      return `${source.slug.replaceAll("-", " ")} ${source.entity}`.trim();
    case "capability":
      return `${source.capabilityId} ${source.seriesId}`;
    case "constant":
      return String(source.value);
  }
}

function specForRequest(
  source: ChartSeriesSource,
  resolution: ManualChartResolution,
  fromSec: number,
  toSec: number,
  fullHistory: boolean,
): ChartSpec {
  const presentation = defaultChartSeriesPresentation(source);
  const start = new Date(fromSec * 1000);
  const end = new Date(toSec * 1000);
  return {
    version: CHART_SPEC_VERSION,
    viewport: fullHistory
      ? { range: "ALL", resolution }
      : {
        range: rangeForSpan(Math.max(0, end.getTime() - start.getTime())),
        resolution,
        dateWindow: { start: start.toISOString(), end: end.toISOString() },
      },
    panels: [{ id: "main", height: 1, scale: "linear" }],
    series: [{
      id: "feed",
      source,
      style: presentation.style,
      transform: presentation.transform,
      axis: "auto",
      panelId: "main",
      interpolation: coerceSeriesInterpolationForStyle(presentation.style),
    }],
    studies: [],
  };
}

// TradingView re-enters datafeed callbacks. Cached bars still have to resolve on a later macrotask.
function deferLibraryCallback<Args extends unknown[]>(callback: (...args: Args) => void, ...args: Args): void {
  setTimeout(() => {
    callback(...args);
  }, 0);
}

interface LibraryBarListener {
  symbol: string;
  resolution: string;
  onTick: (bar: LibraryBar) => void;
  onResetCacheNeededCallback?: () => void;
}

// resolutionFromLibraryInterval maps unknown strings to 1d, so it cannot filter listeners.
const LIBRARY_BAR_SIZE_MS: Record<string, number> = {
  "1": 60_000,
  "5": 300_000,
  "15": 900_000,
  "30": 1_800_000,
  "45": 2_700_000,
  "60": 3_600_000,
  "240": 14_400_000,
  D: 86_400_000,
  "1D": 86_400_000,
  W: 604_800_000,
  "1W": 604_800_000,
  M: 2_592_000_000,
  "1M": 2_592_000_000,
};

function libraryBarSizeKey(resolution: string): string | null {
  const size = LIBRARY_BAR_SIZE_MS[resolution];
  if (size == null) return null;
  if (size === LIBRARY_BAR_SIZE_MS.D) return "D";
  if (size === LIBRARY_BAR_SIZE_MS.W) return "W";
  if (size === LIBRARY_BAR_SIZE_MS.M) return "M";
  return resolution;
}

function sameLibraryBarSize(left: string, right: string): boolean {
  const leftKey = libraryBarSizeKey(left);
  const rightKey = libraryBarSizeKey(right);
  return leftKey != null && leftKey === rightKey;
}

function medianBarGapMs(bars: readonly LibraryBar[]): number | null {
  if (bars.length < 2) return null;
  const times = bars.map((bar) => bar.time).sort((left, right) => left - right);
  const gaps: number[] = [];
  for (let index = 1; index < times.length; index += 1) gaps.push(times[index]! - times[index - 1]!);
  gaps.sort((left, right) => left - right);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

// An intraday request finer than half the stored median gap is not this series.
// Daily and coarser requests still bucket, so a yearly series can fill a monthly chart.
function requestedResolutionIsFinerThanBars(resolution: string, bars: readonly LibraryBar[]): boolean {
  const size = LIBRARY_BAR_SIZE_MS[resolution];
  if (size == null || size >= LIBRARY_BAR_SIZE_MS.D!) return false;
  const gap = medianBarGapMs(bars);
  if (gap == null) return false;
  return size < gap / 2;
}

function pointsFromBars(bars: readonly LibraryBar[]): TimeSeriesPoint[] {
  return bars.map((bar) => ({
    date: new Date(bar.time),
    observedAt: new Date(bar.time),
    value: bar.close,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
}

function libraryBarsForRequest(
  bars: readonly LibraryBar[],
  resolution: string,
  periodParams: { from: number; to: number; countBack: number },
): { bars: LibraryBar[]; noData: boolean } {
  if (requestedResolutionIsFinerThanBars(resolution, bars)) return { bars: [], noData: true };
  const selected = selectLibraryBars(
    aggregateLibraryPoints(pointsFromBars(bars), resolutionFromLibraryInterval(resolution), true),
    periodParams.from * 1000,
    periodParams.to * 1000,
    periodParams.countBack,
  );
  return { bars: selected, noData: selected.length === 0 };
}

function sameLibraryBar(left: LibraryBar, right: LibraryBar): boolean {
  return left.time === right.time
    && left.open === right.open
    && left.high === right.high
    && left.low === right.low
    && left.close === right.close
    && left.volume === right.volume;
}

function storedBarsChanged(previous: readonly LibraryBar[], next: readonly LibraryBar[]): "reset" | "tick" | "same" {
  if (previous.length !== next.length) return "reset";
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index]!.time !== next[index]!.time) return "reset";
  }
  let changed = -1;
  for (let index = 0; index < previous.length; index += 1) {
    if (sameLibraryBar(previous[index]!, next[index]!)) continue;
    if (changed !== -1) return "reset";
    changed = index;
  }
  if (changed === -1) return "same";
  return changed === previous.length - 1 ? "tick" : "reset";
}

function emitStoredBarChange(
  previous: readonly LibraryBar[],
  next: readonly LibraryBar[],
  symbol: string,
  listeners: ReadonlyMap<string, LibraryBarListener>,
  invalidate: () => void,
): void {
  const change = storedBarsChanged(previous, next);
  if (change === "same") return;
  invalidate();
  const last = next[next.length - 1];
  for (const listener of listeners.values()) {
    if (listener.symbol !== symbol) continue;
    if (change === "reset") listener.onResetCacheNeededCallback?.();
    else if (last) {
      const selected = libraryBarsForRequest(next, listener.resolution, { from: 0, to: (last.time + 1) / 1000, countBack: 1 });
      const bucket = selected.bars.at(-1);
      if (bucket) listener.onTick(bucket);
    }
  }
}

export function createSpecLibraryFeed(options: {
  getSources: () => ChartResolveSources;
  getDirectory: () => ReadonlyMap<string, ChartSeriesSource>;
  timezone?: string;
}): { feed: LibraryDatafeed; publish: (symbol: string, bar: LibraryBar, resolution?: string) => void } {
  const cache = new ChartResolveCache();
  const listeners = new Map<string, LibraryBarListener>();
  const timezone = options.timezone ?? "America/New_York";
  const publish = (symbol: string, bar: LibraryBar, resolution?: string) => {
    const ticker = symbol.trim().toUpperCase();
    for (const listener of listeners.values()) {
      if (listener.symbol !== ticker) continue;
      if (resolution !== undefined && !sameLibraryBarSize(listener.resolution, resolution)) continue;
      listener.onTick(bar);
    }
  };
  return {
    publish,
    feed: {
    onReady(callback) {
      setTimeout(() => callback({ supported_resolutions: [...LIBRARY_RESOLUTIONS], ...libraryFeedUnits() }), 0);
    },
    searchSymbols(userInput, _exchange, _symbolType, onResult) {
      const query = userInput.trim().toUpperCase();
      const items = [...options.getDirectory().entries()]
        .filter(([ticker]) => !query || ticker.includes(query))
        .map(([ticker, source]) => {
          const info = symbolInfo(ticker, source, timezone);
          return {
            symbol: ticker,
            description: ticker,
            exchange: String(info.exchange ?? ""),
            ticker,
            type: String(info.type ?? "stock"),
          };
        });
      setTimeout(() => onResult(items), 0);
    },
    resolveSymbol(symbolName, onResolve, onError, extension) {
      const ticker = symbolName.trim().toUpperCase();
      const source = sourceForTicker(ticker, options.getDirectory());
      setTimeout(() => {
        if (!source) {
          onError("unknown_symbol");
          return;
        }
        onResolve(symbolInfo(feedTickerForSource(source) ?? ticker, source, timezone, extension?.session));
      }, 0);
    },
    getBars(symbolInfo, resolution, periodParams, onResult, onError) {
      const ticker = (symbolInfo.ticker || symbolInfo.name || "").trim().toUpperCase();
      const source = sourceForTicker(ticker, options.getDirectory());
      if (!source) {
        deferLibraryCallback(onResult, [], { noData: true });
        return;
      }
      const manualResolution = resolutionFromLibraryInterval(resolution);
      const startMs = periodParams.from * 1000;
      const endMs = periodParams.to * 1000;
      const fetchEndMs = historyEndMs(manualResolution, endMs);
      // OWID, FRED, and the other full-history sources are not paged. Clipping
      // the load to the first visible window drops a yearly series whose last
      // print is older than that window, and noData then stops the library
      // from asking again.
      const fullHistory = source.kind !== "security";
      const fetchToSec = Math.floor(fetchEndMs / 1000);
      const historyFromSec = fullHistory
        ? periodParams.from
        : libraryHistoryFromSec(manualResolution, periodParams.from, fetchToSec);
      const spec = specForRequest(
        source,
        manualResolution,
        historyFromSec,
        fetchToSec,
        fullHistory,
      );
      void resolveChartSpecData(spec, withWeeklyHistoryCap(options.getSources()), cache, fullHistory
        ? {}
        : { requestViewport: { start: new Date(startMs), end: new Date(fetchEndMs) } },
      ).then((result) => {
        const points = aggregateLibraryPoints(result.series[0]?.points ?? [], manualResolution);
        const bars = selectLibraryBars(points, startMs, endMs, periodParams.countBack);
        // The clipped window is the whole history this resolution can serve. Another page
        // to the left asks Yahoo for a trailing range that does not cover it, and the chart errors.
        const capped = historyFromSec !== periodParams.from;
        deferLibraryCallback(onResult, bars, { noData: bars.length === 0 || capped });
      }).catch((error: unknown) => {
        deferLibraryCallback(onError, error instanceof Error ? error.message : "Chart history failed to load");
      });
    },
    subscribeBars(symbolInfo, resolution, onTick, listenerGuid, onResetCacheNeededCallback) {
      listeners.set(listenerGuid, {
        symbol: (symbolInfo.ticker || symbolInfo.name || "").trim().toUpperCase(),
        resolution,
        onTick,
        onResetCacheNeededCallback,
      });
    },
    unsubscribeBars(listenerGuid) {
      listeners.delete(listenerGuid);
    },
  },
  };
}

export function createStaticLibraryFeed(
  symbol: string,
  description: string,
  options: { pricescale?: number; type?: string; timezone?: string } = {},
): { feed: LibraryDatafeed; setBars: (bars: LibraryBar[]) => void } {
  let bars: LibraryBar[] = [];
  let listenerEpoch = 0;
  const listeners = new Map<string, LibraryBarListener>();
  const ticker = symbol.trim().toUpperCase();
  const colon = ticker.indexOf(":");
  const name = colon > 0 ? ticker.slice(colon + 1) : ticker;
  const timezone = options.timezone ?? "Etc/UTC";
  const info: Record<string, unknown> = {
    ticker,
    name,
    description,
    type: options.type ?? "stock",
    session: "24x7",
    timezone,
    exchange: "",
    minmov: 1,
    pricescale: options.pricescale ?? 100,
    visible_plots_set: "ohlcv",
    ...libraryResolutionInfo(),
    volume_precision: 0,
    data_status: "streaming",
    format: "price",
  };
  return {
    setBars(next) {
      const previous = bars;
      bars = [...next].sort((left, right) => left.time - right.time);
      emitStoredBarChange(previous, bars, ticker, listeners, () => {
        listenerEpoch += 1;
      });
    },
    feed: {
      onReady(callback) {
        setTimeout(() => callback({ supported_resolutions: [...LIBRARY_RESOLUTIONS], ...libraryFeedUnits() }), 0);
      },
      searchSymbols(_userInput, _exchange, _symbolType, onResult) {
        setTimeout(() => onResult([{
          symbol: ticker,
          description,
          exchange: "",
          ticker,
          type: String(info.type),
        }]), 0);
      },
      resolveSymbol(symbolName, onResolve, onError) {
        setTimeout(() => {
          if (symbolName.trim().toUpperCase() !== ticker) {
            onError("unknown_symbol");
            return;
          }
          onResolve(info);
        }, 0);
      },
      getBars(_symbolInfo, resolution, periodParams, onResult) {
        const selected = libraryBarsForRequest(bars, resolution, periodParams);
        deferLibraryCallback(onResult, selected.bars, { noData: selected.noData });
      },
      subscribeBars(symbolInfo, resolution, onTick, listenerGuid, onResetCacheNeededCallback) {
        const subscribed = (symbolInfo.ticker || symbolInfo.name || "").trim().toUpperCase();
        listeners.set(listenerGuid, {
          symbol: subscribed,
          resolution,
          onTick,
          onResetCacheNeededCallback,
        });
        const last = subscribed === ticker ? bars[bars.length - 1] : undefined;
        if (!last) return;
        const epoch = listenerEpoch;
        deferLibraryCallback(() => {
          if (epoch !== listenerEpoch || !listeners.has(listenerGuid)) return;
          const selected = libraryBarsForRequest(bars, resolution, { from: 0, to: (last.time + 1) / 1000, countBack: 1 });
          const bucket = selected.bars.at(-1);
          if (bucket) onTick(bucket);
        });
      },
      unsubscribeBars(listenerGuid) {
        listeners.delete(listenerGuid);
      },
    },
  };
}

export interface ResolvedLibrarySeries {
  id: string;
  label: string;
  style: string;
  points: readonly TimeSeriesPoint[];
  unit?: string;
}

export interface ResolvedLibraryModel {
  symbol: string;
  compares: string[];
  chartStyle: "candles" | "line" | "step";
  priceScale: LibraryPriceScale;
}

const OHLC_STYLES = new Set(["candles", "ohlc", "hlc"]);

function libraryTicker(label: string, id: string, index: number): string {
  const raw = librarySafeTicker(label || id || `S${index + 1}`).slice(0, 48);
  return raw || `S${index + 1}`;
}

export function createResolvedSeriesLibraryFeed(): {
  feed: LibraryDatafeed;
  setSeries: (next: readonly ResolvedLibrarySeries[]) => void;
  model: () => ResolvedLibraryModel;
} {
  let entries: Array<{ ticker: string; label: string; bars: LibraryBar[]; style: string; unit?: string }> = [];
  let listenerEpoch = 0;
  const listeners = new Map<string, LibraryBarListener>();
  const find = (ticker: string) => entries.find((entry) => entry.ticker === ticker);
  const infoFor = (entry: { ticker: string; label: string; unit?: string }): Record<string, unknown> => {
    const axisUnit = libraryAxisUnit(entry.unit);
    return {
    ticker: entry.ticker,
    name: entry.ticker.includes(":") ? entry.ticker.slice(entry.ticker.indexOf(":") + 1) : entry.ticker,
    description: entry.label,
    long_description: entry.label,
    ...(axisUnit ? { unit_id: axisUnit, original_unit_id: axisUnit } : {}),
    type: axisUnit === "%" ? "index" : "stock",
    session: "24x7",
    timezone: "Etc/UTC",
    exchange: "",
    minmov: 1,
    pricescale: 100,
    visible_plots_set: "ohlcv",
    ...libraryResolutionInfo(),
    volume_precision: 0,
    data_status: "streaming",
    format: "price",
  };
  };
  return {
    setSeries(next) {
      const previousByTicker = new Map(entries.map((entry) => [entry.ticker, entry.bars]));
      const used = new Set<string>();
      entries = next.map((series, index) => {
        let ticker = libraryTicker(series.label, series.id, index);
        while (used.has(ticker)) ticker = `${ticker}_${index + 1}`;
        used.add(ticker);
        const bars = series.points
          .map(barFromPoint)
          .filter((bar): bar is LibraryBar => bar !== null)
          .sort((left, right) => left.time - right.time);
        return { ticker, label: series.label || ticker, bars, style: series.style, unit: series.unit };
      });
      const nextByTicker = new Map(entries.map((entry) => [entry.ticker, entry.bars]));
      const symbols = new Set<string>([...previousByTicker.keys(), ...nextByTicker.keys()]);
      for (const symbol of symbols) {
        emitStoredBarChange(
          previousByTicker.get(symbol) ?? [],
          nextByTicker.get(symbol) ?? [],
          symbol,
          listeners,
          () => {
            listenerEpoch += 1;
          },
        );
      }
    },
    model() {
      const primary = entries[0];
      return {
        symbol: primary?.ticker ?? "",
        compares: entries.slice(1).map((entry) => entry.ticker),
        chartStyle: primary?.style === "step" ? "step" : primary && OHLC_STYLES.has(primary.style) ? "candles" : "line",
        priceScale: libraryPriceScale(entries.map((entry) => entry.unit)),
      };
    },
    feed: {
      onReady(callback) {
        setTimeout(() => callback({ supported_resolutions: [...LIBRARY_RESOLUTIONS], ...libraryFeedUnits() }), 0);
      },
      searchSymbols(userInput, _exchange, _symbolType, onResult) {
        const query = userInput.trim().toUpperCase();
        const items = entries
          .filter((entry) => !query || entry.ticker.includes(query) || entry.label.toUpperCase().includes(query))
          .map((entry) => ({
            symbol: entry.ticker,
            description: entry.label,
            exchange: "",
            ticker: entry.ticker,
            type: "stock",
          }));
        setTimeout(() => onResult(items), 0);
      },
      resolveSymbol(symbolName, onResolve, onError) {
        const entry = find(symbolName.trim().toUpperCase());
        setTimeout(() => {
          if (!entry) {
            onError("unknown_symbol");
            return;
          }
          onResolve(infoFor(entry));
        }, 0);
      },
      getBars(symbolInfo, resolution, periodParams, onResult) {
        const entry = find((symbolInfo.ticker || symbolInfo.name || "").trim().toUpperCase());
        if (!entry) {
          deferLibraryCallback(onResult, [], { noData: true });
          return;
        }
        const selected = libraryBarsForRequest(entry.bars, resolution, periodParams);
        deferLibraryCallback(onResult, selected.bars, { noData: selected.noData });
      },
      subscribeBars(symbolInfo, resolution, onTick, listenerGuid, onResetCacheNeededCallback) {
        const subscribed = (symbolInfo.ticker || symbolInfo.name || "").trim().toUpperCase();
        listeners.set(listenerGuid, {
          symbol: subscribed,
          resolution,
          onTick,
          onResetCacheNeededCallback,
        });
        const last = find(subscribed)?.bars.at(-1);
        if (!last) return;
        const epoch = listenerEpoch;
        deferLibraryCallback(() => {
          if (epoch !== listenerEpoch || !listeners.has(listenerGuid)) return;
          const selected = libraryBarsForRequest(find(subscribed)!.bars, resolution, { from: 0, to: (last.time + 1) / 1000, countBack: 1 });
          const bucket = selected.bars.at(-1);
          if (bucket) onTick(bucket);
        });
      },
      unsubscribeBars(listenerGuid) {
        listeners.delete(listenerGuid);
      },
    },
  };
}
