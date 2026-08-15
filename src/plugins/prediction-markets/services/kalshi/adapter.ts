import {
  buildPredictionCatalogResourceKey,
  buildPredictionDetailResourceKey,
} from "../../cache";
import { getKalshiCategoryNames } from "../../categories";
import type {
  PredictionBookLevel,
  PredictionBookSnapshot,
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionHistoryPoint,
  PredictionMarketDetail,
  PredictionMarketSummary,
  PredictionSiblingMarket,
  PredictionTrade,
} from "../../types";
import {
  fetchJson,
  loadCachedPredictionResource,
  parseFloatSafe,
  PREDICTION_CACHE_POLICIES,
} from "../fetch";
import {
  loadAdjacentVenueCatalog,
  shouldUseAdjacentCatalog,
} from "../adjacent/catalog";
import {
  normalizeKalshiBookLevel,
  normalizeKalshiCatalog,
  normalizeKalshiMarket,
} from "./normalize";
import type {
  KalshiCandlestickResponse,
  KalshiEventRecord,
  KalshiEventResponse,
  KalshiEventsResponse,
  KalshiMarketRecord,
  KalshiMarketsResponse,
  KalshiOrderbookResponse,
  KalshiTradesResponse,
} from "./types";

export { normalizeKalshiMarket } from "./normalize";

const KALSHI_API_BASE = "https://external-api.kalshi.com/trade-api/v2";
const KALSHI_EVENT_PAGE_LIMIT = 200;
const DEFAULT_KALSHI_EVENT_MAX_PAGES = 8;
const SEARCH_KALSHI_EVENT_MAX_PAGES = 4;
const KALSHI_MARKET_PAGE_LIMIT = 200;
const KALSHI_MARKET_MAX_PAGES = 5;
const KALSHI_TICKER_HYDRATE_BATCH = 80;

function buildKalshiCatalogUrl(cursor?: string, category?: string): string {
  const url = new URL(`${KALSHI_API_BASE}/events`);
  url.searchParams.set("limit", String(KALSHI_EVENT_PAGE_LIMIT));
  url.searchParams.set("status", "open");
  url.searchParams.set("with_nested_markets", "true");
  if (category) url.searchParams.set("category", category);
  if (cursor) url.searchParams.set("cursor", cursor);
  return url.toString();
}

function buildKalshiMarketsUrl(cursor?: string): string {
  const url = new URL(`${KALSHI_API_BASE}/markets`);
  url.searchParams.set("limit", String(KALSHI_MARKET_PAGE_LIMIT));
  url.searchParams.set("status", "open");
  url.searchParams.set("mve_filter", "exclude");
  if (cursor) url.searchParams.set("cursor", cursor);
  return url.toString();
}

async function fetchKalshiCatalogEvents(
  maxPages = DEFAULT_KALSHI_EVENT_MAX_PAGES,
): Promise<KalshiEventRecord[]> {
  const events: KalshiEventRecord[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetchJson<KalshiEventsResponse>(
      buildKalshiCatalogUrl(cursor),
    );
    events.push(...(response.events ?? []));
    cursor = response.cursor?.trim() || undefined;
    if (!cursor) break;
  }

  return events;
}

async function fetchKalshiCatalogEventsForCategory(
  categoryId: PredictionCategoryId,
  maxPages = DEFAULT_KALSHI_EVENT_MAX_PAGES,
): Promise<KalshiEventRecord[]> {
  const categories = getKalshiCategoryNames(categoryId);
  if (categories.length === 0) return await fetchKalshiCatalogEvents(maxPages);

  const deduped = new Map<string, KalshiEventRecord>();
  for (const category of categories) {
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const response = await fetchJson<KalshiEventsResponse>(
        buildKalshiCatalogUrl(cursor, category),
      );
      for (const event of response.events ?? []) {
        const key = event.event_ticker ?? event.title;
        deduped.set(key, event);
      }
      cursor = response.cursor?.trim() || undefined;
      if (!cursor) break;
    }
  }

  return [...deduped.values()];
}

async function fetchKalshiOpenMarkets(
  maxPages = KALSHI_MARKET_MAX_PAGES,
): Promise<KalshiMarketRecord[]> {
  const markets: KalshiMarketRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetchJson<KalshiMarketsResponse>(
      buildKalshiMarketsUrl(cursor),
    );
    markets.push(...(response.markets ?? []));
    cursor = response.cursor?.trim() || undefined;
    if (!cursor) break;
  }
  return markets;
}

async function loadKalshiVenueCatalog(
  searchQuery: string,
  categoryId: PredictionCategoryId,
  browseTab: PredictionBrowseTab,
): Promise<PredictionMarketSummary[]> {
  const maxPages = searchQuery
    ? SEARCH_KALSHI_EVENT_MAX_PAGES
    : DEFAULT_KALSHI_EVENT_MAX_PAGES;
  const [events, openMarkets] = await Promise.all([
    categoryId === "all"
      ? fetchKalshiCatalogEvents(maxPages)
      : fetchKalshiCatalogEventsForCategory(categoryId, maxPages),
    categoryId === "all" && !searchQuery
      ? fetchKalshiOpenMarkets().catch(() => [] as KalshiMarketRecord[])
      : Promise.resolve([] as KalshiMarketRecord[]),
  ]);
  const fromEvents = normalizeKalshiCatalog(events, searchQuery, categoryId, browseTab);
  if (openMarkets.length === 0) return fromEvents;
  const fromMarkets = normalizeKalshiCatalog(
    [{ title: "", markets: openMarkets }],
    searchQuery,
    categoryId,
    browseTab,
  );
  const merged = new Map<string, PredictionMarketSummary>();
  for (const market of [...fromMarkets, ...fromEvents]) {
    merged.set(market.key, market);
  }
  return [...merged.values()].sort((left, right) => {
    if (browseTab === "ending") {
      const leftEnds = left.endsAt ? new Date(left.endsAt).getTime() : Infinity;
      const rightEnds = right.endsAt ? new Date(right.endsAt).getTime() : Infinity;
      return leftEnds - rightEnds;
    }
    if (browseTab === "new") {
      const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightCreated = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightCreated - leftCreated;
    }
    return (right.volume24h ?? 0) - (left.volume24h ?? 0);
  });
}

export async function hydrateKalshiCatalogPrices(
  summaries: PredictionMarketSummary[],
): Promise<PredictionMarketSummary[]> {
  const kalshi = summaries.filter((summary) => summary.venue === "kalshi" && summary.marketId);
  if (kalshi.length === 0) return summaries;
  const byTicker = new Map<string, KalshiMarketRecord>();
  for (let index = 0; index < kalshi.length; index += KALSHI_TICKER_HYDRATE_BATCH) {
    const batch = kalshi.slice(index, index + KALSHI_TICKER_HYDRATE_BATCH);
    const url = new URL(`${KALSHI_API_BASE}/markets`);
    url.searchParams.set("tickers", batch.map((summary) => summary.marketId).join(","));
    try {
      const response = await fetchJson<{ markets?: KalshiMarketRecord[] }>(url.toString());
      for (const market of response.markets ?? []) {
        byTicker.set(market.ticker, market);
      }
    } catch {
      // Keep Adjacent catalog rows even if live quotes fail.
    }
  }
  if (byTicker.size === 0) return summaries;
  return summaries.map((summary) => {
    const record = byTicker.get(summary.marketId);
    if (!record) return summary;
    const live = normalizeKalshiMarket(record, {
      title: summary.eventLabel,
      category: summary.category,
    });
    if (!live) return summary;
    return {
      ...summary,
      ...live,
      key: summary.key,
      title: summary.title || live.title,
      marketLabel: summary.marketLabel || live.marketLabel,
      eventLabel: summary.eventLabel || live.eventLabel,
      category: summary.category ?? live.category,
      url: summary.url || live.url,
      volume24h: summary.volume24h ?? live.volume24h,
      volume24hUnit: summary.volume24h != null ? summary.volume24hUnit : live.volume24hUnit,
      totalVolume: summary.totalVolume ?? live.totalVolume,
      openInterest: summary.openInterest ?? live.openInterest,
    };
  });
}

export async function loadKalshiCatalog(
  searchQuery = "",
  categoryId: PredictionCategoryId = "all",
  browseTab: PredictionBrowseTab = "top",
): Promise<PredictionMarketSummary[]> {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  return await loadCachedPredictionResource(
    "catalog",
    buildPredictionCatalogResourceKey("kalshi", categoryId, normalizedQuery, browseTab),
    async () => {
      if (shouldUseAdjacentCatalog(browseTab, normalizedQuery)) {
        try {
          const adjacent = await loadAdjacentVenueCatalog("kalshi", normalizedQuery, categoryId);
          if (adjacent.length > 0) {
            return await hydrateKalshiCatalogPrices(adjacent);
          }
        } catch {
          // Fall back to the venue catalog when Adjacent is down or empty.
        }
      }
      return await loadKalshiVenueCatalog(normalizedQuery, categoryId, browseTab);
    },
    PREDICTION_CACHE_POLICIES.catalog,
  );
}

async function loadKalshiEvent(
  eventTicker: string | undefined,
): Promise<KalshiEventResponse | null> {
  if (!eventTicker) return null;
  try {
    return await loadCachedPredictionResource(
      "rules",
      `kalshi:event:${eventTicker}`,
      async () =>
        await fetchJson<KalshiEventResponse>(
          `${KALSHI_API_BASE}/events/${eventTicker}`,
        ),
      PREDICTION_CACHE_POLICIES.rules,
    );
  } catch {
    return null;
  }
}

async function loadKalshiTrades(
  summary: PredictionMarketSummary,
): Promise<PredictionTrade[]> {
  return await loadCachedPredictionResource(
    "trades",
    summary.key,
    async () => {
      const response = await fetchJson<KalshiTradesResponse>(
        `${KALSHI_API_BASE}/markets/trades?ticker=${summary.marketId}&limit=30`,
      );
      return (response.trades ?? []).map((trade) => ({
        id: trade.trade_id,
        timestamp: new Date(trade.created_time).getTime(),
        side: trade.taker_side === "no" ? "sell" : "buy",
        outcome: trade.taker_side === "no" ? "no" : "yes",
        price: parseFloatSafe(trade.yes_price_dollars) ?? 0,
        size: parseFloatSafe(trade.count_fp) ?? 0,
      }));
    },
    PREDICTION_CACHE_POLICIES.trades,
  );
}

async function loadKalshiBook(
  summary: PredictionMarketSummary,
): Promise<PredictionBookSnapshot> {
  return await loadCachedPredictionResource(
    "book",
    summary.key,
    async () => {
      const response = await fetchJson<KalshiOrderbookResponse>(
        `${KALSHI_API_BASE}/markets/${summary.marketId}/orderbook`,
      );
      const yesBids = (response.orderbook_fp?.yes_dollars ?? [])
        .map(normalizeKalshiBookLevel)
        .filter((level): level is PredictionBookLevel => level != null);
      const noBids = (response.orderbook_fp?.no_dollars ?? [])
        .map(normalizeKalshiBookLevel)
        .filter((level): level is PredictionBookLevel => level != null);
      return {
        yesBids,
        yesAsks: noBids.map((level) => ({
          price: Math.max(0, 1 - level.price),
          size: level.size,
        })),
        noBids,
        noAsks: yesBids.map((level) => ({
          price: Math.max(0, 1 - level.price),
          size: level.size,
        })),
        lastTradePrice: summary.lastTradePrice,
      };
    },
    PREDICTION_CACHE_POLICIES.book,
  );
}

export async function loadKalshiHistory(
  summary: PredictionMarketSummary,
  range: "1D" | "1W" | "1M" | "ALL",
): Promise<PredictionHistoryPoint[]> {
  const event = await loadKalshiEvent(summary.eventTicker);
  if (!event?.event?.series_ticker) return [];

  const now = Math.floor(Date.now() / 1000);
  const rangeSeconds =
    range === "1D"
      ? 24 * 60 * 60
      : range === "1W"
        ? 7 * 24 * 60 * 60
        : range === "1M"
          ? 30 * 24 * 60 * 60
          : 365 * 24 * 60 * 60;
  const periodInterval = range === "1D" ? 60 : range === "1W" ? 60 : 1440;
  const start = now - rangeSeconds;

  try {
    return await loadCachedPredictionResource(
      "history",
      `${summary.key}:${range}`,
      async () => {
        const response = await fetchJson<KalshiCandlestickResponse>(
          `${KALSHI_API_BASE}/series/${event.event.series_ticker}/markets/${summary.marketId}/candlesticks?start_ts=${start}&end_ts=${now}&period_interval=${periodInterval}`,
        );
        return (response.candlesticks ?? [])
          .map((candle) => ({
            date: new Date(candle.end_period_ts * 1000),
            close:
              parseFloatSafe(candle.price?.close_dollars) ??
              parseFloatSafe(candle.price?.previous_dollars) ??
              0,
            open: parseFloatSafe(candle.price?.open_dollars) ?? undefined,
            high: parseFloatSafe(candle.price?.high_dollars) ?? undefined,
            low: parseFloatSafe(candle.price?.low_dollars) ?? undefined,
            volume: parseFloatSafe(candle.volume_fp) ?? undefined,
          }))
          .filter((point) => Number.isFinite(point.date.getTime()));
      },
      PREDICTION_CACHE_POLICIES.history,
    );
  } catch {
    return [];
  }
}

export async function loadKalshiDetail(
  summary: PredictionMarketSummary,
  range: "1D" | "1W" | "1M" | "ALL",
): Promise<PredictionMarketDetail> {
  return await loadCachedPredictionResource(
    "detail",
    buildPredictionDetailResourceKey(summary.key, range),
    async () => {
      const [event, history, book, trades] = await Promise.all([
        loadKalshiEvent(summary.eventTicker),
        loadKalshiHistory(summary, range),
        loadKalshiBook(summary),
        loadKalshiTrades(summary),
      ]);
      const eventMeta = event?.event;
      const siblings: PredictionSiblingMarket[] = (event?.markets ?? [])
        .map((market) =>
          normalizeKalshiMarket(market, {
            title: eventMeta?.title,
            category: eventMeta?.category,
            series_ticker: eventMeta?.series_ticker,
            sub_title: eventMeta?.sub_title,
          }),
        )
        .filter((market): market is PredictionMarketSummary => market != null)
        .map((market) => ({
          key: market.key,
          marketId: market.marketId,
          label: market.marketLabel,
          yesPrice: market.yesPrice,
          volume24h: market.volume24h,
        }));

      return {
        summary: {
          ...summary,
          eventLabel: event?.event?.title ?? summary.eventLabel,
          category: event?.event?.category ?? summary.category,
          seriesTicker: event?.event?.series_ticker ?? summary.seriesTicker,
          tags: summary.tags?.length
            ? summary.tags
            : event?.event?.category
              ? [event.event.category]
              : [],
        },
        siblings,
        rules: [
          summary.rulesPrimary ?? "",
          summary.rulesSecondary ?? "",
        ].filter((value) => value.trim().length > 0),
        history,
        book,
        trades,
      };
    },
    PREDICTION_CACHE_POLICIES.detail,
  );
}
