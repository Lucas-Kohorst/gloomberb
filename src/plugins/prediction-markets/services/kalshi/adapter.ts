import { isHostedWebClient, KALSHI_PROXY_PATH } from "../../../../shared/hosted-api";
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
  KalshiMarketsResponse,
  KalshiOrderbookResponse,
  KalshiTradesResponse,
} from "./types";

export { normalizeKalshiMarket } from "./normalize";

function kalshiApiBase(): string {
  return isHostedWebClient()
    ? KALSHI_PROXY_PATH
    : "https://external-api.kalshi.com/trade-api/v2";
  return isHostedWebClient()
    ? "/api/proxy/kalshi"
    : "https://external-api.kalshi.com/trade-api/v2";
}

function kalshiUrl(path: string): string {
  const base = kalshiApiBase();
  if (base.startsWith("http")) return `${base}${path}`;
  const origin =
    typeof location !== "undefined" && location.origin
      ? location.origin
      : "https://terminal.kohor.st";
  return new URL(`${base}${path}`, origin).toString();
}
const KALSHI_EVENT_PAGE_LIMIT = 200;
const DEFAULT_KALSHI_EVENT_MAX_PAGES = 8;
const SEARCH_KALSHI_EVENT_MAX_PAGES = 4;
const KALSHI_MARKET_PAGE_LIMIT = 200;
const KALSHI_MARKET_MAX_PAGES = 5;
const KALSHI_SERIES_EVENT_LIMIT = 20;
const kalshiCursors = new Map<string, string | null>();

function kalshiCursorKey(searchQuery: string, categoryId: PredictionCategoryId): string {
  return `${categoryId}:${searchQuery.trim().toLowerCase()}`;
}

function rememberKalshiCursor(
  searchQuery: string,
  categoryId: PredictionCategoryId,
  cursor: string | null,
): void {
  kalshiCursors.set(kalshiCursorKey(searchQuery, categoryId), cursor);
}

export function kalshiCatalogCursor(searchQuery: string, categoryId: PredictionCategoryId): string | null {
  return kalshiCursors.get(kalshiCursorKey(searchQuery, categoryId)) ?? null;
}

function buildKalshiCatalogUrl(cursor?: string, category?: string): string {
  const url = new URL(kalshiUrl("/events"));
  url.searchParams.set("limit", String(KALSHI_EVENT_PAGE_LIMIT));
  url.searchParams.set("status", "open");
  url.searchParams.set("with_nested_markets", "true");
  if (category) url.searchParams.set("category", category);
  if (cursor) url.searchParams.set("cursor", cursor);
  return url.toString();
}

function buildKalshiMarketsUrl(cursor?: string): string {
  const url = new URL(kalshiUrl("/markets"));
  url.searchParams.set("limit", String(KALSHI_MARKET_PAGE_LIMIT));
  url.searchParams.set("status", "open");
  url.searchParams.set("mve_filter", "exclude");
  if (cursor) url.searchParams.set("cursor", cursor);
  return url.toString();
}

async function fetchKalshiCatalogEvents(
  maxPages = DEFAULT_KALSHI_EVENT_MAX_PAGES,
  _limit = KALSHI_EVENT_PAGE_LIMIT,
  _signal?: AbortSignal,
  startCursor?: string,
): Promise<{ events: KalshiEventRecord[]; nextCursor: string | null }> {
  const events: KalshiEventRecord[] = [];
  let cursor: string | undefined = startCursor;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetchJson<KalshiEventsResponse>(
      buildKalshiCatalogUrl(cursor),
    );
    events.push(...(response.events ?? []));
    cursor = response.cursor?.trim() || undefined;
    if (!cursor) break;
  }

  return { events, nextCursor: cursor ?? null };
}

async function fetchKalshiCatalogEventsForCategory(
  categoryId: PredictionCategoryId,
  maxPages = DEFAULT_KALSHI_EVENT_MAX_PAGES,
  limit = KALSHI_EVENT_PAGE_LIMIT,
  signal?: AbortSignal,
  startCursor?: string,
): Promise<{ events: KalshiEventRecord[]; nextCursor: string | null }> {
  const categories = getKalshiCategoryNames(categoryId);
  if (categories.length === 0) return await fetchKalshiCatalogEvents(maxPages, limit, signal, startCursor);

  const deduped = new Map<string, KalshiEventRecord>();
  let nextCursor: string | null = null;
  for (const category of categories) {
    let cursor: string | undefined = startCursor;
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
    nextCursor = cursor ?? nextCursor;
  }

  return { events: [...deduped.values()], nextCursor };
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
  const [eventPage, openMarkets] = await Promise.all([
    categoryId === "all"
      ? fetchKalshiCatalogEvents(maxPages)
      : fetchKalshiCatalogEventsForCategory(categoryId, maxPages),
    categoryId === "all" && !searchQuery
      ? fetchKalshiOpenMarkets().catch(() => [] as KalshiMarketRecord[])
      : Promise.resolve([] as KalshiMarketRecord[]),
  ]);
  rememberKalshiCursor(searchQuery, categoryId, eventPage.nextCursor);
  const events = eventPage.events;
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
    // Browse/search hits Kalshi directly. Adjacent is reserved for indices and
    // detail enrichments — routing the PM catalog through it added a multi-page
    // hop before the venue call, which is what made the pane feel stuck.
    async () => await loadKalshiVenueCatalog(normalizedQuery, categoryId, browseTab),
    PREDICTION_CACHE_POLICIES.catalog,
    options,
  );
}

export async function loadMoreKalshiCatalog(
  searchQuery: string,
  categoryId: PredictionCategoryId,
  cursor: string,
  signal?: AbortSignal,
): Promise<{ markets: PredictionMarketSummary[]; nextCursor: string | null; hasMore: boolean }> {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const page = categoryId === "all"
    ? await fetchKalshiCatalogEvents(1, KALSHI_EVENT_PAGE_LIMIT, signal, cursor)
    : await fetchKalshiCatalogEventsForCategory(categoryId, 1, KALSHI_EVENT_PAGE_LIMIT, signal, cursor);
  rememberKalshiCursor(normalizedQuery, categoryId, page.nextCursor);
  return {
    markets: normalizeKalshiCatalog(page.events, normalizedQuery, categoryId),
    nextCursor: page.nextCursor,
    hasMore: !!page.nextCursor,
  };
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
          kalshiUrl(`/events/${eventTicker}`),
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
    const response = await fetchJson<{ market?: KalshiMarketRecord }>(
      kalshiUrl(`/markets/${encodeURIComponent(ticker)}`),
    );
    return response.market ?? null;
  } catch {
    return null;
  }
}

async function fetchKalshiEventsForSeries(
  seriesTicker: string,
): Promise<KalshiEventRecord[]> {
  const url = new URL(kalshiUrl("/events"));
  url.searchParams.set("series_ticker", seriesTicker);
  url.searchParams.set("with_nested_markets", "true");
  url.searchParams.set("limit", String(KALSHI_SERIES_EVENT_LIMIT));
  try {
    const response = await fetchJson<KalshiEventsResponse>(url.toString());
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

function pickBusiestKalshiMarket(
  events: KalshiEventRecord[],
): PredictionMarketSummary | null {
  let best: PredictionMarketSummary | null = null;
  for (const event of events) {
    for (const record of event.markets ?? []) {
      const summary = normalizeKalshiMarket(
        record,
        {
          title: event.title,
          category: event.category,
          series_ticker: event.series_ticker,
          sub_title: event.sub_title,
        },
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
 * ticker (`CONTROLS-2026-R`), an event ticker (`CONTROLS-2026`), or a series
 * ticker (`CONTROLS`); the latter two settle on their busiest market.
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
    return pickBusiestKalshiMarket([
      {
        title: event.event.title,
        category: event.event.category,
        series_ticker: event.event.series_ticker,
        sub_title: event.event.sub_title,
        markets: event.markets,
      },
    ]);
  }

  return pickBusiestKalshiMarket(await fetchKalshiEventsForSeries(normalized));
}

async function loadKalshiTrades(
  summary: PredictionMarketSummary,
): Promise<PredictionTrade[]> {
  return await loadCachedPredictionResource(
    "trades",
    summary.key,
    async () => {
      const response = await fetchJson<KalshiTradesResponse>(
        kalshiUrl(`/markets/trades?ticker=${summary.marketId}&limit=30`),
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
        kalshiUrl(`/markets/${summary.marketId}/orderbook`),
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
    const points = await loadCachedPredictionResource(
      "history",
      `${summary.key}:${range}`,
      async () => {
        const response = await fetchJson<KalshiCandlestickResponse>(
          kalshiUrl(`/series/${event.event.series_ticker}/markets/${summary.marketId}/candlesticks?start_ts=${start}&end_ts=${now}&period_interval=${periodInterval}`),
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
