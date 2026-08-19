import { roundImpliedTemp } from "./implied";
import { WEATHER_ARCHIVE_DAYS, type WeatherArchiveState, type WeatherDayRecord } from "./archive";
import { findWeatherStation } from "./stations";

export type WeatherForecastKind = "twc" | "implied";

export interface WeatherCityAccuracy {
  stationId: string;
  city: string;
  samples: number;
  hitRate: number;
  mae: number;
  bias: number;
}

export interface WeatherAccuracyReport {
  kind: WeatherForecastKind;
  days: number;
  samples: number;
  hitRate: number;
  mae: number;
  bias: number;
  cities: WeatherCityAccuracy[];
}

function forecastValue(row: WeatherDayRecord, kind: WeatherForecastKind): number | null {
  return kind === "implied" ? row.impliedHigh : row.forecastHigh;
}

function scoredRows(state: WeatherArchiveState, kind: WeatherForecastKind): WeatherDayRecord[] {
  return state.records.filter((row) => (
    row.settlementHigh != null && forecastValue(row, kind) != null
  ));
}

function stats(rows: readonly WeatherDayRecord[], kind: WeatherForecastKind): {
  samples: number;
  hitRate: number;
  mae: number;
  bias: number;
} {
  if (rows.length === 0) {
    return { samples: 0, hitRate: 0, mae: 0, bias: 0 };
  }
  let hits = 0;
  let abs = 0;
  let signed = 0;
  for (const row of rows) {
    const forecast = forecastValue(row, kind);
    const settlement = row.settlementHigh;
    if (forecast == null || settlement == null) continue;
    if (roundImpliedTemp(forecast) === roundImpliedTemp(settlement)) hits += 1;
    const delta = settlement - forecast;
    abs += Math.abs(delta);
    signed += delta;
  }
  const samples = rows.length;
  return {
    samples,
    hitRate: hits / samples,
    mae: abs / samples,
    bias: signed / samples,
  };
}

export function buildWeatherAccuracyReport(
  state: WeatherArchiveState,
  kind: WeatherForecastKind = "twc",
): WeatherAccuracyReport {
  const rows = scoredRows(state, kind);
  const byStation = new Map<string, WeatherDayRecord[]>();
  for (const row of rows) {
    const list = byStation.get(row.stationId);
    if (list) list.push(row);
    else byStation.set(row.stationId, [row]);
  }
  const cities = [...byStation.entries()]
    .map(([stationId, cityRows]) => {
      const summary = stats(cityRows, kind);
      return {
        stationId,
        city: findWeatherStation(stationId)?.city ?? stationId,
        ...summary,
      };
    })
    .sort((left, right) => right.samples - left.samples || left.mae - right.mae);
  return {
    kind,
    days: WEATHER_ARCHIVE_DAYS,
    ...stats(rows, kind),
    cities,
  };
}

export function formatHitRate(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatBias(value: number): string {
  if (!Number.isFinite(value) || value === 0) return value === 0 ? "0.0" : "—";
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : value.toFixed(0);
  return value > 0 ? `+${rounded}` : rounded;
}
