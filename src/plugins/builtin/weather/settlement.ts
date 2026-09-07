/**
 * Weather settlement ticker resolver.
 *
 * Thin wrapper over HEAD's {@link ./mapping}. Adds the preferred settlement
 * source for a metric so the pane can pick TWC vs NWS CLI.
 */

import {
  inferWeatherMetricFromHints,
  isWeatherSettlementSource,
  parseCliProductFromText,
  parseKalshiWeatherEventStamp,
  parseKalshiWeatherSeriesTicker,
  resolveWeatherSettlement as resolveMappedSettlement,
  type WeatherSettlementHints,
} from "./mapping";
import { TWC_KALSHI_URL } from "./twc-client";
import type { WeatherMarketSettlement, WeatherMetric, WeatherPrintProvider } from "./types";

export type WeatherMarketInfo = WeatherSettlementHints;

export interface ResolvedWeatherSettlement extends WeatherMarketSettlement {
  /** Preferred settlement source for this market. */
  source: WeatherPrintProvider;
}

export {
  inferWeatherMetricFromHints,
  parseCliProductFromText,
  parseKalshiWeatherEventStamp,
  parseKalshiWeatherSeriesTicker,
};

export function isWeatherMarket(info: WeatherMarketInfo): boolean {
  return isWeatherSettlementSource(info);
}

/** The settlement source Kalshi weather markets resolve against by metric. */
export function settlementSourceForMetric(metric: WeatherMetric): WeatherPrintProvider {
  return metric === "hourly" ? "twc-kalshi" : "nws-cli";
}

/**
 * Resolve a Kalshi weather market to its station, metric, date, and the
 * settlement source to query. Returns null for non-weather markets or
 * markets without enough metadata (no station or no date).
 */
export function resolveWeatherSettlement(info: WeatherMarketInfo): ResolvedWeatherSettlement | null {
  const resolved = resolveMappedSettlement(info);
  if (!resolved) return null;
  return {
    ...resolved,
    source: settlementSourceForMetric(resolved.metric),
    settlementUrl: resolved.settlementUrl.trim() || TWC_KALSHI_URL,
  };
}
