import type { TimeRange } from "../../time-series/range";
import {
  DEFAULT_CHART_RESOLUTION_SUPPORT,
  getPresetResolution,
  isIntradayResolution,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../../time-series/resolution";
import { aggregateTo4h } from "../../time-series/aggregate";
import { repairIsolatedIntradayOhlcOutliers } from "../../time-series/history-quality";
import type { PricePoint } from "../../types/financials";
import { normalizeSubUnitCurrency } from "./mappers";
import { getYahooSymbolsToTry } from "./symbols";
import type { ChartResult } from "./types";

const YAHOO_CHART_RANGE: Record<TimeRange, string> = {
  "1D": "1d",
  "1W": "5d",
  "1M": "1mo",
  "3M": "3mo",
  "6M": "6mo",
  "1Y": "1y",
  "5Y": "5y",
  "ALL": "max",
};

export function getYahooChartRangeParams(range: TimeRange): {
  range: string;
  interval: ManualChartResolution;
} {
  return {
    range: YAHOO_CHART_RANGE[range],
    interval: getPresetResolution(range),
  };
}

const YAHOO_RESOLUTION_SUPPORT = DEFAULT_CHART_RESOLUTION_SUPPORT;

type YahooChartFetcher = (
  symbol: string,
  range: string,
  interval: ManualChartResolution,
) => Promise<{
  meta: NonNullable<ChartResult["meta"]>;
  history: PricePoint[];
  events?: ChartResult["events"];
}>;

export function getYahooChartResolutionSupport(): ChartResolutionSupport[] {
  return YAHOO_RESOLUTION_SUPPORT;
}

export function getYahooChartResolutionCapabilities(): ManualChartResolution[] {
  return YAHOO_RESOLUTION_SUPPORT.map((entry) => entry.resolution);
}

export async function loadYahooPriceHistory({
  ticker,
  exchange,
  range,
  fetchChart,
}: {
  ticker: string;
  exchange: string;
  range: TimeRange;
  fetchChart: YahooChartFetcher;
}): Promise<PricePoint[]> {
  const params = getYahooChartRangeParams(range);
  return loadYahooPriceHistoryForResolution({
    ticker,
    exchange,
    chartRange: params.range,
    resolution: params.interval,
    fetchChart,
  });
}

export async function loadYahooPriceHistoryForResolution({
  ticker,
  exchange,
  bufferRange,
  chartRange,
  resolution,
  fetchChart,
}: {
  ticker: string;
  exchange: string;
  bufferRange?: TimeRange;
  chartRange?: string;
  resolution: ManualChartResolution;
  fetchChart: YahooChartFetcher;
}): Promise<PricePoint[]> {
  const sourceResolution: ManualChartResolution = resolution === "4h" ? "1h" : resolution;
  const effectiveChartRange = chartRange ?? getYahooChartRangeParams(bufferRange ?? "1Y").range;
  const symbolsToTry = getYahooSymbolsToTry(ticker, exchange);
  let lastError: any;

  for (const symbol of symbolsToTry) {
    try {
      const { meta, history } = await fetchChart(symbol, effectiveChartRange, sourceResolution);

      const { divisor } = normalizeSubUnitCurrency(meta.currency || "USD");
      if (divisor !== 1) {
        for (const point of history) {
          point.close /= divisor;
          if (point.open != null) point.open /= divisor;
          if (point.high != null) point.high /= divisor;
          if (point.low != null) point.low /= divisor;
        }
      }

      const repaired = isIntradayResolution(sourceResolution)
        ? repairIsolatedIntradayOhlcOutliers(history)
        : history;
      return resolution === "4h" ? aggregateTo4h(repaired) : repaired;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`No history for ${ticker}`);
}
