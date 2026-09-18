import type { PredictionMarketSummary } from "../../types";
import { isHostedWebClient, KALSHI_PROXY_PATH } from "../../../../shared/hosted-api";
import { fetchJson } from "../fetch";
import { normalizeKalshiMarket } from "./normalize";
import type { KalshiEventResponse, KalshiMarketRecord } from "./types";

const MAX_KALSHI_SEARCH_HYDRATE = 20;
const KALSHI_TICKER_HYDRATE_CONCURRENCY = 4;

function kalshiTradeApiUrl(path: string): string {
  if (isHostedWebClient()) {
    const origin = typeof location !== "undefined" && location.origin
      ? location.origin
      : "https://terminal.kohor.st";
    return new URL(`${KALSHI_PROXY_PATH}${path}`, origin).toString();
  }
  return `https://api.elections.kalshi.com/trade-api/v2${path}`;
}

function kalshiEventUrl(eventTicker: string): string {
  return kalshiTradeApiUrl(`/events/${encodeURIComponent(eventTicker)}`);
}

function applyKalshiVenueStats(
  identity: PredictionMarketSummary,
  venue: PredictionMarketSummary,
): PredictionMarketSummary {
  return {
    ...identity,
    marketLabel: venue.marketLabel || identity.marketLabel,
    eventLabel: venue.eventLabel || identity.eventLabel,
    eventTicker: venue.eventTicker ?? identity.eventTicker,
    seriesTicker: venue.seriesTicker ?? identity.seriesTicker,
    category: venue.category ?? identity.category,
    tags: venue.tags?.length ? venue.tags : identity.tags,
    status: venue.status || identity.status,
    url: venue.url || identity.url,
    endsAt: venue.endsAt,
    updatedAt: venue.updatedAt,
    createdAt: venue.createdAt,
    yesPrice: venue.yesPrice,
    noPrice: venue.noPrice,
    yesBid: venue.yesBid,
    yesAsk: venue.yesAsk,
    noBid: venue.noBid,
    noAsk: venue.noAsk,
    spread: venue.spread,
    lastTradePrice: venue.lastTradePrice,
    volume24h: venue.volume24h,
    volume24hUnit: venue.volume24hUnit,
    totalVolume: venue.totalVolume,
    totalVolumeUnit: venue.totalVolumeUnit,
    openInterest: venue.openInterest,
    openInterestUnit: venue.openInterestUnit,
    liquidity: venue.liquidity,
    liquidityUnit: venue.liquidityUnit,
  };
}

async function loadKalshiEventForSearch(
  eventTicker: string,
  signal?: AbortSignal,
): Promise<KalshiEventResponse | null> {
  try {
    return await fetchJson<KalshiEventResponse>(kalshiEventUrl(eventTicker), signal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return null;
  }
}

async function loadKalshiMarketForSearch(
  ticker: string,
  signal?: AbortSignal,
): Promise<KalshiMarketRecord | null> {
  try {
    const response = await fetchJson<{ market?: KalshiMarketRecord }>(
      kalshiTradeApiUrl(`/markets/${encodeURIComponent(ticker)}`),
      signal,
    );
    return response.market ?? null;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return null;
  }
}

function needsKalshiVenueStats(market: PredictionMarketSummary): boolean {
  return market.venue === "kalshi" && market.yesPrice == null && market.volume24h == null;
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
}

function marketByTicker(
  markets: KalshiMarketRecord[] | undefined,
  ticker: string,
): KalshiMarketRecord | null {
  const wanted = ticker.trim().toUpperCase();
  return markets?.find((market) => market.ticker.trim().toUpperCase() === wanted) ?? null;
}

/**
 * Adjacent search is identity only. Kalshi SPR/vol/OI/ends/odds come from
 * the venue event payload, not Adjacent's public market list.
 */
export async function overlayKalshiVenueStatsOnSearch(
  markets: PredictionMarketSummary[],
  signal?: AbortSignal,
): Promise<PredictionMarketSummary[]> {
  if (markets.length === 0) return markets;
  const tickers: string[] = [];
  const seen = new Set<string>();
  for (const market of markets) {
    if (market.venue !== "kalshi") continue;
    const eventTicker = market.eventTicker?.trim();
    if (!eventTicker) continue;
    const key = eventTicker.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tickers.push(eventTicker);
    if (tickers.length >= MAX_KALSHI_SEARCH_HYDRATE) break;
  }

  const eventsByTicker = new Map<string, KalshiEventResponse>();
  if (tickers.length > 0) {
    const events = await Promise.all(
      tickers.map((ticker) => loadKalshiEventForSearch(ticker, signal)),
    );
    for (let index = 0; index < tickers.length; index += 1) {
      const event = events[index];
      if (!event?.event && !event?.markets?.length) continue;
      eventsByTicker.set(tickers[index]!.toUpperCase(), event);
      const eventTicker = event.event?.event_ticker?.trim();
      if (eventTicker) eventsByTicker.set(eventTicker.toUpperCase(), event);
    }
  }
  const fromEvents = eventsByTicker.size === 0
    ? markets
    : markets.map((market) => {
      if (market.venue !== "kalshi") return market;
      const eventTicker = market.eventTicker?.trim();
      if (!eventTicker) return market;
      const event = eventsByTicker.get(eventTicker.toUpperCase());
      if (!event) return market;
      const record = marketByTicker(event.markets, market.marketId);
      if (!record) return market;
      const venue = normalizeKalshiMarket(record, event.event, {
        allowDormant: true,
        catalog: true,
      });
      return venue ? applyKalshiVenueStats(market, venue) : market;
    });

  const unresolved = fromEvents.filter(needsKalshiVenueStats);
  if (unresolved.length === 0) return fromEvents;

  const byKey = new Map(fromEvents.map((market) => [market.key, market]));
  await mapPool(unresolved, KALSHI_TICKER_HYDRATE_CONCURRENCY, async (market) => {
    const record = await loadKalshiMarketForSearch(market.marketId, signal);
    if (!record) return;
    const venue = normalizeKalshiMarket(record, undefined, {
      allowDormant: true,
      catalog: true,
    });
    if (venue) byKey.set(market.key, applyKalshiVenueStats(market, venue));
  });
  return fromEvents.map((market) => byKey.get(market.key) ?? market);
}
