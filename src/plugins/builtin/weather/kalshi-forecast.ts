import { fetchJsonNoRetry, parseFloatSafe } from "../../prediction-markets/services/fetch";
import { kalshiResponseMarkets } from "../../prediction-markets/services/kalshi/adapter";
import { isOpenKalshiStatus } from "../../prediction-markets/services/kalshi/normalize";
import type { KalshiEventResponse, KalshiMarketRecord } from "../../prediction-markets/services/kalshi/types";
import { type WeatherArchiveImplied } from "./archive";
import { kalshiWeightedImpliedTemp, type WeatherImpliedBucket } from "./implied";
import { kalshiEventTickerForDate, kalshiHighSeriesForStation } from "./mapping";
import { canonicalWeatherStationId } from "./stations";

const KALSHI_EVENT_URL = "https://external-api.kalshi.com/trade-api/v2/events";

const IMPLIED_CACHE_TTL_MS = 60_000;
const IMPLIED_CONCURRENCY = 4;

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
    `${KALSHI_EVENT_URL}/${encodeURIComponent(eventTicker)}?with_nested_markets=true`,
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

export function resetKalshiImpliedCache(): void {
  impliedCache.clear();
}
