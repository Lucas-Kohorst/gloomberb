import { fetchJsonNoRetry, parseFloatSafe } from "../../prediction-markets/services/fetch";
import { kalshiResponseMarkets } from "../../prediction-markets/services/kalshi/adapter";
import { isOpenKalshiStatus } from "../../prediction-markets/services/kalshi/normalize";
import type {
  KalshiCandlestickResponse,
  KalshiEventResponse,
  KalshiMarketRecord,
} from "../../prediction-markets/services/kalshi/types";
import { type WeatherArchiveImplied } from "./archive";
import {
  impliedBookLooksSettled,
  kalshiWeightedImpliedTemp,
  type WeatherImpliedBucket,
} from "./implied";
import { kalshiEventTickerForDate, kalshiHighSeriesForStation, zonedMidnightUtcMs } from "./mapping";
import { canonicalWeatherStationId } from "./stations";

const KALSHI_API_BASE = "https://external-api.kalshi.com/trade-api/v2";

const IMPLIED_CACHE_TTL_MS = 60_000;
const IMPLIED_CONCURRENCY = 4;
const CANDLE_LOOKBACK_SEC = 2 * 60 * 60;
const CANDLE_LOOKAHEAD_SEC = 12 * 60 * 60;

interface CacheEntry {
  expiresAt: number;
  value: WeatherArchiveImplied | null;
}

const impliedCache = new Map<string, CacheEntry>();

function strikeNumber(value: unknown): number | null {
  return parseFloatSafe(value);
}

function bucketFromMarket(record: KalshiMarketRecord): WeatherImpliedBucket {
  const yesBid = parseFloatSafe(record.yes_bid_dollars);
  const yesAsk = parseFloatSafe(record.yes_ask_dollars);
  const last = parseFloatSafe(record.last_price_dollars);
  const midpoint = yesBid != null && yesAsk != null ? (yesBid + yesAsk) / 2 : (yesAsk ?? yesBid ?? null);
  return {
    yesPrice: last != null && last > 0 ? last : midpoint,
    strikeType: record.strike_type,
    floorStrike: strikeNumber(record.floor_strike),
    capStrike: strikeNumber(record.cap_strike),
  };
}

function eventIsOpen(markets: readonly KalshiMarketRecord[]): boolean {
  return markets.some((market) => isOpenKalshiStatus(market.status));
}

async function mapPool<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

export function candlePriceAtFreeze(
  candles: readonly { end_period_ts: number; price?: { close_dollars?: string; previous_dollars?: string } }[],
  freezeSec: number,
): number | null {
  let atOrBefore: { ts: number; price: number } | null = null;
  let after: { ts: number; price: number } | null = null;
  const latest = freezeSec + CANDLE_LOOKAHEAD_SEC;
  for (const candle of candles) {
    const ts = candle.end_period_ts;
    const price = parseFloatSafe(candle.price?.close_dollars) ?? parseFloatSafe(candle.price?.previous_dollars);
    if (!Number.isFinite(ts) || price == null || price < 0) continue;
    if (ts <= freezeSec) {
      if (!atOrBefore || ts > atOrBefore.ts) atOrBefore = { ts, price };
      continue;
    }
    if (ts <= latest && (!after || ts < after.ts)) after = { ts, price };
  }
  return atOrBefore?.price ?? after?.price ?? null;
}

export async function loadKalshiImpliedHigh(
  stationId: string,
  date: string,
  now = Date.now(),
): Promise<WeatherArchiveImplied | null> {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.toUpperCase();
  const series = kalshiHighSeriesForStation(canonical);
  const eventTicker = series ? kalshiEventTickerForDate(series, date) : null;
  if (!eventTicker) return null;
  const cached = impliedCache.get(eventTicker);
  if (cached && cached.expiresAt > now) return cached.value;
  const event = await fetchJsonNoRetry<KalshiEventResponse>(
    `${KALSHI_API_BASE}/events/${encodeURIComponent(eventTicker)}?with_nested_markets=true`,
  ).catch(() => null);
  const markets = kalshiResponseMarkets(event);
  const forecast = kalshiWeightedImpliedTemp(markets.map(bucketFromMarket));
  const value = forecast
    ? {
        stationId: canonical,
        date,
        impliedHigh: forecast.implied,
        eventOpen: eventIsOpen(markets),
      }
    : null;
  impliedCache.set(eventTicker, { value, expiresAt: now + IMPLIED_CACHE_TTL_MS });
  return value;
}

export async function loadKalshiImpliedHighs(
  stationIds: readonly string[],
  date: string,
  now = Date.now(),
): Promise<WeatherArchiveImplied[]> {
  const unique = [...new Set(stationIds.map((id) => canonicalWeatherStationId(id) ?? id.toUpperCase()).filter(Boolean))];
  const results = await mapPool(unique, IMPLIED_CONCURRENCY, (stationId) => loadKalshiImpliedHigh(stationId, date, now));
  return results.filter((row): row is WeatherArchiveImplied => row != null);
}

/**
 * Reconstruct the open-book implied high at local midnight from Kalshi
 * candlesticks. Ignores settled 0/1 last prices.
 */
export async function loadKalshiImpliedHighAtLocalMidnight(
  stationId: string,
  date: string,
  timeZone: string,
): Promise<WeatherArchiveImplied | null> {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.toUpperCase();
  const series = kalshiHighSeriesForStation(canonical);
  const eventTicker = series ? kalshiEventTickerForDate(series, date) : null;
  if (!series || !eventTicker) return null;
  const freezeMs = zonedMidnightUtcMs(date, timeZone);
  if (!Number.isFinite(freezeMs)) return null;
  const freezeSec = Math.floor(freezeMs / 1000);
  const event = await fetchJsonNoRetry<KalshiEventResponse>(
    `${KALSHI_API_BASE}/events/${encodeURIComponent(eventTicker)}?with_nested_markets=true`,
  ).catch(() => null);
  const markets = kalshiResponseMarkets(event);
  if (markets.length === 0) return null;
  const start = freezeSec - CANDLE_LOOKBACK_SEC;
  const end = freezeSec + CANDLE_LOOKAHEAD_SEC;
  const buckets = await mapPool(markets, IMPLIED_CONCURRENCY, async (market) => {
    const response = await fetchJsonNoRetry<KalshiCandlestickResponse>(
      `${KALSHI_API_BASE}/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(market.ticker)}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=60`,
    ).catch(() => null);
    const yesPrice = candlePriceAtFreeze(response?.candlesticks ?? [], freezeSec);
    return {
      yesPrice,
      strikeType: market.strike_type,
      floorStrike: strikeNumber(market.floor_strike),
      capStrike: strikeNumber(market.cap_strike),
    } satisfies WeatherImpliedBucket;
  });
  if (impliedBookLooksSettled(buckets)) return null;
  const forecast = kalshiWeightedImpliedTemp(buckets);
  if (!forecast) return null;
  return {
    stationId: canonical,
    date,
    impliedHigh: forecast.implied,
    eventOpen: true,
  };
}

export function resetKalshiImpliedCache(): void {
  impliedCache.clear();
}
