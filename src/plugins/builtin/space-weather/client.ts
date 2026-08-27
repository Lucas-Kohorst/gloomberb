import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  SPACE_WEATHER_API_BASE_URL,
  SPACE_WEATHER_CONNECTION_ID,
  type KpReading,
  type SolarWindReading,
  type SpaceWeatherData,
  type XrayFlare,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_KP_READINGS = 48;
export const MAX_SOLAR_WIND_READINGS = 48;
export const MAX_FLARES = 48;

const swpcFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-space-weather",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function parseKpReading(raw: unknown): KpReading | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const timeTag = asDate(record.time_tag);
  if (!timeTag) return null;
  const kp = asNumber(record.kp);
  if (kp == null) return null;
  return {
    timeTag,
    kp,
    estimatedKp: asNumber(record.estimated_kp) ?? kp,
    kpShort: asString(record.kp_short) ?? `K${kp}`,
  };
}

function parseSolarWindReading(raw: unknown): SolarWindReading | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const timeTag = asDate(record.time_tag);
  if (!timeTag) return null;
  return {
    timeTag,
    bx: asNumber(record.bx) ?? 0,
    by: asNumber(record.by) ?? 0,
    bz: asNumber(record.bz) ?? 0,
    bt: asNumber(record.bt) ?? 0,
  };
}

function parseTail<T>(
  data: unknown,
  cap: number,
  parse: (raw: unknown) => T | null,
): T[] {
  const rows = Array.isArray(data) ? data : [];
  const start = rows.length > cap ? rows.length - cap : 0;
  const parsed: T[] = [];
  for (let i = start; i < rows.length; i++) {
    const item = parse(rows[i]);
    if (item) parsed.push(item);
  }
  return parsed;
}

function parseXrayFlare(raw: unknown): XrayFlare | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const timeTag = asDate(record.time_tag);
  if (!timeTag) return null;
  const classType = asString(record.class_type) ?? asString(record.class) ?? "unknown";
  return {
    timeTag,
    classType,
    intensity: asNumber(record.intensity) ?? 0,
    beginTime: asDate(record.begin_time) ?? null,
    maxTime: asDate(record.max_time) ?? null,
    endTime: asDate(record.end_time) ?? null,
  };
}

export class SpaceWeatherClient {
  /** Planetary K-index time series. */
  async getKpIndex(): Promise<KpReading[]> {
    return withConnectionRequest(SPACE_WEATHER_CONNECTION_ID, "fetch", async () => {
      const url = `${SPACE_WEATHER_API_BASE_URL}/products/noaa-planetary-k-index.json`;
      const response = await swpcFetch.fetch(url);
      if (!response.ok) {
        throw new Error(`SWPC request failed: ${response.status} ${response.statusText}`);
      }
      return parseTail(await response.json(), MAX_KP_READINGS, parseKpReading);
    });
  }

  /** Solar-wind magnetic-field readings (5-minute cadence). */
  async getSolarWind(): Promise<SolarWindReading[]> {
    return withConnectionRequest(SPACE_WEATHER_CONNECTION_ID, "fetch", async () => {
      const url = `${SPACE_WEATHER_API_BASE_URL}/products/solar-wind/mag-5-minute.json`;
      const response = await swpcFetch.fetch(url);
      if (!response.ok) {
        throw new Error(`SWPC request failed: ${response.status} ${response.statusText}`);
      }
      return parseTail(await response.json(), MAX_SOLAR_WIND_READINGS, parseSolarWindReading);
    });
  }

  /** GOES primary X-ray flare events from the last day. */
  async getXrayFlares(): Promise<XrayFlare[]> {
    return withConnectionRequest(SPACE_WEATHER_CONNECTION_ID, "fetch", async () => {
      const url = `${SPACE_WEATHER_API_BASE_URL}/products/goes/primary/xray-flares-1-day.json`;
      const response = await swpcFetch.fetch(url);
      if (!response.ok) {
        throw new Error(`SWPC request failed: ${response.status} ${response.statusText}`);
      }
      return parseTail(await response.json(), MAX_FLARES, parseXrayFlare);
    });
  }

  /** Fetch all three feeds in parallel. */
  async getAll(): Promise<SpaceWeatherData> {
    const [kpReadings, solarWind, flares] = await Promise.all([
      this.getKpIndex(),
      this.getSolarWind(),
      this.getXrayFlares(),
    ]);
    return { kpReadings, solarWind, flares };
  }
}
