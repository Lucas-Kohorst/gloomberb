import { KALSHI_PROXY_PATH, isHostedWebClient } from "../../../shared/hosted-api";
import { fetchJson } from "../../prediction-markets/services/fetch";
import { canonicalWeatherStationId } from "./stations";

const KALSHI_API_ORIGIN = "https://external-api.kalshi.com/trade-api/v2";
const DEFAULT_LAST_SECONDS = 24 * 60 * 60;
const INDEX_CACHE_TTL_MS = 30_000;
const CALIBRATION_CACHE_TTL_MS = 60 * 60_000;

/** A raw member-station reading returned by `detailed=true`. */
export interface KalshiWeatherIndexStation {
  stationId: string | null;
  code: string | null;
  source: string | null;
  temperatureF: number | null;
  observedAtMs: number | null;
  receivedAtMs: number | null;
  primaryCode: string | null;
}

/** One minute in the Kalshi-computed city index. */
export interface KalshiWeatherIndexPoint {
  timestampMs: number;
  status: string | null;
  valueF: number | null;
  contributors: number | null;
  stations: KalshiWeatherIndexStation[];
  /** False when the receipt deadline has not produced an index value yet. */
  complete: boolean;
}

export interface KalshiWeatherIndex {
  city: string;
  units: string;
  configVersion: string | null;
  points: KalshiWeatherIndexPoint[];
  fetchedAt: number;
}

export interface KalshiWeatherCalibrationStation {
  stationId: string;
  weight: number | null;
  offsetC: number | null;
  updateNote: string | null;
}

export interface KalshiWeatherCalibration {
  configVersion: string;
  effectiveAtMs: number;
  cityReferenceC: number | null;
  stations: KalshiWeatherCalibrationStation[];
  publishedAtMs: number | null;
  changeReason: string | null;
  calibrationWindowStartMs: number | null;
  calibrationWindowEndMs: number | null;
}

export interface KalshiWeatherCalibrationTimeline {
  city: string;
  units: string;
  calibrations: KalshiWeatherCalibration[];
  fetchedAt: number;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const indexCache = new Map<string, CacheEntry<KalshiWeatherIndex>>();
const calibrationCache = new Map<string, CacheEntry<KalshiWeatherCalibrationTimeline>>();

/** Kalshi currently documents the Miami index first; keep this map explicit. */
const KALSHI_CITY_BY_STATION: Readonly<Record<string, string>> = {
  MIA: "miami",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** API timestamps are documented as milliseconds; tolerate seconds in fixtures or future variants. */
export function normalizeKalshiTimestamp(value: unknown): number | null {
  const timestamp = asFiniteNumber(value);
  if (timestamp == null || timestamp <= 0) return null;
  return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
}

function normalizeIndexStation(value: unknown): KalshiWeatherIndexStation | null {
  const row = asRecord(value);
  if (!row) return null;
  return {
    stationId: asString(row.station_id),
    code: asString(row.code),
    source: asString(row.source),
    temperatureF: asFiniteNumber(row.temp_f),
    observedAtMs: normalizeKalshiTimestamp(row.obs_time_ms),
    receivedAtMs: normalizeKalshiTimestamp(row.received_at_ms),
    primaryCode: asString(row.primary_code),
  };
}

export function normalizeKalshiWeatherIndexPoint(value: unknown): KalshiWeatherIndexPoint | null {
  const row = asRecord(value);
  if (!row) return null;
  const timestampMs = normalizeKalshiTimestamp(row.t);
  if (timestampMs == null) return null;
  const valueF = asFiniteNumber(row.v);
  const status = asString(row.status);
  const stations = Array.isArray(row.stations)
    ? row.stations.map(normalizeIndexStation).filter((station): station is KalshiWeatherIndexStation => station != null)
    : [];
  return {
    timestampMs,
    status,
    valueF,
    contributors: asFiniteNumber(row.contributors),
    stations,
    complete: valueF != null,
  };
}

export function normalizeKalshiWeatherIndex(
  payload: unknown,
  fetchedAt = Date.now(),
): KalshiWeatherIndex {
  const root = asRecord(payload) ?? {};
  const points = Array.isArray(root.timeseries)
    ? root.timeseries
      .map(normalizeKalshiWeatherIndexPoint)
      .filter((point): point is KalshiWeatherIndexPoint => point != null)
      .sort((left, right) => left.timestampMs - right.timestampMs)
    : [];
  return {
    city: asString(root.city) ?? "",
    units: asString(root.units) ?? "fahrenheit",
    configVersion: asString(root.config_version),
    points,
    fetchedAt,
  };
}

function normalizeCalibrationStation(value: unknown): KalshiWeatherCalibrationStation | null {
  const row = asRecord(value);
  const stationId = asString(row?.station_id);
  if (!stationId) return null;
  return {
    stationId,
    weight: asFiniteNumber(row?.weight),
    offsetC: asFiniteNumber(row?.offset_c),
    updateNote: asString(row?.update_note),
  };
}

export function normalizeKalshiWeatherCalibration(value: unknown): KalshiWeatherCalibration | null {
  const row = asRecord(value);
  const configVersion = asString(row?.config_version);
  const effectiveAtMs = normalizeKalshiTimestamp(row?.effective_at_ms);
  if (!configVersion || effectiveAtMs == null) return null;
  const stations = Array.isArray(row?.stations)
    ? row.stations
      .map(normalizeCalibrationStation)
      .filter((station): station is KalshiWeatherCalibrationStation => station != null)
    : [];
  return {
    configVersion,
    effectiveAtMs,
    cityReferenceC: asFiniteNumber(row?.city_reference_c),
    stations,
    publishedAtMs: normalizeKalshiTimestamp(row?.published_at_ms),
    changeReason: asString(row?.change_reason),
    calibrationWindowStartMs: normalizeKalshiTimestamp(row?.calibration_window_start_ms),
    calibrationWindowEndMs: normalizeKalshiTimestamp(row?.calibration_window_end_ms),
  };
}

export function normalizeKalshiWeatherCalibrationTimeline(
  payload: unknown,
  fetchedAt = Date.now(),
): KalshiWeatherCalibrationTimeline {
  const root = asRecord(payload) ?? {};
  const calibrations = Array.isArray(root.calibrations)
    ? root.calibrations
      .map(normalizeKalshiWeatherCalibration)
      .filter((calibration): calibration is KalshiWeatherCalibration => calibration != null)
      .sort((left, right) => left.effectiveAtMs - right.effectiveAtMs)
    : [];
  return {
    city: asString(root.city) ?? "",
    units: asString(root.units) ?? "celsius",
    calibrations,
    fetchedAt,
  };
}

export function kalshiWeatherCityForStation(stationId: string): string | null {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.trim().toUpperCase();
  return KALSHI_CITY_BY_STATION[canonical] ?? null;
}

export function kalshiWeatherIndexUrl(
  city: string,
  options: { lastSeconds?: number; detailed?: boolean } = {},
): string {
  const base = isHostedWebClient() ? KALSHI_PROXY_PATH : KALSHI_API_ORIGIN;
  const path = `${base}/live_data/weather/${encodeURIComponent(city)}`;
  const params = new URLSearchParams();
  params.set("last_sec", String(Math.max(60, Math.floor(options.lastSeconds ?? DEFAULT_LAST_SECONDS))));
  if (options.detailed) params.set("detailed", "true");
  return `${path}?${params.toString()}`;
}

export function kalshiWeatherCalibrationUrl(city: string): string {
  const base = isHostedWebClient() ? KALSHI_PROXY_PATH : KALSHI_API_ORIGIN;
  return `${base}/live_data/weather/${encodeURIComponent(city)}/calibrations`;
}

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string, now: number): T | null {
  const entry = cache.get(key);
  return entry && entry.expiresAt > now ? entry.value : null;
}

function cacheSet<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  now: number,
): T {
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export async function loadKalshiWeatherIndex(
  city: string,
  options: { lastSeconds?: number; detailed?: boolean; now?: number } = {},
): Promise<KalshiWeatherIndex> {
  const normalizedCity = city.trim().toLowerCase();
  if (!normalizedCity) return { city: "", units: "fahrenheit", configVersion: null, points: [], fetchedAt: options.now ?? Date.now() };
  const now = options.now ?? Date.now();
  const lastSeconds = Math.max(60, Math.floor(options.lastSeconds ?? DEFAULT_LAST_SECONDS));
  const detailed = options.detailed === true;
  const key = `${normalizedCity}:${lastSeconds}:${detailed ? "detailed" : "compact"}`;
  const cached = cacheGet(indexCache, key, now);
  if (cached) return cached;
  const payload = await fetchJson<unknown>(kalshiWeatherIndexUrl(normalizedCity, { lastSeconds, detailed }));
  return cacheSet(indexCache, key, normalizeKalshiWeatherIndex(payload, now), INDEX_CACHE_TTL_MS, now);
}

export async function loadKalshiWeatherIndexForStation(
  stationId: string,
  options: { lastSeconds?: number; detailed?: boolean; now?: number } = {},
): Promise<KalshiWeatherIndex | null> {
  const city = kalshiWeatherCityForStation(stationId);
  return city ? loadKalshiWeatherIndex(city, options) : null;
}

export async function loadKalshiWeatherCalibrations(
  city: string,
  now = Date.now(),
): Promise<KalshiWeatherCalibrationTimeline> {
  const normalizedCity = city.trim().toLowerCase();
  if (!normalizedCity) return { city: "", units: "celsius", calibrations: [], fetchedAt: now };
  const cached = cacheGet(calibrationCache, normalizedCity, now);
  if (cached) return cached;
  const payload = await fetchJson<unknown>(kalshiWeatherCalibrationUrl(normalizedCity));
  return cacheSet(
    calibrationCache,
    normalizedCity,
    normalizeKalshiWeatherCalibrationTimeline(payload, now),
    CALIBRATION_CACHE_TTL_MS,
    now,
  );
}

export async function loadKalshiWeatherCalibrationsForStation(
  stationId: string,
  now = Date.now(),
): Promise<KalshiWeatherCalibrationTimeline | null> {
  const city = kalshiWeatherCityForStation(stationId);
  return city ? loadKalshiWeatherCalibrations(city, now) : null;
}

export function latestCompleteKalshiWeatherPoint(
  index: KalshiWeatherIndex | null,
): KalshiWeatherIndexPoint | null {
  if (!index) return null;
  for (let i = index.points.length - 1; i >= 0; i -= 1) {
    if (index.points[i]!.complete) return index.points[i]!;
  }
  return null;
}

export function resetKalshiWeatherCaches(): void {
  indexCache.clear();
  calibrationCache.clear();
}
