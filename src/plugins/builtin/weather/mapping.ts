import {
  canonicalWeatherStationId,
  cliProductForStation,
  findWeatherStation,
} from "./stations";
import { TWC_KALSHI_URL, type WeatherMarketSettlement, type WeatherMetric } from "./types";

const MONTHS: Readonly<Record<string, string>> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

const METRIC_ALIASES: Readonly<Record<string, WeatherMetric>> = {
  high: "high",
  tmax: "high",
  max: "high",
  maximum: "high",
  low: "low",
  tmin: "low",
  min: "low",
  minimum: "low",
  precip: "precip",
  prcp: "precip",
  rain: "precip",
  precipitation: "precip",
  hourly: "hourly",
  hour: "hourly",
  temp: "hourly",
  temperature: "hourly",
};

const KALSHI_SERIES_RE = /^KX(HIGH|LOWT|LOW|TEMP|RAIN)([A-Z]{2,8}?)(H|M)?$/;
const CLI_PRODUCT_RE = /\(CLI([A-Z]{2,5})\)/i;
const EVENT_DATE_RE = /-(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})(\d{2})?$/i;

function seriesTickerFromMaybeEvent(ticker: string | undefined): string | undefined {
  const trimmed = ticker?.trim().toUpperCase();
  if (!trimmed) return undefined;
  return trimmed.replace(/-[0-9].*$/, "") || trimmed;
}

export function parseWeatherMetric(token: string): WeatherMetric | null {
  const key = token.trim().toLowerCase();
  return METRIC_ALIASES[key] ?? null;
}

export function weatherMetricLabel(metric: WeatherMetric): string {
  switch (metric) {
    case "high": return "Daily high";
    case "low": return "Daily low";
    case "precip": return "Precipitation";
    case "hourly": return "Hourly temp";
  }
}

function metricFromKalshiKind(kind: string): WeatherMetric {
  if (kind === "LOW" || kind === "LOWT") return "low";
  if (kind === "TEMP") return "hourly";
  if (kind === "RAIN") return "precip";
  return "high";
}

export function parseKalshiWeatherSeriesTicker(ticker: string | undefined): {
  stationId: string;
  metric: WeatherMetric;
  seriesTicker: string;
} | null {
  const trimmed = seriesTickerFromMaybeEvent(ticker);
  if (!trimmed) return null;
  const match = KALSHI_SERIES_RE.exec(trimmed);
  if (!match) return null;
  const stationId = canonicalWeatherStationId(match[2] ?? "");
  if (!stationId) return null;
  return {
    stationId,
    metric: metricFromKalshiKind(match[1] ?? "HIGH"),
    seriesTicker: trimmed,
  };
}

export function parseCliProductFromText(text: string | undefined): string | null {
  if (!text) return null;
  const match = CLI_PRODUCT_RE.exec(text);
  return match?.[1] ? canonicalWeatherStationId(match[1]) : null;
}

export function parseKalshiWeatherEventStamp(eventTicker: string | undefined): {
  date: string;
  hour: number | null;
} | null {
  const trimmed = eventTicker?.trim().toUpperCase();
  if (!trimmed) return null;
  const match = EVENT_DATE_RE.exec(trimmed);
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = MONTHS[match[2] ?? ""];
  const day = match[3];
  if (!month || !day) return null;
  const hourToken = match[4];
  const hour = hourToken != null && hourToken.length === 2 ? Number(hourToken) : null;
  return {
    date: `${year}-${month}-${day}`,
    hour: hour != null && hour >= 0 && hour <= 23 ? hour : null,
  };
}

export interface WeatherSettlementHints {
  venue?: string;
  seriesTicker?: string | null;
  eventTicker?: string | null;
  marketId?: string | null;
  category?: string | null;
  title?: string | null;
  description?: string | null;
  rulesPrimary?: string | null;
  rulesSecondary?: string | null;
  resolutionSource?: string | null;
  settlementUrl?: string | null;
}

function textBlob(hints: WeatherSettlementHints): string {
  return [
    hints.resolutionSource,
    hints.rulesPrimary,
    hints.rulesSecondary,
    hints.description,
    hints.title,
    hints.category,
    hints.settlementUrl,
  ].filter(Boolean).join("\n");
}

export function isWeatherSettlementSource(hints: WeatherSettlementHints): boolean {
  const blob = textBlob(hints).toLowerCase();
  if (/weather company|weather\.com\/kalshi|climatological report|\bcli[a-z]{2,4}\b|national weather service/.test(blob)) {
    return true;
  }
  if (/climate and weather/i.test(hints.category ?? "") && parseKalshiWeatherSeriesTicker(hints.seriesTicker ?? undefined)) {
    return true;
  }
  return parseKalshiWeatherSeriesTicker(hints.seriesTicker ?? hints.eventTicker ?? hints.marketId ?? undefined) != null
    && /weather|climate|temperature|precipitation/i.test(blob);
}

export function resolveWeatherSettlement(hints: WeatherSettlementHints): WeatherMarketSettlement | null {
  if (hints.venue && hints.venue !== "kalshi") return null;
  const series = parseKalshiWeatherSeriesTicker(
    hints.seriesTicker
      ?? hints.eventTicker
      ?? hints.marketId
      ?? undefined,
  );
  const stamp = parseKalshiWeatherEventStamp(hints.eventTicker ?? hints.marketId ?? undefined);
  const fromRules = parseCliProductFromText(textBlob(hints));
  const stationId = fromRules ?? series?.stationId ?? null;
  if (!stationId || !findWeatherStation(stationId) && !canonicalWeatherStationId(stationId)) {
    return null;
  }
  if (!isWeatherSettlementSource(hints) && !series) return null;
  const date = stamp?.date;
  if (!date) return null;
  const metric = series?.metric ?? (/\blow(est)? temperature\b/i.test(hints.title ?? "") ? "low" : "high");
  const canonical = canonicalWeatherStationId(stationId) ?? stationId;
  return {
    stationId: canonical,
    metric,
    date,
    hour: stamp?.hour ?? null,
    seriesTicker: series?.seriesTicker ?? hints.seriesTicker ?? null,
    settlementUrl: hints.settlementUrl?.trim() || TWC_KALSHI_URL,
    cliProduct: cliProductForStation(canonical),
  };
}
