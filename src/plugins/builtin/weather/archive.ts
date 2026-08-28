import { canonicalWeatherStationId } from "./stations";

export const WEATHER_ARCHIVE_DAYS = 30;
export const WEATHER_ARCHIVE_STATE_KEY = "forecast-archive";
export const WEATHER_ARCHIVE_SCHEMA_VERSION = 1;

export type WeatherArchiveMetric = "high" | "low" | "precip";

export interface WeatherDayRecord {
  stationId: string;
  date: string;
  /** TWC high captured before the official print. */
  forecastHigh: number | null;
  /** Kalshi probability-weighted high while the event was still open. */
  impliedHigh: number | null;
  /** TWC official max — the Kalshi settlement print. */
  settlementHigh: number | null;
  /** TWC low captured before the official print. */
  forecastLow: number | null;
  /** TWC official min — the Kalshi settlement print. */
  settlementLow: number | null;
  /** TWC precipitation captured before the official print. */
  forecastPrecip: number | null;
  /** TWC official precipitation — the Kalshi settlement print. */
  settlementPrecip: number | null;
  forecastCapturedAt: number | null;
  impliedCapturedAt: number | null;
  settledAt: number | null;
}

export interface WeatherArchiveState {
  records: WeatherDayRecord[];
}

export const EMPTY_WEATHER_ARCHIVE: WeatherArchiveState = { records: [] };

export interface WeatherArchiveObservation {
  stationId: string;
  date: string;
  high: number | null;
  /** Optional low (min temp) from the same observation. */
  low?: number | null;
  /** Optional precipitation from the same observation. */
  precip?: number | null;
  official: boolean;
}

export interface WeatherArchiveImplied {
  stationId: string;
  date: string;
  impliedHigh: number;
  eventOpen: boolean;
}

function recordKey(stationId: string, date: string): string {
  return `${stationId}:${date}`;
}

function emptyRecord(stationId: string, date: string): WeatherDayRecord {
  return {
    stationId,
    date,
    forecastHigh: null,
    impliedHigh: null,
    settlementHigh: null,
    forecastLow: null,
    settlementLow: null,
    forecastPrecip: null,
    settlementPrecip: null,
    forecastCapturedAt: null,
    impliedCapturedAt: null,
    settledAt: null,
  };
}

export function normalizeWeatherArchive(state: WeatherArchiveState | null | undefined): WeatherArchiveState {
  const records = Array.isArray(state?.records) ? state.records : [];
  const next: WeatherDayRecord[] = [];
  const seen = new Set<string>();
  for (const row of records) {
    if (!row || typeof row !== "object") continue;
    const stationId = canonicalWeatherStationId(String(row.stationId ?? "")) ?? "";
    const date = typeof row.date === "string" ? row.date : "";
    if (!stationId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const key = recordKey(stationId, date);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({
      stationId,
      date,
      forecastHigh: typeof row.forecastHigh === "number" && Number.isFinite(row.forecastHigh) ? row.forecastHigh : null,
      impliedHigh: typeof row.impliedHigh === "number" && Number.isFinite(row.impliedHigh) ? row.impliedHigh : null,
      settlementHigh: typeof row.settlementHigh === "number" && Number.isFinite(row.settlementHigh)
        ? row.settlementHigh
        : null,
      forecastLow: typeof row.forecastLow === "number" && Number.isFinite(row.forecastLow) ? row.forecastLow : null,
      settlementLow: typeof row.settlementLow === "number" && Number.isFinite(row.settlementLow)
        ? row.settlementLow
        : null,
      forecastPrecip: typeof row.forecastPrecip === "number" && Number.isFinite(row.forecastPrecip) ? row.forecastPrecip : null,
      settlementPrecip: typeof row.settlementPrecip === "number" && Number.isFinite(row.settlementPrecip)
        ? row.settlementPrecip
        : null,
      forecastCapturedAt: typeof row.forecastCapturedAt === "number" ? row.forecastCapturedAt : null,
      impliedCapturedAt: typeof row.impliedCapturedAt === "number" ? row.impliedCapturedAt : null,
      settledAt: typeof row.settledAt === "number" ? row.settledAt : null,
    });
  }
  next.sort((left, right) => right.date.localeCompare(left.date) || left.stationId.localeCompare(right.stationId));
  return { records: next };
}

function pruneArchive(records: WeatherDayRecord[], nowDate: string): WeatherDayRecord[] {
  const cutoff = addUtcDays(nowDate, -(WEATHER_ARCHIVE_DAYS - 1));
  return records.filter((row) => row.date >= cutoff);
}

export function addUtcDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function findWeatherDayRecord(
  state: WeatherArchiveState,
  stationId: string,
  date: string,
): WeatherDayRecord | null {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId;
  return state.records.find((row) => row.stationId === canonical && row.date === date) ?? null;
}

/**
 * Freeze the first in-day TWC high as the forecast, freeze the first open-event
 * Kalshi implied, and fill settlement once the official print lands. Does not
 * replace a stored forecast with the settlement number.
 */
export function mergeWeatherArchive(
  state: WeatherArchiveState,
  input: {
    observations?: readonly WeatherArchiveObservation[];
    implied?: readonly WeatherArchiveImplied[];
    now?: number;
    today?: string;
  },
): WeatherArchiveState {
  if (
    (input.observations == null || input.observations.length === 0)
    && (input.implied == null || input.implied.length === 0)
  ) {
    return state;
  }
  const now = input.now ?? Date.now();
  const today = input.today ?? new Date(now).toISOString().slice(0, 10);
  const byKey = new Map<string, WeatherDayRecord>();
  for (const row of normalizeWeatherArchive(state).records) {
    byKey.set(recordKey(row.stationId, row.date), { ...row });
  }

  for (const observation of input.observations ?? []) {
    const stationId = canonicalWeatherStationId(observation.stationId) ?? observation.stationId;
    if (!stationId || !observation.date) continue;
    const hasHigh = observation.high != null;
    const hasLow = observation.low != null;
    const hasPrecip = observation.precip != null;
    if (!hasHigh && !hasLow && !hasPrecip) continue;
    const key = recordKey(stationId, observation.date);
    const current = byKey.get(key) ?? emptyRecord(stationId, observation.date);
    if (observation.official) {
      if (hasHigh && current.settlementHigh == null) {
        current.settlementHigh = observation.high;
        current.settledAt = now;
      }
      if (hasLow && current.settlementLow == null) {
        current.settlementLow = observation.low;
        current.settledAt = now;
      }
      if (hasPrecip && current.settlementPrecip == null) {
        current.settlementPrecip = observation.precip;
        current.settledAt = now;
      }
    } else {
      if (hasHigh && current.forecastHigh == null) {
        current.forecastHigh = observation.high;
        current.forecastCapturedAt = now;
      }
      if (hasLow && current.forecastLow == null) {
        current.forecastLow = observation.low;
        current.forecastCapturedAt = now;
      }
      if (hasPrecip && current.forecastPrecip == null) {
        current.forecastPrecip = observation.precip;
        current.forecastCapturedAt = now;
      }
    }
    byKey.set(key, current);
  }

  for (const implied of input.implied ?? []) {
    if (!implied.eventOpen) continue;
    const stationId = canonicalWeatherStationId(implied.stationId) ?? implied.stationId;
    if (!stationId) continue;
    const key = recordKey(stationId, implied.date);
    const current = byKey.get(key) ?? emptyRecord(stationId, implied.date);
    if (current.impliedHigh == null) {
      current.impliedHigh = implied.impliedHigh;
      current.impliedCapturedAt = now;
      byKey.set(key, current);
    }
  }

  const records = pruneArchive([...byKey.values()], today);
  records.sort((left, right) => right.date.localeCompare(left.date) || left.stationId.localeCompare(right.stationId));
  return { records };
}

/** Forecast value for a metric, or null when never captured. */
export function archiveForecastValue(
  row: WeatherDayRecord,
  metric: WeatherArchiveMetric,
): number | null {
  if (metric === "low") return row.forecastLow;
  if (metric === "precip") return row.forecastPrecip;
  return row.forecastHigh;
}

/** Settlement value for a metric, or null when not yet official. */
export function archiveSettlementValue(
  row: WeatherDayRecord,
  metric: WeatherArchiveMetric,
): number | null {
  if (metric === "low") return row.settlementLow;
  if (metric === "precip") return row.settlementPrecip;
  return row.settlementHigh;
}

/**
 * Kalshi implied value for a metric. Only high has a mappable Kalshi series;
 * low and precip implied are null until a series mapping exists.
 */
export function archiveImpliedValue(
  row: WeatherDayRecord,
  metric: WeatherArchiveMetric,
): number | null {
  if (metric !== "high") return null;
  return row.impliedHigh;
}
