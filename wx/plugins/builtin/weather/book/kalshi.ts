import { KALSHI_PROXY_PATH, isHostedWebClient } from "../../../../../src/shared/hosted-api";
import { fetchJson, parseFloatSafe } from "../../../../../src/plugins/prediction-markets/services/fetch";
import type { KalshiEventResponse } from "../../../../../src/plugins/prediction-markets/services/kalshi/types";
import { SHARE_HOSTED_ORIGIN } from "../../../../../src/shares/routes";
import {
  KALSHI_API_BASE,
  kalshiEventMarkets,
  mapPool,
} from "../../../../../src/plugins/builtin/weather/kalshi-forecast";
import {
  kalshiEventTickerForDate,
  kalshiHighSeriesForStation,
  zonedMidnightUtcMs,
} from "../../../../../src/plugins/builtin/weather/mapping";
import {
  canonicalWeatherStationId,
  findWeatherStation,
} from "../../../../../src/plugins/builtin/weather/stations";
import { bucketFromMarket } from "./strikes";
import type { KalshiStrikeBookSeries, StrikeBucket, StrikeYesPoint, WxBookMetric } from "./types";

const BOOK_CACHE_TTL_MS = 60_000;
const CANDLE_CONCURRENCY = 3;
const DEFAULT_CUTOFF_ISO = "2026-07-03T00:00:00Z";

interface CacheEntry {
  expiresAt: number;
  value: KalshiStrikeBookSeries | null;
}

const bookCache = new Map<string, CacheEntry>();
let historicalCutoffMs: number | null = null;

function kalshiApiBase(): string {
  return isHostedWebClient() ? KALSHI_PROXY_PATH : KALSHI_API_BASE;
}

export function kalshiBookUrl(path: string): string {
  const base = kalshiApiBase();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (base.startsWith("http")) return `${base}${suffix}`;
  const origin = typeof location !== "undefined" && location.origin
    ? location.origin
    : SHARE_HOSTED_ORIGIN;
  return new URL(`${base}${suffix}`, origin).toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dollarClose(value: unknown): number | null {
  const row = asRecord(value);
  if (!row) return parseFloatSafe(value);
  return parseFloatSafe(row.close_dollars) ?? parseFloatSafe(row.close) ?? parseFloatSafe(row.previous_dollars);
}

export function candleYesPrice(candle: unknown): { t: number; yes: number } | null {
  const row = asRecord(candle);
  if (!row) return null;
  const t = parseFloatSafe(row.end_period_ts);
  if (t == null) return null;
  const bid = dollarClose(row.yes_bid);
  const ask = dollarClose(row.yes_ask);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
  const last = dollarClose(row.price);
  const yes = mid ?? last;
  if (yes == null || yes < 0) return null;
  return { t, yes };
}

function eventMeta(body: KalshiEventResponse | null): { eventTicker: string | null; seriesTicker: string | null } {
  if (!body?.event) return { eventTicker: null, seriesTicker: null };
  return {
    eventTicker: asString(body.event.event_ticker),
    seriesTicker: asString(body.event.series_ticker),
  };
}

async function historicalCutoffUtcMs(): Promise<number> {
  if (historicalCutoffMs != null) return historicalCutoffMs;
  const body = await fetchJson<unknown>(kalshiBookUrl("/historical/cutoff")).catch(() => null);
  const row = asRecord(body);
  const parsed = Date.parse(asString(row?.market_settled_ts) ?? DEFAULT_CUTOFF_ISO);
  historicalCutoffMs = Number.isFinite(parsed) ? parsed : Date.parse(DEFAULT_CUTOFF_ISO);
  return historicalCutoffMs;
}

async function loadCandles(
  seriesTicker: string,
  marketTicker: string,
  startSec: number,
  endSec: number,
  useHistorical: boolean,
): Promise<StrikeYesPoint[]> {
  const query = `start_ts=${startSec}&end_ts=${endSec}&period_interval=1`;
  const liveUrl = kalshiBookUrl(
    `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(marketTicker)}/candlesticks?${query}`,
  );
  const historicalUrl = kalshiBookUrl(
    `/historical/markets/${encodeURIComponent(marketTicker)}/candlesticks?${query}`,
  );
  const urls = useHistorical ? [historicalUrl, liveUrl] : [liveUrl, historicalUrl];
  for (const url of urls) {
    const body = await fetchJson<unknown>(url).catch(() => null);
    const row = asRecord(body);
    const raw = Array.isArray(row?.candlesticks) ? row.candlesticks : [];
    const points: StrikeYesPoint[] = [];
    for (const candle of raw) {
      const parsed = candleYesPrice(candle);
      if (parsed) points.push(parsed);
    }
    if (points.length > 0) return points;
  }
  return [];
}

export async function loadKalshiStrikeBookSeries(
  stationId: string,
  date: string,
  now = Date.now(),
  metric: WxBookMetric = "high",
  options?: { window?: "day" | "cutoff"; cutoffUtcMs?: number },
): Promise<KalshiStrikeBookSeries | null> {
  if (metric !== "high") return null;
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.trim().toUpperCase();
  const series = kalshiHighSeriesForStation(canonical);
  const eventTicker = series ? kalshiEventTickerForDate(series, date) : null;
  if (!series || !eventTicker) return null;
  const window = options?.window ?? "day";
  const cacheKey = `${series}:${eventTicker}:${window}`;
  const cached = bookCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const event = await fetchJson<KalshiEventResponse>(
    kalshiBookUrl(`/events/${encodeURIComponent(eventTicker)}?with_nested_markets=true`),
  ).catch(() => null);
  const markets = kalshiEventMarkets(event);
  const meta = eventMeta(event);
  const strikes: StrikeBucket[] = [];
  const marketTickers: string[] = [];
  let settlementF: number | null = null;
  for (const market of markets) {
    const ticker = market.ticker?.trim();
    if (!ticker) continue;
    const bucket = bucketFromMarket({
      ticker,
      strikeType: market.strike_type,
      floorStrike: parseFloatSafe(market.floor_strike),
      capStrike: parseFloatSafe(market.cap_strike),
      result: market.result,
    });
    if (!bucket) continue;
    strikes.push(bucket);
    marketTickers.push(ticker);
    const expiration = parseFloatSafe(market.expiration_value);
    if (expiration != null) settlementF = expiration;
  }
  if (strikes.length === 0) {
    bookCache.set(cacheKey, { value: null, expiresAt: now + BOOK_CACHE_TTL_MS });
    return null;
  }

  const station = findWeatherStation(canonical);
  const timeZone = station?.timezone ?? "UTC";
  const dayStartMs = zonedMidnightUtcMs(date, timeZone);
  const cutoffUtcMs = options?.cutoffUtcMs ?? dayStartMs + 11 * 60 * 60_000;
  const startMs = window === "cutoff" ? cutoffUtcMs - 6 * 60 * 60_000 : dayStartMs;
  const endMs = window === "cutoff" ? cutoffUtcMs + 30 * 60_000 : dayStartMs + 36 * 60 * 60_000;
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(Math.min(endMs, now) / 1000);
  const historicalCutoffMsNow = await historicalCutoffUtcMs();
  const useHistorical = dayStartMs < historicalCutoffMsNow;

  const paths = await mapPool(marketTickers, CANDLE_CONCURRENCY, (ticker) => (
    loadCandles(meta.seriesTicker ?? series, ticker, startSec, endSec, useHistorical)
  ));

  const value: KalshiStrikeBookSeries = {
    stationId: canonical,
    seriesTicker: meta.seriesTicker ?? series,
    eventTicker: meta.eventTicker ?? eventTicker,
    date,
    metric,
    strikes,
    paths,
    settlementF,
    candleSource: useHistorical ? "historical" : "live",
    fetchedAt: now,
  };
  bookCache.set(cacheKey, { value, expiresAt: now + BOOK_CACHE_TTL_MS });
  return value;
}

export function resetKalshiStrikeBookCache(): void {
  bookCache.clear();
  historicalCutoffMs = null;
}
