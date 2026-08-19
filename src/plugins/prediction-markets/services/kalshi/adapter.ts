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
  fetchJsonNoRetry,
  loadCachedPredictionResource,
  parseFloatSafe,
  PREDICTION_CACHE_POLICIES,
} from "../fetch";
import {
  isKalshiRateLimitedError,
  kalshiParentTickers,
  kalshiSeriesTickerFromEvent,
  loadKalshiAdjacentHistory,
  loadKalshiAdjacentMarket,
  loadKalshiCatalogFromAdjacent,
} from "./adjacent-fallback";
import { revivePredictionHistoryPoints } from "../history";
import {
  isOpenKalshiStatus,
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
  KalshiOrderbookResponse,
  KalshiSeriesResponse,
  KalshiTradesResponse,
} from "./types";

export { normalizeKalshiMarket } from "./normalize";

const KALSHI_API_BASE = "https://external-api.kalshi.com/trade-api/v2";
const KALSHI_EVENT_PAGE_LIMIT = 200;
// Hosted users share one Worker egress IP; Kalshi 429s that budget if we
// fan out 8+5 pages on every catalog load.
const DEFAULT_KALSHI_EVENT_MAX_PAGES = 3;
const SEARCH_KALSHI_EVENT_MAX_PAGES = 2;
const KALSHI_SERIES_EVENT_LIMIT = 20;

function buildKalshiCatalogUrl(cursor?: string, category?: string): string {
  const url = new URL(`${KALSHI_API_BASE}/events`);
  url.searchParams.set("limit", String(KALSHI_EVENT_PAGE_LIMIT));
  url.searchParams.set("status", "open");
  url.searchParams.set("with_nested_markets", "true");
  if (category) url.searchParams.set("category", category);
  if (cursor) url.searchParams.set("cursor", cursor);
  return url.toString();
}

async function fetchKalshiCatalogEvents(
  maxPages = DEFAULT_KALSHI_EVENT_MAX_PAGES,
): Promise<KalshiEventRecord[]> {
  const events: KalshiEventRecord[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetchJsonNoRetry<KalshiEventsResponse>(
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
      const response = await fetchJsonNoRetry<KalshiEventsResponse>(
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

async function loadKalshiVenueCatalog(
  searchQuery: string,
  categoryId: PredictionCategoryId,
  browseTab: PredictionBrowseTab,
): Promise<PredictionMarketSummary[]> {
  const maxPages = searchQuery
    ? SEARCH_KALSHI_EVENT_MAX_PAGES
    : DEFAULT_KALSHI_EVENT_MAX_PAGES;
  let events: KalshiEventRecord[];
  try {
    events = categoryId === "all"
      ? await fetchKalshiCatalogEvents(maxPages)
      : await fetchKalshiCatalogEventsForCategory(categoryId, maxPages);
  } catch (error) {
    if (isKalshiRateLimitedError(error)) {
      return await loadKalshiCatalogFromAdjacent(searchQuery, categoryId, browseTab);
    }
    throw error;
  }
  const fromEvents = normalizeKalshiCatalog(events, searchQuery, categoryId, browseTab);
  return [...fromEvents].sort((left, right) => {
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

export async function loadKalshiCatalog(
  searchQuery = "",
  categoryId: PredictionCategoryId = "all",
  browseTab: PredictionBrowseTab = "top",
  options?: { force?: boolean },
): Promise<PredictionMarketSummary[]> {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  return await loadCachedPredictionResource(
    "catalog",
    buildPredictionCatalogResourceKey("kalshi", categoryId, normalizedQuery, browseTab),
    // Browse hits Kalshi directly. Hosted Worker egress is rate-limited on
    // /events; in that case we fall back to Adjacent's public Kalshi catalog.
    async () => await loadKalshiVenueCatalog(normalizedQuery, categoryId, browseTab),
    PREDICTION_CACHE_POLICIES.catalog,
    options,
  );
}

export function kalshiResponseMarkets(
  payload: Pick<KalshiEventResponse, "event" | "markets"> | KalshiEventRecord | null | undefined,
): KalshiMarketRecord[] {
  if (!payload) return [];
  if (payload.markets?.length) return payload.markets;
  if ("event" in payload) return payload.event?.markets ?? [];
  return [];
}

export async function loadKalshiEventByTicker(
  eventTicker: string | undefined,
): Promise<KalshiEventResponse | null> {
  return loadKalshiEvent(eventTicker);
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
        await fetchJsonNoRetry<KalshiEventResponse>(
          `${KALSHI_API_BASE}/events/${encodeURIComponent(eventTicker)}?with_nested_markets=true`,
        ),
      PREDICTION_CACHE_POLICIES.rules,
    );
  } catch {
    return null;
  }
}

async function fetchKalshiMarketByTicker(
  ticker: string,
): Promise<KalshiMarketRecord | null> {
  try {
    const response = await fetchJsonNoRetry<{ market?: KalshiMarketRecord }>(
      `${KALSHI_API_BASE}/markets/${encodeURIComponent(ticker)}`,
    );
    return response.market ?? null;
  } catch {
    return null;
  }
}

async function fetchKalshiEventsForSeries(
  seriesTicker: string,
): Promise<KalshiEventRecord[]> {
  const url = new URL(`${KALSHI_API_BASE}/events`);
  url.searchParams.set("series_ticker", seriesTicker);
  url.searchParams.set("with_nested_markets", "true");
  url.searchParams.set("limit", String(KALSHI_SERIES_EVENT_LIMIT));
  try {
    const response = await fetchJsonNoRetry<KalshiEventsResponse>(url.toString());
    return response.events ?? [];
  } catch {
    return [];
  }
}

function compareKalshiMarketProminence(
  left: PredictionMarketSummary,
  right: PredictionMarketSummary,
): number {
  const leftOpen = isOpenKalshiStatus(left.status) ? 1 : 0;
  const rightOpen = isOpenKalshiStatus(right.status) ? 1 : 0;
  if (leftOpen !== rightOpen) return rightOpen - leftOpen;
  const volumeDelta = (right.volume24h ?? 0) - (left.volume24h ?? 0);
  if (volumeDelta !== 0) return volumeDelta;
  return (right.openInterest ?? 0) - (left.openInterest ?? 0);
}

function kalshiEventMeta(event: KalshiEventRecord): {
  title?: string;
  category?: string;
  series_ticker?: string;
  sub_title?: string;
} {
  return {
    title: event.title,
    category: event.category,
    series_ticker: event.series_ticker,
    sub_title: event.sub_title,
  };
}

function eventRecordFromResponse(event: KalshiEventResponse): KalshiEventRecord {
  return {
    title: event.event.title,
    category: event.event.category,
    series_ticker: event.event.series_ticker,
    sub_title: event.event.sub_title,
    markets: event.markets,
  };
}

function findKalshiMarketByTicker(
  events: KalshiEventRecord[],
  ticker: string,
): PredictionMarketSummary | null {
  const needle = ticker.trim().toUpperCase();
  for (const event of events) {
    for (const record of event.markets ?? []) {
      if (record.ticker?.toUpperCase() !== needle) continue;
      const summary = normalizeKalshiMarket(record, kalshiEventMeta(event), {
        allowDormant: true,
      });
      if (summary) return summary;
    }
  }
  return null;
}

function pickBusiestKalshiMarket(
  events: KalshiEventRecord[],
): PredictionMarketSummary | null {
  let best: PredictionMarketSummary | null = null;
  for (const event of events) {
    for (const record of event.markets ?? []) {
      const summary = normalizeKalshiMarket(
        record,
        kalshiEventMeta(event),
        { allowDormant: true },
      );
      if (!summary) continue;
      if (!best || compareKalshiMarketProminence(summary, best) < 0) best = summary;
    }
  }
  return best;
}

/**
 * Resolves a venue-native Kalshi identifier onto a chartable market. Callers
 * hand us whatever the user or a search hit produced, which can be a market
 * ticker (`KXHIGHLAX-26AUG19-B82.5`), an event ticker (`KXHIGHLAX-26AUG19`),
 * or a series ticker (`KXHIGHLAX`). Event/series ids settle on their busiest
 * market; market ids prefer an exact nested-event match so decimal strikes
 * still chart when GET /markets/{ticker} 404s.
 */
export async function resolveKalshiMarketByTicker(
  ticker: string,
): Promise<PredictionMarketSummary | null> {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return null;

  const record = await fetchKalshiMarketByTicker(normalized);
  if (record) {
    const event = await loadKalshiEvent(record.event_ticker);
    return normalizeKalshiMarket(
      record,
      {
        title: event?.event?.title,
        category: event?.event?.category,
        series_ticker: event?.event?.series_ticker,
        sub_title: event?.event?.sub_title,
      },
      { allowDormant: true },
    );
  }

  const event = await loadKalshiEvent(normalized);
  if (event?.markets?.length) {
    const wrapped = [eventRecordFromResponse(event)];
    return findKalshiMarketByTicker(wrapped, normalized)
      ?? pickBusiestKalshiMarket(wrapped);
  }

  for (const parent of kalshiParentTickers(normalized)) {
    const parentEvent = await loadKalshiEvent(parent);
    if (!parentEvent?.markets?.length) continue;
    const exact = findKalshiMarketByTicker(
      [eventRecordFromResponse(parentEvent)],
      normalized,
    );
    if (exact) return exact;
  }

  const seriesEvents = await fetchKalshiEventsForSeries(normalized);
  const exactFromSeries = findKalshiMarketByTicker(seriesEvents, normalized);
  if (exactFromSeries) return exactFromSeries;
  const fromSeries = pickBusiestKalshiMarket(seriesEvents);
  if (fromSeries) return fromSeries;
  return await loadKalshiAdjacentMarket(normalized);
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
  const seriesTicker = event?.event?.series_ticker ?? summary.seriesTicker;
  if (!seriesTicker) {
    return await loadKalshiAdjacentHistory(summary.marketId);
  }

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
    const points = await loadCachedPredictionResource(
      "history",
      `${summary.key}:${range}`,
      async () => {
        const response = await fetchJsonNoRetry<KalshiCandlestickResponse>(
          `${KALSHI_API_BASE}/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(summary.marketId)}/candlesticks?start_ts=${start}&end_ts=${now}&period_interval=${periodInterval}`,
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
    return revivePredictionHistoryPoints(points);
  } catch {
    return await loadKalshiAdjacentHistory(summary.marketId);
  }
}

async function loadKalshiSeriesSettlement(
  seriesTicker: string | undefined,
): Promise<string | undefined> {
  const ticker = seriesTicker?.trim();
  if (!ticker) return undefined;
  try {
    const response = await fetchJsonNoRetry<KalshiSeriesResponse>(
      `${KALSHI_API_BASE}/series/${encodeURIComponent(ticker)}`,
    );
    const names = (response.series?.settlement_sources ?? [])
      .map((source) => source.name?.trim())
      .filter((name): name is string => !!name);
    return names.length > 0 ? names.join(", ") : undefined;
  } catch {
    return undefined;
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
      const seriesTicker = summary.seriesTicker
        || kalshiSeriesTickerFromEvent(summary.eventTicker);
      const [event, history, book, trades, resolutionSource] = await Promise.all([
        loadKalshiEvent(summary.eventTicker),
        loadKalshiHistory(summary, range),
        loadKalshiBook(summary),
        loadKalshiTrades(summary),
        loadKalshiSeriesSettlement(seriesTicker),
      ]);
      const eventMeta = event?.event;
      const siblings: PredictionSiblingMarket[] = kalshiResponseMarkets(event)
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
          seriesTicker: event?.event?.series_ticker ?? seriesTicker,
          resolutionSource: resolutionSource ?? summary.resolutionSource,
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
