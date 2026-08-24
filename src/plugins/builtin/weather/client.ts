import { isHostedWebClient } from "../../../shared/hosted-api";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { canonicalWeatherStationId, findWeatherStation } from "./stations";
import {
  normalizeInternationalClimatePayload,
  normalizeMetarPayload,
  normalizePrimaryClimatePayload,
  observationValue,
} from "./normalize";
import {
  TWC_KALSHI_ORIGIN,
  WEATHER_CONNECTION_ID,
  type WeatherDailyObservation,
  type WeatherDailySnapshot,
  type WeatherHourlyObservation,
  type WeatherHourlySnapshot,
  type WeatherMetric,
} from "./types";

const DAILY_CACHE_TTL_MS = 10 * 60_000;
const TODAY_CACHE_TTL_MS = 60_000;
const HOURLY_CACHE_TTL_MS = 60_000;
const HISTORY_DAYS = 30;
const HISTORY_CONCURRENCY = 4;

function weatherTransport(url: string, init?: RequestInit): Promise<Response> {
  // Hosted web rewrites to `/api/weather/twc…`. Those must stay same-origin
  // browser fetches; the RPC http.fetch transport only accepts absolute URLs.
  if (url.startsWith("/")) return globalThis.fetch(url, init);
  return httpFetch(url, init);
}

const WEATHER_FETCH = createThrottledFetch({
  requestsPerMinute: 40,
  maxRetries: 2,
  timeoutMs: 12_000,
  backoffBaseMs: 400,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-weather",
  },
  transport: weatherTransport,
});

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const dailyCache = new Map<string, CacheEntry<WeatherDailySnapshot>>();
const hourlyCache = new Map<string, CacheEntry<WeatherHourlySnapshot>>();

/** Public TWC Kalshi JSON, or the hosted Worker proxy that avoids browser CORS. */
export function weatherRequestUrl(pathAndQuery: string): string {
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  if (isHostedWebClient()) return `/api/weather/twc${path}`;
  return `${TWC_KALSHI_ORIGIN}${path}`;
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateKey(date);
}

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string, now: number): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) return null;
  return entry.value;
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number, now: number): T {
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

async function fetchJson(pathAndQuery: string, operation: string): Promise<unknown> {
  return withConnectionRequest(WEATHER_CONNECTION_ID, operation, async () => {
    const response = await WEATHER_FETCH.fetch(weatherRequestUrl(pathAndQuery));
    if (!response.ok) {
      throw new Error(`Weather Company request failed (${response.status})`);
    }
    return await response.json();
  });
}

function dailyTtl(snapshot: WeatherDailySnapshot, requestedDate: string, now: number): number {
  const today = utcDateKey(new Date(now));
  if (requestedDate >= today) return TODAY_CACHE_TTL_MS;
  if (snapshot.observations.some((row) => row.status === "official" || row.status === "preliminary")) {
    return DAILY_CACHE_TTL_MS;
  }
  return TODAY_CACHE_TTL_MS;
}

export async function fetchPrimaryClimate(date: string, now = Date.now()): Promise<WeatherDailySnapshot> {
  const key = `primary:${date}`;
  const cached = cacheGet(dailyCache, key, now);
  if (cached) return cached;
  const payload = await fetchJson(`/kalshi/api/climate/primary?date=${encodeURIComponent(date)}`, "climate-primary");
  const snapshot = normalizePrimaryClimatePayload(payload, now);
  return cacheSet(dailyCache, key, snapshot, dailyTtl(snapshot, date, now), now);
}

export async function fetchInternationalClimate(date: string, now = Date.now()): Promise<WeatherDailySnapshot> {
  const key = `intl:${date}`;
  const cached = cacheGet(dailyCache, key, now);
  if (cached) return cached;
  const payload = await fetchJson(
    `/kalshi/api/climate/international?date=${encodeURIComponent(date)}`,
    "climate-international",
  );
  const snapshot = normalizeInternationalClimatePayload(payload, now);
  return cacheSet(dailyCache, key, snapshot, dailyTtl(snapshot, date, now), now);
}

export async function fetchMetarObservations(
  scope: "primary" | "international" = "primary",
  now = Date.now(),
): Promise<WeatherHourlySnapshot> {
  const key = `metar:${scope}`;
  const cached = cacheGet(hourlyCache, key, now);
  if (cached) return cached;
  const query = scope === "primary" ? "primary=true" : "international=true";
  const payload = await fetchJson(`/kalshi/api/metar?${query}`, "metar");
  const snapshot = normalizeMetarPayload(payload, now);
  return cacheSet(hourlyCache, key, snapshot, HOURLY_CACHE_TTL_MS, now);
}

async function mapPool<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function fetchClimateHistory(
  scope: "primary" | "international",
  days = HISTORY_DAYS,
  now = Date.now(),
): Promise<WeatherDailyObservation[]> {
  const end = utcDateKey(new Date(now));
  const dates: string[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    dates.push(addUtcDays(end, -offset));
  }
  const loader = scope === "international" ? fetchInternationalClimate : fetchPrimaryClimate;
  const snapshots = await mapPool(dates, HISTORY_CONCURRENCY, (date) => loader(date, now));
  return snapshots.flatMap((snapshot) => snapshot.observations);
}

export async function fetchDailyHistory(
  days = HISTORY_DAYS,
  now = Date.now(),
): Promise<WeatherDailyObservation[]> {
  return fetchClimateHistory("primary", days, now);
}

/** Official TWC CLI prints for the archive window. */
export async function fetchOfficialClimateHistory(
  days = HISTORY_DAYS,
  now = Date.now(),
  scopes: ReadonlyArray<"primary" | "international"> = ["primary"],
): Promise<WeatherDailyObservation[]> {
  const snapshots = await Promise.all(scopes.map((scope) => fetchClimateHistory(scope, days, now)));
  return snapshots.flat().filter((row) => row.official || row.status === "official");
}

export function latestObservationForStation(
  observations: readonly WeatherDailyObservation[],
  stationId: string,
): WeatherDailyObservation | null {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.toUpperCase();
  const matches = observations.filter((row) => row.stationId === canonical);
  return matches[0] ?? null;
}

export async function loadWeatherObservation(
  stationId: string,
  date: string,
): Promise<WeatherDailyObservation | null> {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.toUpperCase();
  const station = findWeatherStation(canonical);
  const snapshot = station?.scope === "international"
    ? await fetchInternationalClimate(date)
    : await fetchPrimaryClimate(date);
  return snapshot.observations.find((row) => row.stationId === canonical) ?? null;
}

export async function loadWeatherHourly(
  stationId: string,
): Promise<WeatherHourlyObservation[]> {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.toUpperCase();
  const station = findWeatherStation(canonical);
  const snapshot = await fetchMetarObservations(station?.scope === "international" ? "international" : "primary");
  return snapshot.observations
    .filter((row) => row.stationId === canonical)
    .sort((left, right) => (left.reportTimeUtc ?? "").localeCompare(right.reportTimeUtc ?? ""));
}

export interface WeatherSeriesPoints {
  points: Array<{ date: Date; value: number }>;
  label: string;
  unit: string;
  unitGroup: string;
}

export async function loadWeatherSeries(
  stationId: string,
  metric: WeatherMetric,
): Promise<WeatherSeriesPoints> {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.toUpperCase();
  const station = findWeatherStation(canonical);
  const label = `${station?.city ?? canonical} ${metric}`;
  if (metric === "hourly") {
    const observations = await loadWeatherHourly(canonical);
    const points = observations.flatMap((row) => {
      if (row.tempF == null || !row.reportTimeUtc) return [];
      const date = new Date(row.reportTimeUtc);
      if (!Number.isFinite(date.getTime())) return [];
      return [{ date, value: row.tempF }];
    });
    return {
      points,
      label,
      unit: "°F",
      unitGroup: "weather-temp",
    };
  }
  const history = await fetchClimateHistory(
    station?.scope === "international" ? "international" : "primary",
  );
  const points = history
    .filter((row) => row.stationId === canonical)
    .flatMap((row) => {
      const value = observationValue(row, metric);
      if (value == null) return [];
      const date = new Date(`${row.date}T00:00:00Z`);
      if (!Number.isFinite(date.getTime())) return [];
      return [{ date, value }];
    })
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  return {
    points,
    label,
    unit: metric === "precip" ? "in" : "°F",
    unitGroup: metric === "precip" ? "weather-precip" : "weather-temp",
  };
}

export function resetWeatherCaches(): void {
  dailyCache.clear();
  hourlyCache.clear();
}
