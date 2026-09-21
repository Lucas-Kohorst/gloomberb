import type { ChartResolution, TimeRange } from "../../../time-series/range";
import type { ChartSpec, ChartSeriesSource } from "../../../time-series/types";
import {
  canonicalExchange,
  normalizeSymbol,
  resolveExchangeTimeZone,
} from "../../../utils/exchanges";

export const TRADINGVIEW_CONNECTION_ID = "tradingview";
export const TRADINGVIEW_ORIGIN = "https://www.tradingview.com";

export type TradingViewInterval =
  | "1"
  | "5"
  | "15"
  | "30"
  | "45"
  | "60"
  | "240"
  | "D"
  | "W"
  | "M";

export interface TradingViewWidgetPlot {
  kind: "widget";
  symbol: string;
  compareSymbols: string[];
  interval: TradingViewInterval;
  timezone: string;
}

export type TradingViewPlot = TradingViewWidgetPlot | { kind: "unmapped" };

const PRICE_FIELD_IDS = new Set(["market.ohlcv", "market.close"]);

const TV_EXCHANGE_PREFIX: Record<string, string> = {
  ARCA: "AMEX",
  JPX: "TSE",
  XETRA: "XETR",
  FWB2: "FWB",
  EPA: "EURONEXT",
  AMS: "EURONEXT",
  SWX: "SIX",
  B3: "BMFBOVESPA",
};

const INTERVAL_FROM_RESOLUTION: Record<Exclude<ChartResolution, "auto">, TradingViewInterval> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "45m": "45",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1wk": "W",
  "1mo": "M",
};

const RANGE_PRESET_RESOLUTION: Record<TimeRange, Exclude<ChartResolution, "auto">> = {
  "1D": "1m",
  "1W": "5m",
  "1M": "15m",
  "3M": "1h",
  "6M": "1d",
  "1Y": "1d",
  "5Y": "1wk",
  ALL: "1mo",
};

function isMappablePriceSource(source: ChartSeriesSource): boolean {
  return source.kind === "security" && PRICE_FIELD_IDS.has(source.fieldId);
}

export function tradingViewSymbolForSecurity(instrument: {
  symbol: string;
  exchange?: string;
}): string {
  const symbol = normalizeSymbol(instrument.symbol);
  const exchange = canonicalExchange(instrument.exchange);
  if (!symbol) return "";
  if (exchange === "CCC") return symbol.replace(/[^A-Z0-9]/g, "");
  const prefix = TV_EXCHANGE_PREFIX[exchange]
    ?? (exchange && /^[A-Z0-9]{2,8}$/.test(exchange) ? exchange : "");
  return prefix ? `${prefix}:${symbol}` : symbol;
}

export function tradingViewIntervalForSpec(spec: Pick<ChartSpec, "viewport">): TradingViewInterval {
  const resolution = spec.viewport.resolution;
  if (resolution !== "auto") return INTERVAL_FROM_RESOLUTION[resolution] ?? "D";
  const preset = RANGE_PRESET_RESOLUTION[spec.viewport.range];
  return INTERVAL_FROM_RESOLUTION[preset] ?? "D";
}

export function resolveTradingViewPlot(spec: ChartSpec): TradingViewPlot {
  const legs: Array<{ symbol: string; timezone: string }> = [];
  for (const series of spec.series) {
    if (series.visible === false) continue;
    const source = series.source;
    if (isMappablePriceSource(source) && source.kind === "security") {
      const symbol = tradingViewSymbolForSecurity(source.instrument);
      if (!symbol) return { kind: "unmapped" };
      legs.push({
        symbol,
        timezone: resolveExchangeTimeZone(source.instrument.exchange) ?? "America/New_York",
      });
      continue;
    }
    if (source.kind === "economic" && source.provider === "fred") {
      const seriesId = source.seriesId.trim().toUpperCase();
      if (!seriesId) return { kind: "unmapped" };
      legs.push({ symbol: `FRED:${seriesId}`, timezone: "America/New_York" });
      continue;
    }
    if (source.kind === "constant") continue;
    return { kind: "unmapped" };
  }
  const primary = legs[0];
  if (!primary) return { kind: "unmapped" };
  return {
    kind: "widget",
    symbol: primary.symbol,
    compareSymbols: legs.slice(1).map((leg) => leg.symbol),
    interval: tradingViewIntervalForSpec(spec),
    timezone: primary.timezone,
  };
}

export function tradingViewPublicChartUrl(symbol: string): string {
  return `${TRADINGVIEW_ORIGIN}/chart/?symbol=${encodeURIComponent(symbol)}`;
}

export function tradingViewEmbedSrc(
  plot: TradingViewWidgetPlot,
  options: { theme: "dark" | "light"; backgroundColor: string },
): string {
  const config: Record<string, unknown> = {
    autosize: true,
    symbol: plot.symbol,
    interval: plot.interval,
    timezone: plot.timezone,
    theme: options.theme,
    style: "1",
    locale: "en",
    allow_symbol_change: false,
    hide_top_toolbar: false,
    hide_legend: false,
    hide_side_toolbar: false,
    save_image: true,
    calendar: false,
    hide_volume: false,
    withdateranges: true,
    details: false,
    hotlist: false,
    support_host: TRADINGVIEW_ORIGIN,
    backgroundColor: options.backgroundColor,
  };
  if (plot.compareSymbols.length > 0) {
    config.compareSymbols = plot.compareSymbols.map((symbol) => ({
      symbol,
      position: "SameScale",
    }));
  }
  return `${TRADINGVIEW_ORIGIN}/embed-widget/advanced-chart/?locale=en#${encodeURIComponent(JSON.stringify(config))}`;
}
