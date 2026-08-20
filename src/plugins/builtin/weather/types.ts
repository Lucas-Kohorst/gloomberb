export const WEATHER_PLUGIN_ID = "weather";
export const WEATHER_PANE_ID = "weather";
export const WEATHER_CONNECTION_ID = "twc-kalshi";
export const NWS_CLI_CONNECTION_ID = "nws-cli";
export const TWC_KALSHI_URL = "https://weather.com/kalshi";
export const TWC_KALSHI_ORIGIN = "https://weather.com";

export type WeatherPrintProvider = "twc-kalshi" | "nws-cli";
export type WeatherMetric = "high" | "low" | "precip" | "hourly";
export type WeatherReportStatus = "official" | "preliminary" | "pending" | "no_report" | "unknown";
export type WeatherScope = "domestic" | "international";

export interface WeatherStation {
  /** TWC climate id, e.g. `LAX` (Kalshi CLI product is `CLILAX`). */
  id: string;
  city: string;
  country: string;
  icao: string;
  timezone: string;
  region?: string;
  scope: WeatherScope;
  aliases: readonly string[];
}

export interface WeatherDailyObservation {
  stationId: string;
  date: string;
  maxTemp: number | null;
  minTemp: number | null;
  precipitation: number | null;
  snowfall: number | null;
  status: WeatherReportStatus;
  official: boolean;
}

export interface WeatherHourlyObservation {
  stationId: string;
  icao: string;
  date: string;
  hourLocal: number | null;
  reportTimeUtc: string | null;
  tempF: number | null;
  tempC: number | null;
  status: string | null;
}

export interface WeatherDailySnapshot {
  date: string;
  fetchedAt: number;
  source: string;
  observations: WeatherDailyObservation[];
  stations: WeatherStation[];
}

export interface WeatherHourlySnapshot {
  fetchedAt: number;
  source: string;
  observations: WeatherHourlyObservation[];
  stations: WeatherStation[];
}

export interface WeatherSeriesRef {
  stationId: string;
  metric: WeatherMetric;
}

export interface WeatherMarketSettlement {
  stationId: string;
  metric: WeatherMetric;
  date: string;
  hour: number | null;
  seriesTicker: string | null;
  settlementUrl: string;
  cliProduct: string;
}
