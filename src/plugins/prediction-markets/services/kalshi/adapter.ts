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
  consumeKalshiProxyAdjacent,
  fetchJson,
  getCachedPredictionResource,
  isHostedOriginFailureError,
  loadCachedPredictionResource,
  markKalshiProxySource,
  parseFloatSafe,
  PREDICTION_CACHE_POLICIES,
  resetKalshiProxySource,
} from "../fetch";
import { revivePredictionHistoryPoints } from "../history";
import {
  fetchHostedAdjacentKalshiCatalogPage,
  parseHostedAdjacentKalshiPageCursor,
} from "./adjacent-catalog";
import {
  fetchHostedAdjacentKalshiMarket,
  loadHostedAdjacentKalshiDetail,
  loadHostedAdjacentKalshiHistory,
} from "./adjacent-detail";
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

function emptyKalshiBook(
  summary: PredictionMarketSummary,
): PredictionBookSnapshot {
  return {
    yesBids: [],
    yesAsks: [],
    noBids: [],
    noAsks: [],
    lastTradePrice: summary.lastTradePrice,
  };
}

function kalshiApiBase(): string {
  return isHostedWebClient()
    ? KALSHI_PROXY_PATH
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
const DEFAULT_KALSHI_EVENT_MAX_PAGES = 2;
const SEARCH_KALSHI_EVENT_MAX_PAGES = 4;
const HOSTED_KALSHI_EVENT_MAX_PAGES = 1;
const KALSHI_MARKET_PAGE_LIMIT = 200;
const KALSHI_MARKET_MAX_PAGES = 5;
const KALSHI_SERIES_EVENT_LIMIT = 20;
const kalshiCursors = new Map<string, string | null>();

export type KalshiCatalogFeed = "live" | "delayed";
type KalshiCatalogBackend = "kalshi" | "adjacent";

let kalshiCatalogFeed: KalshiCatalogFeed = "live";
let kalshiCatalogBackend: KalshiCatalogBackend = "kalshi";

export function getKalshiCatalogFeed(): KalshiCatalogFeed {
  return kalshiCatalogFeed;
}

export function resetKalshiCatalogFeed(): void {
  kalshiCatalogFeed = "live";
  kalshiCatalogBackend = "kalshi";
  resetKalshiProxySource();
}

function rememberKalshiCatalogSource(backend: KalshiCatalogBackend, feed: KalshiCatalogFeed): void {
  kalshiCatalogBackend = backend;
  kalshiCatalogFeed = feed;
}

function kalshiCursorKey(searchQuery: string, categoryId: PredictionCategoryId): string {
  return `${categoryId}:${searchQuery.trim().toLowerCase()}`;
}

function sortKalshiCatalogMarkets(
  markets: PredictionMarketSummary[],
  browseTab: PredictionBrowseTab,
): PredictionMarketSummary[] {
  return [...markets].sort((left, right) => {
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
  options?: { firstPageOnly?: boolean },
): Promise<PredictionMarketSummary[]> {
  const localBrowse = searchQuery
    ? getCachedPredictionResource<PredictionMarketSummary[]>(
        "catalog",
        buildPredictionCatalogResourceKey("kalshi", categoryId, "", browseTab),
      ) ?? []
    : [];
  const hosted = isHostedWebClient();
  const firstPageOnly = options?.firstPageOnly === true && !searchQuery;
  const maxPages = firstPageOnly
    ? 1
    : searchQuery
      ? localBrowse.length > 0
        ? 1
        : hosted
          ? HOSTED_KALSHI_EVENT_MAX_PAGES
          : SEARCH_KALSHI_EVENT_MAX_PAGES
      : hosted
        ? HOSTED_KALSHI_EVENT_MAX_PAGES
        : DEFAULT_KALSHI_EVENT_MAX_PAGES;
  const [eventPage, openMarkets] = await Promise.all([
    categoryId === "all"
      ? fetchKalshiCatalogEvents(maxPages)
      : fetchKalshiCatalogEventsForCategory(categoryId, maxPages),
    !firstPageOnly && !hosted && categoryId === "all" && !searchQuery
      ? fetchKalshiOpenMarkets().catch(() => [] as KalshiMarketRecord[])
      : Promise.resolve([] as KalshiMarketRecord[]),
  ]);
  if (!firstPageOnly) {
    rememberKalshiCursor(searchQuery, categoryId, eventPage.nextCursor);
  }
  const events = eventPage.events;
  const fromEvents = normalizeKalshiCatalog(events, searchQuery, categoryId, browseTab);
  const merged = new Map<string, PredictionMarketSummary>();
  for (const market of localBrowse) {
    merged.set(market.key, market);
  }
  for (const market of fromEvents) {
    merged.set(market.key, market);
  }
  if (openMarkets.length > 0) {
    const fromMarkets = normalizeKalshiCatalog(
      [{ title: "", markets: openMarkets }],
      searchQuery,
      categoryId,
      browseTab,
    );
    for (const market of fromMarkets) {
      merged.set(market.key, market);
    }
  }
  return sortKalshiCatalogMarkets([...merged.values()], browseTab);
}

async function loadHostedKalshiCatalog(
  normalizedQuery: string,
  categoryId: PredictionCategoryId,
  browseTab: PredictionBrowseTab,
  options?: { firstPageOnly?: boolean },
): Promise<PredictionMarketSummary[]> {
  resetKalshiProxySource();
  try {
    const markets = await loadKalshiVenueCatalog(
      normalizedQuery,
      categoryId,
      browseTab,
      options,
    );
    const delayed = consumeKalshiProxyAdjacent();
    rememberKalshiCatalogSource("kalshi", delayed ? "delayed" : "live");
    return markets;
  } catch (error) {
    if (!isHostedOriginFailureError(error)) throw error;
    markKalshiProxySource("adjacent");
    rememberKalshiCatalogSource("adjacent", "delayed");
    const page = await fetchHostedAdjacentKalshiCatalogPage({
      searchQuery: normalizedQuery,
      categoryId,
      browseTab,
      page: 1,
    });
    if (!options?.firstPageOnly) {
      rememberKalshiCursor(normalizedQuery, categoryId, page.nextCursor);
    }
    return page.markets;
  }
}

export async function loadKalshiCatalog(
  searchQuery = "",
  categoryId: PredictionCategoryId = "all",
  browseTab: PredictionBrowseTab = "top",
  options?: { force?: boolean; firstPageOnly?: boolean },
): Promise<PredictionMarketSummary[]> {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const firstPageOnly = options?.firstPageOnly === true && !normalizedQuery;
  const resourceKey = buildPredictionCatalogResourceKey(
    "kalshi",
    categoryId,
    normalizedQuery,
    browseTab,
  );
  return await loadCachedPredictionResource(
    "catalog",
    resourceKey,
    async () => {
      let page: PredictionMarketSummary[];
      if (isHostedWebClient()) {
        page = await loadHostedKalshiCatalog(normalizedQuery, categoryId, browseTab, {
          firstPageOnly,
        });
      } else {
        rememberKalshiCatalogSource("kalshi", "live");
        page = await loadKalshiVenueCatalog(normalizedQuery, categoryId, browseTab, {
          firstPageOnly,
        });
      }
      return page;
    },
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
  if (isHostedWebClient() && kalshiCatalogBackend === "adjacent") {
    const page = await fetchHostedAdjacentKalshiCatalogPage({
      searchQuery: normalizedQuery,
      categoryId,
      page: parseHostedAdjacentKalshiPageCursor(cursor),
    });
    rememberKalshiCursor(normalizedQuery, categoryId, page.nextCursor);
    rememberKalshiCatalogSource("adjacent", "delayed");
    return {
      markets: page.markets,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }
  const page = categoryId === "all"
    ? await fetchKalshiCatalogEvents(1, KALSHI_EVENT_PAGE_LIMIT, signal, cursor)
    : await fetchKalshiCatalogEventsForCategory(categoryId, 1, KALSHI_EVENT_PAGE_LIMIT, signal, cursor);
  rememberKalshiCursor(normalizedQuery, categoryId, page.nextCursor);
  if (isHostedWebClient() && consumeKalshiProxyAdjacent()) {
    rememberKalshiCatalogSource("kalshi", "delayed");
  }
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

  if (isHostedWebClient()) {
    const venue = await resolveKalshiVenueMarketByTicker(normalized);
    if (venue) return venue;
    try {
      return await fetchHostedAdjacentKalshiMarket(normalized);
    } catch {
      return null;
    }
  }

  return await resolveKalshiVenueMarketByTicker(normalized);
}

async function resolveKalshiVenueMarketByTicker(
  normalized: string,
): Promise<PredictionMarketSummary | null> {
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
  const venueHistory = await loadKalshiVenueHistory(summary, range);
  if (venueHistory.length > 0 || !isHostedWebClient()) return venueHistory;
  try {
    return revivePredictionHistoryPoints(
      await loadHostedAdjacentKalshiHistory(summary, range),
    );
  } catch {
    return venueHistory;
  }
}

async function loadKalshiVenueHistory(
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
  if (isHostedWebClient()) {
    const record = await fetchKalshiMarketByTicker(summary.marketId);
    if (!record) {
      return await loadCachedPredictionResource(
        "detail",
        buildPredictionDetailResourceKey(summary.key, range),
        async () => await loadHostedAdjacentKalshiDetail(summary, range),
        PREDICTION_CACHE_POLICIES.detail,
      );
    }
  }

  return await loadKalshiVenueDetail(summary, range);
}

async function loadKalshiVenueDetail(
  summary: PredictionMarketSummary,
  range: "1D" | "1W" | "1M" | "ALL",
): Promise<PredictionMarketDetail> {
  return await loadCachedPredictionResource(
    "detail",
    buildPredictionDetailResourceKey(summary.key, range),
    async () => {
      // A dead sub-resource must not blank the market: Kalshi answers 429 on
      // individual endpoints while the rest of the detail is still fetchable.
      const [event, history, book, trades] = await Promise.all([
        loadKalshiEvent(summary.eventTicker),
        loadKalshiHistory(summary, range),
        loadKalshiBook(summary).catch(() => emptyKalshiBook(summary)),
        loadKalshiTrades(summary).catch(() => []),
      ]);
      const eventMeta = event?.event;
      const selectedRecord = (event?.markets ?? []).find(
        (market) => market.ticker === summary.marketId,
      );
      const detailed = selectedRecord
        ? normalizeKalshiMarket(selectedRecord, {
            title: eventMeta?.title,
            category: eventMeta?.category,
            series_ticker: eventMeta?.series_ticker,
            sub_title: eventMeta?.sub_title,
          }, { allowDormant: true })
        : null;
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
          ...(detailed ?? {}),
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
          detailed?.rulesPrimary ?? summary.rulesPrimary ?? "",
          detailed?.rulesSecondary ?? summary.rulesSecondary ?? "",
        ].filter((value) => value.trim().length > 0),
        history,
        book,
        trades,
      };
    },
    PREDICTION_CACHE_POLICIES.detail,
  );
}
