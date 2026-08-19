import { mergeWeatherStation } from "./stations";
import type {
  WeatherDailyObservation,
  WeatherDailySnapshot,
  WeatherHourlyObservation,
  WeatherHourlySnapshot,
  WeatherReportStatus,
  WeatherStation,
} from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
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

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function normalizeWeatherReportStatus(value: unknown): WeatherReportStatus {
  const status = asString(value)?.toLowerCase().replace(/\s+/g, "_");
  if (status === "official" || status === "preliminary" || status === "pending" || status === "no_report") {
    return status;
  }
  return "unknown";
}

function stationFromPrimaryRow(row: Record<string, unknown>): WeatherStation | null {
  const station = asRecord(row.station) ?? row;
  const data = asRecord(row.data);
  return mergeWeatherStation({
    id: asString(station.cliId) ?? asString(data?.stationId) ?? asString(station.id) ?? undefined,
    city: asString(station.city) ?? asString(data?.location) ?? undefined,
    country: asString(station.country) ?? undefined,
    icao: asString(station.icao) ?? asString(station.icaoId) ?? undefined,
    timezone: asString(station.timezone) ?? undefined,
    region: asString(station.region) ?? undefined,
    isDomestic: asBoolean(station.isDomestic),
  });
}

function observationFromPrimaryRow(
  row: Record<string, unknown>,
  fallbackDate: string,
): { station: WeatherStation; observation: WeatherDailyObservation } | null {
  const station = stationFromPrimaryRow(row);
  if (!station) return null;
  const data = asRecord(row.data);
  const date = asString(data?.reportDate) ?? asString(row.date) ?? fallbackDate;
  const status = normalizeWeatherReportStatus(row.status);
  return {
    station,
    observation: {
      stationId: station.id,
      date,
      maxTemp: asNumber(data?.maxTemp ?? row.maxTemp),
      minTemp: asNumber(data?.minTemp ?? row.minTemp),
      precipitation: asNumber(data?.precipitation ?? row.precipitation),
      snowfall: asNumber(data?.snowfall ?? row.snowfall),
      status,
      official: status === "official" || asBoolean(data?.isOfficial) === true,
    },
  };
}

export function normalizePrimaryClimatePayload(
  payload: unknown,
  fetchedAt = Date.now(),
): WeatherDailySnapshot {
  const root = asRecord(payload) ?? {};
  const date = asString(root.date) ?? "";
  const rows = Array.isArray(root.results) ? root.results : [];
  const observations: WeatherDailyObservation[] = [];
  const stations: WeatherStation[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const parsed = observationFromPrimaryRow(record, date);
    if (!parsed) continue;
    observations.push(parsed.observation);
    if (!seen.has(parsed.station.id)) {
      seen.add(parsed.station.id);
      stations.push(parsed.station);
    }
  }
  return {
    date,
    fetchedAt,
    source: asString(root.source) ?? "live",
    observations,
    stations,
  };
}

export function normalizeInternationalClimatePayload(
  payload: unknown,
  fetchedAt = Date.now(),
): WeatherDailySnapshot {
  const root = asRecord(payload) ?? {};
  const date = asString(root.date) ?? "";
  const rows = Array.isArray(root.results) ? root.results : [];
  const observations: WeatherDailyObservation[] = [];
  const stations: WeatherStation[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const station = mergeWeatherStation({
      id: asString(record.icao) ?? asString(record.id) ?? undefined,
      city: asString(record.city) ?? undefined,
      country: asString(record.country) ?? undefined,
      icao: asString(record.icao) ?? undefined,
      timezone: asString(record.timezone) ?? undefined,
      region: asString(record.region) ?? undefined,
      isDomestic: false,
    });
    if (!station) continue;
    const status = normalizeWeatherReportStatus(record.status);
    observations.push({
      stationId: station.id,
      date: asString(record.date) ?? date,
      maxTemp: asNumber(record.maxTemp),
      minTemp: asNumber(record.minTemp),
      precipitation: null,
      snowfall: null,
      status,
      official: status === "official",
    });
    if (!seen.has(station.id)) {
      seen.add(station.id);
      stations.push(station);
    }
  }
  return {
    date,
    fetchedAt,
    source: asString(root.source) ?? "live",
    observations,
    stations,
  };
}

function hourlyFromObservation(
  obs: Record<string, unknown>,
  station: WeatherStation,
): WeatherHourlyObservation {
  return {
    stationId: station.id,
    icao: station.icao,
    date: asString(obs.localDate) ?? "",
    hourLocal: asNumber(obs.localHour),
    reportTimeUtc: asString(obs.reportTimeUTC),
    tempF: asNumber(obs.tempF),
    tempC: asNumber(obs.tempC),
    status: asString(obs.status),
  };
}

export function normalizeMetarPayload(
  payload: unknown,
  fetchedAt = Date.now(),
): WeatherHourlySnapshot {
  const root = asRecord(payload) ?? {};
  const rows = Array.isArray(root.stations) ? root.stations : [];
  const observations: WeatherHourlyObservation[] = [];
  const stations: WeatherStation[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const station = mergeWeatherStation({
      id: asString(record.icaoId) ?? asString(record.icao) ?? undefined,
      city: asString(record.stationName) ?? asString(record.city) ?? undefined,
      icao: asString(record.icaoId) ?? asString(record.icao) ?? undefined,
      timezone: asString(record.timezone) ?? undefined,
    });
    if (!station) continue;
    if (!seen.has(station.id)) {
      seen.add(station.id);
      stations.push(station);
    }
    const obsRows = Array.isArray(record.observations) ? record.observations : [];
    for (const obs of obsRows) {
      const obsRecord = asRecord(obs);
      if (!obsRecord) continue;
      observations.push(hourlyFromObservation(obsRecord, station));
    }
  }
  return {
    fetchedAt,
    source: asString(root.source) ?? "live",
    observations,
    stations,
  };
}

export function observationValue(
  observation: WeatherDailyObservation,
  metric: "high" | "low" | "precip",
): number | null {
  if (metric === "high") return observation.maxTemp;
  if (metric === "low") return observation.minTemp;
  return observation.precipitation;
}
