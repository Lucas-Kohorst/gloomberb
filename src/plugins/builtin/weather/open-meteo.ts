import { withConnectionRequest } from "../connections/register";
import { httpFetch } from "../../../utils/http-transport";
import { colors } from "../../../theme/colors";
import type { ResolvedSeries } from "../../../capabilities";
import type { ChartSeriesCatalogProvider } from "../../../types/plugin";
import {
  inSettlementWindow,
  settlementDateKey,
  settlementWindow,
  type DayWindowKind,
} from "./day-window";
import { defaultTargetForStation } from "./resolution";
import { OPEN_METEO_CONNECTION_ID } from "./types";
import { WEATHER_STATIONS, findWeatherStation } from "./stations";

export { OPEN_METEO_CONNECTION_ID };
export const OPEN_METEO_MODELS = ["gfs_hrrr", "gfs_global", "ecmwf_ifs025"] as const;
export type OpenMeteoModelId = (typeof OPEN_METEO_MODELS)[number];

const MODEL_LABEL: Record<OpenMeteoModelId, string> = {
  gfs_hrrr: "HRRR",
  gfs_global: "GFS",
  ecmwf_ifs025: "ECMWF IFS",
};

const FREE_HOST = "https://api.open-meteo.com/v1/forecast";
const CUSTOMER_HOST = "https://customer-api.open-meteo.com/v1/forecast";

export interface OpenMeteoHourlyPoint {
  validAtMs: number;
  tempF: number | null;
}

export interface OpenMeteoModelSeries {
  model: OpenMeteoModelId;
  hourly: OpenMeteoHourlyPoint[];
}

export interface OpenMeteoForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  generationMs: number | null;
  models: OpenMeteoModelSeries[];
}

export function openMeteoForecastUrl(args: {
  latitude: number;
  longitude: number;
  models?: readonly OpenMeteoModelId[];
  timezone: string;
  forecastDays?: number;
  apiKey?: string;
}): string {
  const models = args.models ?? OPEN_METEO_MODELS;
  const host = args.apiKey ? CUSTOMER_HOST : FREE_HOST;
  const params = new URLSearchParams({
    latitude: String(args.latitude),
    longitude: String(args.longitude),
    hourly: "temperature_2m",
    models: models.join(","),
    temperature_unit: "fahrenheit",
    timezone: args.timezone,
    forecast_days: String(args.forecastDays ?? 2),
    timeformat: "unixtime",
  });
  if (args.apiKey) params.set("apikey", args.apiKey);
  return `${host}?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function numberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers: number[] = [];
  for (const entry of value) {
    const number = finiteNumber(entry);
    if (number == null) return null;
    numbers.push(number);
  }
  return numbers;
}

function nullableNumberArray(value: unknown, length: number): Array<number | null> | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  return value.map((entry) => (entry == null ? null : finiteNumber(entry)));
}

function hourlyTemps(hourly: Record<string, unknown>, model: OpenMeteoModelId, modelCount: number): unknown {
  const suffixed = hourly[`temperature_2m_${model}`];
  if (suffixed != null) return suffixed;
  if (modelCount === 1) return hourly.temperature_2m;
  return hourly[`temperature_2m_${model}`];
}

export function parseOpenMeteoForecast(
  body: unknown,
  models: readonly OpenMeteoModelId[] = OPEN_METEO_MODELS,
): OpenMeteoForecast {
  if (!isRecord(body) || body.error === true) {
    const reason = isRecord(body) && typeof body.reason === "string" ? body.reason : "invalid Open-Meteo payload";
    throw new Error(reason);
  }
  const hourly = isRecord(body.hourly) ? body.hourly : null;
  if (!hourly) throw new Error("Open-Meteo payload is missing hourly data.");
  const times = numberArray(hourly.time);
  if (!times || times.length === 0) throw new Error("Open-Meteo payload is missing hourly timestamps.");

  const parsedModels: OpenMeteoModelSeries[] = [];
  for (const model of models) {
    const temps = nullableNumberArray(hourlyTemps(hourly, model, models.length), times.length);
    if (!temps) continue;
    parsedModels.push({
      model,
      hourly: times.map((unix, index) => ({
        validAtMs: unix * 1000,
        tempF: temps[index] ?? null,
      })),
    });
  }
  if (parsedModels.length === 0) {
    throw new Error("Open-Meteo payload had no requested model series.");
  }

  return {
    latitude: finiteNumber(body.latitude) ?? 0,
    longitude: finiteNumber(body.longitude) ?? 0,
    timezone: typeof body.timezone === "string" ? body.timezone : "UTC",
    generationMs: finiteNumber(body.generationtime_ms),
    models: parsedModels,
  };
}

export function dailyHighFromHourly(
  points: readonly OpenMeteoHourlyPoint[],
  dateKey: string,
  timeZone: string,
  kind: DayWindowKind,
): number | null {
  const window = settlementWindow({ dateKey, timeZone, kind });
  let high: number | null = null;
  for (const point of points) {
    if (!inSettlementWindow(point.validAtMs, window)) continue;
    if (point.tempF == null) continue;
    if (high == null || point.tempF > high) high = point.tempF;
  }
  return high;
}

const SERIES_RE = /^OM:([A-Z0-9]{2,4}):(high|low):(gfs_hrrr|gfs_global|ecmwf_ifs025)$/i;

export function parseOpenMeteoSeriesId(value: string): {
  stationId: string;
  metric: "high" | "low";
  model: OpenMeteoModelId;
} | null {
  const raw = SERIES_RE.exec(value.trim());
  if (!raw) return null;
  const station = findWeatherStation(raw[1] ?? "");
  if (!station) return null;
  const model = (raw[3] ?? "").toLowerCase();
  if (model !== "gfs_hrrr" && model !== "gfs_global" && model !== "ecmwf_ifs025") return null;
  return {
    stationId: station.id,
    metric: raw[2]?.toLowerCase() === "low" ? "low" : "high",
    model,
  };
}

export const openMeteoSeriesCatalog: ChartSeriesCatalogProvider = {
  id: "open-meteo",
  name: "Open-Meteo",
  sourceId: OPEN_METEO_CONNECTION_ID,
  entries: WEATHER_STATIONS.filter((station) => station.latitude != null && station.longitude != null).flatMap((station) => (
    OPEN_METEO_MODELS.map((model) => ({
      id: `OM:${station.id}:high:${model}`,
      expression: `OM:${station.id}:high:${model}`,
      label: `${station.city} ${MODEL_LABEL[model]} daily high`,
      source: "Open-Meteo",
      searchText: `${station.city} ${station.id} ${station.icao} ${MODEL_LABEL[model]} ${model} high temperature forecast open-meteo`.toLowerCase(),
      description: `Open-Meteo ${MODEL_LABEL[model]} hourly temperature, daily high over the station settlement window.`,
      detail: MODEL_LABEL[model],
      unit: "°F",
      frequency: "hourly",
    }))
  )),
  assist: {
    keywords: ["open-meteo", "hrrr", "gfs", "ecmwf", "forecast", "weather model"],
    examples: ["MDW HRRR high", "O'Hare GFS high"],
  },
};

async function fetchForecast(
  latitude: number,
  longitude: number,
  timezone: string,
  signal: AbortSignal,
): Promise<OpenMeteoForecast> {
  const url = openMeteoForecastUrl({ latitude, longitude, timezone });
  return withConnectionRequest(OPEN_METEO_CONNECTION_ID, "forecast", async () => {
    const response = await httpFetch(url, { headers: { Accept: "application/json" }, signal });
    if (!response.ok) {
      throw new Error(`Open-Meteo forecast failed (${response.status}).`);
    }
    return parseOpenMeteoForecast(await response.json());
  });
}

export async function resolveOpenMeteoChartSeries(
  seriesId: string,
  signal: AbortSignal,
): Promise<ResolvedSeries> {
  const parsed = parseOpenMeteoSeriesId(seriesId);
  if (!parsed) throw new Error(`Unknown Open-Meteo series "${seriesId}".`);
  const station = findWeatherStation(parsed.stationId);
  if (!station || station.latitude == null || station.longitude == null) {
    throw new Error(`Station ${parsed.stationId} has no coordinates for Open-Meteo.`);
  }
  const forecast = await fetchForecast(station.latitude, station.longitude, station.timezone, signal);
  const series = forecast.models.find((entry) => entry.model === parsed.model);
  if (!series) throw new Error(`Open-Meteo omitted model ${parsed.model}.`);
  const target = defaultTargetForStation(station);
  const byDay = new Map<string, number>();
  for (const point of series.hourly) {
    if (point.tempF == null) continue;
    const dateKey = settlementDateKey({
      utcMs: point.validAtMs,
      timeZone: station.timezone,
      kind: target.window,
    });
    const current = byDay.get(dateKey);
    if (current == null || point.tempF > current) byDay.set(dateKey, point.tempF);
  }
  const points = [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => {
      const observed = new Date(`${date}T00:00:00Z`);
      return {
        date: observed,
        observedAt: observed,
        value,
        provenance: { providerId: OPEN_METEO_CONNECTION_ID, quality: "reported" as const },
      };
    });
  return {
    id: seriesId,
    label: `${station.city} ${MODEL_LABEL[parsed.model]} daily high`,
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation: "none",
    nativeFrequency: "daily",
    unit: "°F",
    unitGroup: "temperature:F",
    color: colors.textBright,
    points,
  };
}
