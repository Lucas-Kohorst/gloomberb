import type { DayWindowKind } from "./day-window";
import { settlementDateKey } from "./day-window";
import { canonicalWeatherStationId, findWeatherStation } from "./stations";
import type { WeatherMetric, WeatherPrintProvider, WeatherStation } from "./types";

export type WeatherVenue = "kalshi" | "polymarket" | "polymarket-us" | "robinhood" | "ibkr";
export type ResolutionSource = "nws-cli" | "weather-gov" | "wunderground" | "twc" | "hko";

export interface WeatherMarketTarget {
  stationId: string;
  icao: string;
  venue: WeatherVenue;
  source: ResolutionSource;
  window: DayWindowKind;
  metric: WeatherMetric;
}

const POLYMARKET_CLOCK_STATIONS = new Set(["ORD", "DAL"]);

export function normalizeVenue(value: string | undefined | null): WeatherVenue | null {
  const key = value?.trim().toLowerCase();
  if (key === "kalshi") return "kalshi";
  if (key === "polymarket-us" || key === "polymarketus" || key === "pm-us") return "polymarket-us";
  if (key === "polymarket" || key === "polymarket.com") return "polymarket";
  if (key === "robinhood") return "robinhood";
  if (key === "ibkr" || key === "interactive-brokers") return "ibkr";
  return null;
}

export function windowForSource(source: ResolutionSource): DayWindowKind {
  return source === "nws-cli" ? "lst" : "clock";
}

export function printProviderForSource(source: ResolutionSource): WeatherPrintProvider {
  if (source === "nws-cli") return "nws-cli";
  if (source === "twc") return "twc-kalshi";
  return "nws-observations";
}

export function parseResolutionSource(text: string | undefined | null): ResolutionSource | null {
  if (!text) return null;
  const blob = text.toLowerCase();
  if (/hong kong observatory|\bhko\b/.test(blob)) return "hko";
  if (/weather\.gov|timeseries/.test(blob)) return "weather-gov";
  if (/weather underground|wunderground/.test(blob)) return "wunderground";
  if (/weather company|weather\.com\/kalshi/.test(blob)) return "twc";
  if (/climatological report|\bcli[a-z]{2,4}\b|national weather service|\bnws\b/.test(blob)) {
    return "nws-cli";
  }
  return null;
}

export function defaultVenueForStation(stationId: string): WeatherVenue {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId;
  const station = findWeatherStation(canonical);
  if (canonical === "HKG") return "polymarket";
  if (POLYMARKET_CLOCK_STATIONS.has(canonical)) return "polymarket";
  if (station?.scope === "international") return "polymarket";
  return "kalshi";
}

export function defaultSourceForVenue(venue: WeatherVenue, stationId: string): ResolutionSource {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId;
  if (canonical === "HKG") return "hko";
  if (venue === "kalshi" || venue === "polymarket-us") return "nws-cli";
  if (venue === "polymarket") return "weather-gov";
  return "wunderground";
}

export function defaultTargetForStation(
  station: Pick<WeatherStation, "id" | "icao">,
  venue?: WeatherVenue,
): WeatherMarketTarget {
  const resolvedVenue = venue ?? defaultVenueForStation(station.id);
  const source = defaultSourceForVenue(resolvedVenue, station.id);
  return {
    stationId: station.id,
    icao: station.icao,
    venue: resolvedVenue,
    source,
    window: windowForSource(source),
    metric: "high",
  };
}

export function stationDateKey(
  station: Pick<WeatherStation, "id" | "timezone">,
  utcMs = Date.now(),
  venue?: WeatherVenue,
): string {
  const target = defaultTargetForStation({ id: station.id, icao: "" }, venue);
  return settlementDateKey({
    utcMs,
    timeZone: station.timezone || "UTC",
    kind: target.window,
  });
}

export function windowLabel(kind: DayWindowKind): string {
  return kind === "lst" ? "LST day" : "clock day";
}
