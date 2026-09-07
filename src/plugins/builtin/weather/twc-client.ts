/**
 * The Weather Company (TWC) Kalshi plugin entry.
 *
 * Thin wrapper over HEAD's {@link ./client}. The shared client owns climate
 * history, METAR fetch, hosted-proxy routing, and Connections reporting.
 */

import { loadWeatherHourly, loadWeatherSeries, resetWeatherCaches, weatherRequestUrl } from "./client";
import {
  TWC_KALSHI_ORIGIN,
  TWC_KALSHI_URL,
  WEATHER_CONNECTION_ID,
  type WeatherHourlyObservation,
  type WeatherMetric,
  type WeatherObservation,
} from "./types";

export const TWC_KALSHI_CONNECTION_ID = WEATHER_CONNECTION_ID;
export { TWC_KALSHI_ORIGIN, TWC_KALSHI_URL };
export const twcRequestUrl = weatherRequestUrl;
export const resetTwcCache = resetWeatherCaches;

function toLiveObservation(row: WeatherHourlyObservation): WeatherObservation | null {
  const timestamp = row.reportTimeUtc ? Date.parse(row.reportTimeUtc) : Number.NaN;
  if (!Number.isFinite(timestamp)) return null;
  const settled = row.status === "settled" || row.status === "official" || row.status === "final";
  return {
    stationId: row.stationId,
    source: "twc-kalshi",
    timestamp,
    tempF: row.tempF ?? undefined,
    status: settled ? "final" : "preliminary",
    metric: "hourly",
  };
}

/** Hourly TWC METAR readings for a station, oldest to newest. */
export async function loadTwcHourly(stationId: string): Promise<WeatherObservation[]> {
  const rows = await loadWeatherHourly(stationId);
  return rows.flatMap((row) => {
    const parsed = toLiveObservation(row);
    return parsed ? [parsed] : [];
  });
}

/** Chart-ready series for the chart composer's `WX:station:metric` expression. */
export async function loadTwcSeries(stationId: string, metric: WeatherMetric) {
  return loadWeatherSeries(stationId, metric);
}
