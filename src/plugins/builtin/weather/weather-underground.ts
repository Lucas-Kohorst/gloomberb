import { isHostedWebClient } from "../../../shared/hosted-api";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { canonicalWeatherStationId, findWeatherStation } from "./stations";
import { normalizeWeatherReportStatus } from "./normalize";
import { type WeatherDailyObservation, type WeatherReportStatus } from "./types";
import { WEATHER_UNDERGROUND_CONNECTION_ID } from "./sources";

/**
 * Weather Underground (WU) fallback settlement feed.
 *
 * When the primary Weather Company climate print is unavailable for a station
 * (missing day, late official print, or a station TWC does not cover), WU
 * personal weather station history is used as a secondary observation source.
 * WU requires an API key; this module never stores or logs the key and only
 * accepts it as a parameter.
 */

export const WEATHER_UNDERGROUND_ORIGIN = "https://api.weather.com";
const WU_HISTORY_PATH = "/v2/pws/history/all";

const WU_FETCH = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 12_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-weather",
  },
  transport: (url, init) => {
    if (url.startsWith("/")) return globalThis.fetch(url, init);
    return httpFetch(url, init);
  },
});

const WU_CACHE_TTL_MS = 10 * 60_000;

export interface WeatherUndergroundDaily {
  stationId: string;
  /** WU PWS station id (e.g. `KHKO...`). May differ from the climate id. */
  pwsStationId: string | null;
  date: string;
  maxTempF: number | null;
  minTempF: number | null;
  precipitationIn: number | null;
  snowfallIn: number | null;
  status: WeatherReportStatus;
  fetchedAt: number;
  source: string;
}

interface CacheEntry {
  expiresAt: number;
  value: WeatherUndergroundDaily | null;
}

const wuCache = new Map<string, CacheEntry>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && value.trim() !== "T") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value != null) return value;
  }
  return null;
}

/**
 * Safely normalize a WU PWS history payload into a daily observation.
 *
 * Accepts the WU v2 `observations[]` history shape (each observation has an
 * `imperial`/`metric` block) and aggregates the max high, min low, and summed
 * precip for the requested local date. Never throws; returns null when the
 * payload has no usable observations for the date.
 */
export function normalizeWeatherUndergroundPayload(
  payload: unknown,
  stationId: string,
  date: string,
  fetchedAt = Date.now(),
): WeatherUndergroundDaily | null {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.toUpperCase();
  const root = asRecord(payload) ?? {};
  const observations = Array.isArray(root.observations) ? root.observations : [];
  if (observations.length === 0) return null;

  let maxTempF: number | null = null;
  let minTempF: number | null = null;
  let precipitationIn = 0;
  let snowfallIn = 0;
  let used = 0;

  for (const entry of observations) {
    const record = asRecord(entry);
    if (!record) continue;
    // Only count observations that fall on the requested local date when the
    // payload carries one; otherwise aggregate everything.
    const obsDay = asString(record.localDate) ?? asString(record.date);
    if (obsDay && date && obsDay !== date) continue;

    const imperial = asRecord(record.imperial) ?? record;
    const metric = asRecord(record.metric);

    const high = pickNumber(imperial, ["maxTemp", "maxtemp", "tempMax", "tempHigh"])
      ?? pickNumber(metric, ["maxTemp", "maxtemp", "tempMax", "tempHigh"]);
    const low = pickNumber(imperial, ["minTemp", "mintemp", "tempMin", "tempLow"])
      ?? pickNumber(metric, ["minTemp", "mintemp", "tempMin", "tempLow"]);
    const precip = pickNumber(imperial, ["precipTotal", "precip", "precipitation", "rainfall"])
      ?? pickNumber(metric, ["precipTotal", "precip", "precipitation", "rainfall"]);
    const snow = pickNumber(imperial, ["snowfall", "snow"])
      ?? pickNumber(metric, ["snowfall", "snow"]);

    if (high != null) maxTempF = maxTempF == null ? high : Math.max(maxTempF, high);
    if (low != null) minTempF = minTempF == null ? low : Math.min(minTempF, low);
    if (precip != null && precip > 0) precipitationIn += precip;
    if (snow != null && snow > 0) snowfallIn += snow;
    used += 1;
  }

  if (used === 0) return null;

  const pwsStationId = asString(root.stationID) ?? asString(root.stationId) ?? null;
  const status = normalizeWeatherReportStatus(root.status ?? "preliminary");

  return {
    stationId: canonical,
    pwsStationId,
    date,
    maxTempF,
    minTempF,
    precipitationIn: precipitationIn === 0 ? null : Math.round(precipitationIn * 1000) / 1000,
    snowfallIn: snowfallIn === 0 ? null : Math.round(snowfallIn * 1000) / 1000,
    status,
    fetchedAt,
    source: asString(root.source) ?? "weather-underground",
  };
}

/** Map a WU daily report onto the shared daily observation shape. */
export function weatherUndergroundToObservation(report: WeatherUndergroundDaily): WeatherDailyObservation {
  return {
    stationId: report.stationId,
    date: report.date,
    maxTemp: report.maxTempF,
    minTemp: report.minTempF,
    precipitation: report.precipitationIn,
    snowfall: report.snowfallIn,
    status: report.status,
    official: false,
  };
}

/** Hosted proxy path, or the public WU v2 origin for the desktop client. */
export function weatherUndergroundRequestUrl(
  pwsStationId: string,
  date: string,
  apiKey: string,
): string {
  const compact = date.replace(/-/g, "");
  const query = `?stationId=${encodeURIComponent(pwsStationId)}&format=json&units=e&date=${compact}&apiKey=${encodeURIComponent(apiKey)}`;
  if (isHostedWebClient()) return `/api/weather/wu/history${query}`;
  return `${WEATHER_UNDERGROUND_ORIGIN}${WU_HISTORY_PATH}${query}`;
}

/**
 * Fetch and normalize a WU PWS daily history for a climate station. The WU
 * station id defaults to the station ICAO; pass an explicit `pwsStationId` to
 * target a specific personal weather station. Returns null (never throws)
 * when the request fails, no API key is supplied, or the payload is empty.
 */
export async function fetchWeatherUndergroundObservation(
  stationId: string,
  date: string,
  apiKey: string | null,
  options?: { pwsStationId?: string; now?: number },
): Promise<WeatherUndergroundDaily | null> {
  if (!apiKey) return null;
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.toUpperCase();
  const station = findWeatherStation(canonical);
  const pwsStationId = options?.pwsStationId ?? station?.icao ?? canonical;
  const now = options?.now ?? Date.now();
  const cacheKey = `${canonical}:${date}`;
  const cached = wuCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await withConnectionRequest(WEATHER_UNDERGROUND_CONNECTION_ID, "wu-history", async () => {
    const response = await WU_FETCH.fetch(weatherUndergroundRequestUrl(pwsStationId, date, apiKey));
    if (!response.ok) throw new Error(`Weather Underground request failed (${response.status})`);
    return await response.json();
  })
    .then((payload) => normalizeWeatherUndergroundPayload(payload, canonical, date, now))
    .catch(() => null);
  wuCache.set(cacheKey, { value, expiresAt: now + WU_CACHE_TTL_MS });
  return value;
}

export type WeatherObservationSource = "primary" | "fallback" | "none";

export interface WeatherObservationWithFallback {
  observation: WeatherDailyObservation | null;
  source: WeatherObservationSource;
}

/**
 * Run a primary observation loader and fall back to Weather Underground when
 * the primary returns null (or rejects). The fallback is only attempted when a
 * WU API key is supplied. Never throws — a failed fallback reports `none`.
 */
export async function loadWeatherObservationWithFallback(
  stationId: string,
  date: string,
  apiKey: string | null,
  primary: (stationId: string, date: string) => Promise<WeatherDailyObservation | null>,
  options?: { pwsStationId?: string; now?: number },
): Promise<WeatherObservationWithFallback> {
  const primaryObs = await primary(stationId, date).catch(() => null);
  if (primaryObs) return { observation: primaryObs, source: "primary" };
  if (!apiKey) return { observation: null, source: "none" };
  const fallback = await fetchWeatherUndergroundObservation(stationId, date, apiKey, options);
  if (!fallback) return { observation: null, source: "none" };
  return { observation: weatherUndergroundToObservation(fallback), source: "fallback" };
}

/** Test helper. */
export function resetWeatherUndergroundCache(): void {
  wuCache.clear();
}
