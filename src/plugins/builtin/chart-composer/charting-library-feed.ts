import type { ManualChartResolution } from "../../../time-series/resolution";
import type { TimeSeriesPoint } from "../../../time-series/types";

type LibraryAggregateResolution = ManualChartResolution | "4h";
import { libraryAxisUnit, libraryFeedUnits, libraryPriceScale, type LibraryPriceScale } from "./charting-library-options";

const LIBRARY_RESOLUTIONS = ["1", "5", "15", "30", "45", "60", "240", "D", "W", "M"] as const;

export interface LibraryBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface LibrarySearchItem {
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

const RESOLUTION_FROM_LIBRARY: Record<string, LibraryAggregateResolution> = {
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

export function resolutionFromLibraryInterval(interval: string): LibraryAggregateResolution {
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

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const LIBRARY_PERIOD_MS: Partial<Record<LibraryAggregateResolution, number>> = {
  "1d": 86_400_000,
  "1wk": 7 * 86_400_000,
  "1mo": 32 * 86_400_000,
};

function periodStartMs(resolution: LibraryAggregateResolution, timeMs: number): number | null {
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
  resolution: LibraryAggregateResolution,
  aggregateIntraday = false,
): readonly TimeSeriesPoint[] {
  const intradayMs: Partial<Record<LibraryAggregateResolution, number>> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "45m": 2_700_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
  };
  const bucketMs = aggregateIntraday ? intradayMs[resolution] : undefined;
  if (!LIBRARY_PERIOD_MS[resolution] && !bucketMs) return points;
  const groups = new Map<number, TimeSeriesPoint[]>();
  for (const point of points) {
    const start = bucketMs
      ? Math.floor(point.date.getTime() / bucketMs) * bucketMs
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

const DAILY_LIBRARY_RESOLUTIONS = ["D", "W", "M"] as const;

function libraryResolutionInfo(resolutions: readonly string[]): Record<string, unknown> {
  const intraday = resolutions.filter((resolution) => /^\d+$/.test(resolution));
  return {
    has_intraday: intraday.length > 0,
    intraday_multipliers: intraday,
    has_daily: resolutions.includes("D"),
    daily_multipliers: resolutions.includes("D") ? ["1"] : [],
    weekly_multipliers: resolutions.includes("W") ? ["1"] : [],
    monthly_multipliers: resolutions.includes("M") ? ["1"] : [],
    has_weekly_and_monthly: resolutions.includes("W") || resolutions.includes("M"),
    supported_resolutions: [...resolutions],
  };
}

function storedLibraryResolutions(bars: readonly LibraryBar[]): string[] {
  const gap = medianBarGapMs(bars);
  return LIBRARY_RESOLUTIONS.filter((resolution) =>
    DAILY_LIBRARY_RESOLUTIONS.some((daily) => daily === resolution)
    || (gap !== null && LIBRARY_BAR_SIZE_MS[resolution]! >= gap));
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
  const infoFor = (entry: { ticker: string; label: string; unit?: string; bars: LibraryBar[] }): Record<string, unknown> => {
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
    ...libraryResolutionInfo(storedLibraryResolutions(entry.bars)),
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
