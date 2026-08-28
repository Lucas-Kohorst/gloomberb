import type { NwsObservation } from "./types";
import { NWS_OBSERVATIONS_PROVIDER_ID } from "./types";

/**
 * Normalize a NWS GeoJSON observation feature into a flat record.
 * The NWS observations API returns temperatures in Celsius (wmoUnit:degC);
 * we convert to Fahrenheit and preserve both.
 */
export function parseNwsObservationFeature(
  feature: unknown,
  icao: string,
): NwsObservation | null {
  if (!feature || typeof feature !== "object") return null;
  const record = feature as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const properties = record.properties;
  if (!properties || typeof properties !== "object") return null;
  const props = properties as Record<string, unknown>;

  const timestamp = typeof props.timestamp === "string" ? props.timestamp : null;
  const tempC = readQuantityValue(props.temperature, "wmoUnit:degC");
  const tempF = tempC != null ? celsiusToFahrenheit(tempC) : readQuantityValue(props.temperature, "wmoUnit:degF");
  const maxTempC24h = readQuantityValue(props.maxTemperatureLast24Hours, "wmoUnit:degC");
  const maxTempF24h = maxTempC24h != null
    ? celsiusToFahrenheit(maxTempC24h)
    : readQuantityValue(props.maxTemperatureLast24Hours, "wmoUnit:degF");
  const minTempC24h = readQuantityValue(props.minTemperatureLast24Hours, "wmoUnit:degC");
  const minTempF24h = minTempC24h != null
    ? celsiusToFahrenheit(minTempC24h)
    : readQuantityValue(props.minTemperatureLast24Hours, "wmoUnit:degF");
  const precipMm = readQuantityValue(props.precipitationLastHour, "wmoUnit:mm");
  const precipIn = precipMm != null ? mmToInches(precipMm) : readQuantityValue(props.precipitationLastHour, "wmoUnit:in");
  const qualityControl = typeof props.qualityControl === "object" && props.qualityControl !== null
    ? readString((props.qualityControl as Record<string, unknown>).qualityControl)
    : readString(props.qualityControl);

  return {
    provider: NWS_OBSERVATIONS_PROVIDER_ID,
    stationId: icao,
    icao,
    timestamp,
    tempF,
    tempC: tempC ?? celsiusFromFahrenheit(tempF),
    maxTempF24h,
    minTempF24h,
    precipIn,
    qualityControl,
    sourceUrl: id,
  };
}

export function parseNwsObservationCollection(
  body: unknown,
  icao: string,
): NwsObservation[] {
  if (!body || typeof body !== "object") return [];
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  const observations: NwsObservation[] = [];
  for (const feature of features) {
    const parsed = parseNwsObservationFeature(feature, icao);
    if (parsed) observations.push(parsed);
  }
  return observations;
}

/** Aggregate a station's observation timeseries into a daily max/min/precip. */
export function aggregateNwsDaily(
  observations: readonly NwsObservation[],
  icao: string,
  date: string,
  fetchedAt: number,
  sourceUrl: string | null,
): import("./types").NwsDailyAggregate {
  let maxTempF: number | null = null;
  let minTempF: number | null = null;
  let precipTotal = 0;
  let precipSamples = 0;
  let sampleCount = 0;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  for (const obs of observations) {
    if (!obs.timestamp) continue;
    const obsDate = obs.timestamp.slice(0, 10);
    if (obsDate !== date) continue;
    sampleCount += 1;
    if (firstTimestamp == null || obs.timestamp < firstTimestamp) firstTimestamp = obs.timestamp;
    if (lastTimestamp == null || obs.timestamp > lastTimestamp) lastTimestamp = obs.timestamp;
    if (obs.tempF != null) {
      if (maxTempF == null || obs.tempF > maxTempF) maxTempF = obs.tempF;
      if (minTempF == null || obs.tempF < minTempF) minTempF = obs.tempF;
    }
    if (obs.precipIn != null) {
      precipTotal += obs.precipIn;
      precipSamples += 1;
    }
  }

  return {
    provider: NWS_OBSERVATIONS_PROVIDER_ID,
    stationId: icao,
    icao,
    date,
    maxTempF,
    minTempF,
    precipIn: precipSamples > 0 ? roundPrecip(precipTotal) : null,
    sampleCount,
    firstTimestamp,
    lastTimestamp,
    sourceUrl,
    fetchedAt,
  };
}

function readQuantityValue(quantity: unknown, expectedUnit: string): number | null {
  if (!quantity || typeof quantity !== "object") return null;
  const record = quantity as Record<string, unknown>;
  const value = record.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const unitCode = typeof record.unitCode === "string" ? record.unitCode : "";
  if (unitCode && unitCode !== expectedUnit) return null;
  return value;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

function celsiusFromFahrenheit(fahrenheit: number | null): number | null {
  if (fahrenheit == null) return null;
  return Math.round(((fahrenheit - 32) * 5) / 9 * 10) / 10;
}

function mmToInches(mm: number): number {
  return Math.round(mm / 25.4 * 100) / 100;
}

function roundPrecip(value: number): number {
  return Math.round(value * 100) / 100;
}
