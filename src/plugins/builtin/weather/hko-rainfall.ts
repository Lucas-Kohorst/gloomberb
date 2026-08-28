import { isHostedWebClient } from "../../../shared/hosted-api";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { canonicalWeatherStationId } from "./stations";
import { normalizeWeatherReportStatus } from "./normalize";
import { type WeatherDailyObservation, type WeatherReportStatus } from "./types";
import { HKO_RAINFALL_CONNECTION_ID } from "./sources";

/**
 * Hong Kong Observatory (HKO) monthly rainfall settlement feed.
 *
 * HKO publishes the monthly total rainfall measured at the Hong Kong
 * Observatory headquarters station (ICAO VHHH, climate id `HKG`). Kalshi's
 * international rainfall markets settle against that print, so this module
 * normalizes the HKO monthly figure into the shared
 * {@link WeatherDailyObservation} shape (precipitation, in inches) keyed to the
 * first day of the report month.
 */

/** HKO public JSON origin. The hosted Worker proxy rewrites under `/api/weather/hko`. */
export const HKO_ORIGIN = "https://www.hko.gov.hk";
const HKO_RAINFALL_PATH = "/en/cis/rainfall/monthly.json";

const HKO_FETCH = createThrottledFetch({
  requestsPerMinute: 12,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 600,
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

const RAINFALL_CACHE_TTL_MS = 30 * 60_000;
const MONTHLY_CACHE_TTL_MS = 6 * 60 * 60_000;

export interface HkoMonthlyRainfall {
  /** Canonical climate id (`HKG`) for the HKO station. */
  stationId: string;
  /** `YYYY-MM` for the report month. */
  yearMonth: string;
  /** Total rainfall for the month in millimeters. */
  rainfallMm: number | null;
  /** 1991–2020 climatological normal for the month, in millimeters. */
  normalMm: number | null;
  /** Observed minus normal, in millimeters (negative = drier than normal). */
  departureMm: number | null;
  status: WeatherReportStatus;
  fetchedAt: number;
  source: string;
}

interface CacheEntry {
  expiresAt: number;
  value: HkoMonthlyRainfall | null;
}

const rainfallCache = new Map<string, CacheEntry>();

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

function mmToInches(mm: number | null): number | null {
  if (mm == null) return null;
  return Math.round((mm / 25.4) * 1000) / 1000;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `2026-08` or `2026-8` → `2026-08`. Returns null for an out-of-range month. */
export function normalizeHkoYearMonth(value: unknown): string | null {
  const text = asString(value);
  if (text) {
    const match = /^(\d{4})-(\d{1,2})$/.exec(text);
    if (match) {
      const month = Number(match[2]);
      if (month >= 1 && month <= 12) return `${match[1]}-${pad2(month)}`;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const year = asNumber(record.year);
  const month = asNumber(record.month);
  if (year == null || month == null || month < 1 || month > 12) return null;
  return `${Math.trunc(year)}-${pad2(Math.trunc(month))}`;
}

function pickNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value != null) return value;
  }
  return null;
}

/**
 * Safely normalize an HKO monthly rainfall payload into a
 * {@link HkoMonthlyRainfall}. Accepts either a flat object
 * (`{ year, month, rainfallMm, normalMm, departureMm, status }`) or a wrapper
 * with a `results`/`data` array whose first usable row is used. Never throws;
 * returns null when no station or rainfall can be determined.
 */
export function normalizeHkoMonthlyRainfallPayload(
  payload: unknown,
  fetchedAt = Date.now(),
): HkoMonthlyRainfall | null {
  const root = asRecord(payload) ?? {};
  const stationId = canonicalWeatherStationId(asString(root.stationId) ?? asString(root.station) ?? "HKG") ?? "HKG";
  const yearMonth = normalizeHkoYearMonth(root.yearMonth) ?? normalizeHkoYearMonth({ year: root.year, month: root.month });
  if (!yearMonth) return null;

  let row: Record<string, unknown> = root;
  const results = Array.isArray(root.results) ? root.results : Array.isArray(root.data) ? root.data : null;
  if (results) {
    for (const candidate of results) {
      const record = asRecord(candidate);
      if (!record) continue;
      const candidateMonth = normalizeHkoYearMonth(record.yearMonth)
        ?? normalizeHkoYearMonth({ year: record.year, month: record.month });
      if (candidateMonth === yearMonth || !resultsHasMonth(results, yearMonth)) {
        row = record;
        break;
      }
    }
  }

  const rainfallMm = pickNumber(row, ["rainfallMm", "totalRainfallMm", "monthlyRainfallMm", "rainfall"]);
  const normalMm = pickNumber(row, ["normalMm", "normalRainfallMm", "normal"]);
  const departureMm = pickNumber(row, ["departureMm", "departureRainfallMm", "departure", "anomalyMm"]);
  const status = normalizeWeatherReportStatus(row.status ?? root.status);

  return {
    stationId,
    yearMonth,
    rainfallMm,
    normalMm,
    departureMm,
    status,
    fetchedAt,
    source: asString(root.source) ?? "hko",
  };
}

function resultsHasMonth(results: unknown[], yearMonth: string): boolean {
  for (const candidate of results) {
    const record = asRecord(candidate);
    if (!record) continue;
    const candidateMonth = normalizeHkoYearMonth(record.yearMonth)
      ?? normalizeHkoYearMonth({ year: record.year, month: record.month });
    if (candidateMonth === yearMonth) return true;
  }
  return false;
}

/** Map a monthly rainfall report onto the shared daily observation shape. */
export function hkoRainfallToObservation(report: HkoMonthlyRainfall): WeatherDailyObservation {
  return {
    stationId: report.stationId,
    date: `${report.yearMonth}-01`,
    maxTemp: null,
    minTemp: null,
    precipitation: mmToInches(report.rainfallMm),
    snowfall: null,
    status: report.status,
    official: report.status === "official",
  };
}

/** Hosted proxy path, or the public HKO JSON origin for the desktop client. */
export function hkoRainfallRequestUrl(year: number, month: number): string {
  const query = `?year=${encodeURIComponent(String(year))}&month=${encodeURIComponent(String(month))}`;
  if (isHostedWebClient()) return `/api/weather/hko/rainfall${query}`;
  return `${HKO_ORIGIN}${HKO_RAINFALL_PATH}${query}`;
}

function monthlyTtl(report: HkoMonthlyRainfall | null, now: number): number {
  if (!report) return RAINFALL_CACHE_TTL_MS;
  // A finalized monthly print is stable for hours; an in-progress month
  // refreshes faster so the running total stays current.
  if (report.status === "official") return MONTHLY_CACHE_TTL_MS;
  const currentMonth = new Date(now).toISOString().slice(0, 7);
  return report.yearMonth >= currentMonth ? RAINFALL_CACHE_TTL_MS : MONTHLY_CACHE_TTL_MS;
}

/**
 * Fetch and normalize HKO monthly rainfall for a `YYYY-MM` report month.
 * Returns null (never throws) when the request fails or the payload is empty.
 */
export async function fetchHkoMonthlyRainfall(
  yearMonth: string,
  now = Date.now(),
): Promise<HkoMonthlyRainfall | null> {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) return null;
  const cached = rainfallCache.get(yearMonth);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await withConnectionRequest(HKO_RAINFALL_CONNECTION_ID, "hko-rainfall", async () => {
    const response = await HKO_FETCH.fetch(hkoRainfallRequestUrl(Number(match[1]), Number(match[2])));
    if (!response.ok) throw new Error(`HKO rainfall request failed (${response.status})`);
    return await response.json();
  })
    .then((payload) => normalizeHkoMonthlyRainfallPayload(payload, now))
    .catch(() => null);
  rainfallCache.set(yearMonth, { value, expiresAt: now + monthlyTtl(value, now) });
  return value;
}

/** Test helper. */
export function resetHkoRainfallCache(): void {
  rainfallCache.clear();
}
