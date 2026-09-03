import { isHostedWebClient, KALSHI_PROXY_PATH } from "../../../../shared/hosted-api";
import {
  buildPredictionCatalogResourceKey,
  buildPredictionDetailResourceKey,
  capPredictionCatalogByEvent,
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
  KalshiSeriesResponse,
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
const DEFAULT_KALSHI_EVENT_MAX_PAGES = 3;
const SEARCH_KALSHI_EVENT_MAX_PAGES = 3;
const kalshiCursors = new Map<string, string | null>();

export function resetKalshiCatalogFeed(): void {
  kalshiCursors.clear();
  resetKalshiProxySource();
}

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

function kalshiSeriesTickerFromEvent(eventTicker: string | undefined): string | undefined {
  const trimmed = eventTicker?.trim().toUpperCase();
  if (!trimmed) return undefined;
  const withoutDateSuffix = trimmed.replace(/-[0-9].*$/, "");
  return withoutDateSuffix || trimmed;
}

function buildKalshiCatalogUrl(cursor?: string, category?: string, limit = KALSHI_EVENT_PAGE_LIMIT): string {
  const url = new URL("https://api.elections.kalshi.com/trade-api/v2/events");
  url.searchParams.set("limit", String(limit));
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
  limit = KALSHI_EVENT_PAGE_LIMIT,
  signal?: AbortSignal,
  startCursor?: string,
): Promise<{ events: KalshiEventRecord[]; nextCursor: string | null }> {
  const events: KalshiEventRecord[] = [];
  let cursor: string | undefined = startCursor;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetchJson<KalshiEventsResponse>(
      buildKalshiCatalogUrl(cursor, undefined, limit),
      signal,
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
        buildKalshiCatalogUrl(cursor, category, limit),
        signal,
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

export async function loadKalshiCatalog(
  searchQuery = "",
  categoryId: PredictionCategoryId = "all",
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<PredictionMarketSummary[]> {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const requestedLimit = Math.max(1, Math.min(KALSHI_EVENT_PAGE_LIMIT, options.limit ?? KALSHI_EVENT_PAGE_LIMIT));
  const pageLimit = Math.max(20, requestedLimit);
  const maxPages = options.limit ? 1 : normalizedQuery ? SEARCH_KALSHI_EVENT_MAX_PAGES : DEFAULT_KALSHI_EVENT_MAX_PAGES;
  return await loadCachedPredictionResource(
    "catalog",
    `${buildPredictionCatalogResourceKey("kalshi", categoryId, normalizedQuery)}:${requestedLimit}`,
    async () => {
      const page = categoryId === "all"
        ? await fetchKalshiCatalogEvents(maxPages, pageLimit, options.signal)
        : await fetchKalshiCatalogEventsForCategory(categoryId, maxPages, pageLimit, options.signal);
      rememberKalshiCursor(normalizedQuery, categoryId, page.nextCursor);
      return normalizeKalshiCatalog(page.events, normalizedQuery, categoryId).slice(0, requestedLimit);
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

export async function fetchKalshiMarketByTicker(
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

export async function resolveKalshiMarketByTicker(
  ticker: string,
): Promise<PredictionMarketSummary | null> {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return null;
  const record = await fetchKalshiMarketByTicker(normalized);
  if (!record) return null;
  const event = await loadKalshiEvent(record.event_ticker);
  return normalizeKalshiMarket(record, event?.event, { allowDormant: true });
}

export async function resolveKalshiChartSummary(
  eventTicker: string,
  marketTicker: string,
  signal?: AbortSignal,
): Promise<PredictionMarketSummary> {
  const response = await fetchJson<KalshiEventResponse>(
    `https://api.elections.kalshi.com/trade-api/v2/events/${eventTicker}`,
    signal,
  );
  const market = response.markets?.find((candidate) => candidate.ticker === marketTicker);
  const summary = market ? normalizeKalshiMarket(market, response.event) : null;
  if (!summary) {
    throw new Error(`Kalshi market ${marketTicker} in event ${eventTicker} is no longer resolvable. Remove or replace this chart series.`);
  }
  return summary;
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
  options: { start?: Date; end?: Date; signal?: AbortSignal; strict?: boolean } = {},
): Promise<PredictionHistoryPoint[]> {
  const seriesTicker = summary.seriesTicker ?? (await loadKalshiEvent(summary.eventTicker))?.event?.series_ticker;
  if (!seriesTicker) {
    if (options.strict) throw new Error(`Kalshi event ${summary.eventTicker ?? "unknown"} no longer exposes chart history.`);
    return [];
  }

  const now = Math.floor((options.end?.getTime() ?? Date.now()) / 1000);
  const rangeSeconds =
    range === "1D"
      ? 24 * 60 * 60
      : range === "1W"
        ? 7 * 24 * 60 * 60
        : range === "1M"
          ? 30 * 24 * 60 * 60
          : 365 * 24 * 60 * 60;
  const periodInterval = range === "1D" ? 60 : range === "1W" ? 60 : 1440;
  const start = Math.floor((options.start?.getTime() ?? (now * 1000 - rangeSeconds * 1000)) / 1000);

  try {
    const points = await loadCachedPredictionResource(
      "history",
      `${summary.key}:${range}:${start}:${now}`,
      async () => {
        const response = await fetchJson<KalshiCandlestickResponse>(
          `https://api.elections.kalshi.com/trade-api/v2/series/${seriesTicker}/markets/${summary.marketId}/candlesticks?start_ts=${start}&end_ts=${now}&period_interval=${periodInterval}`,
          options.signal,
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
  } catch (error) {
    if (options.strict) throw error;
    return [];
  }
}

async function loadKalshiSeriesSettlement(
  seriesTicker: string | undefined,
): Promise<string | undefined> {
  const ticker = seriesTicker?.trim();
  if (!ticker) return undefined;
  try {
    const response = await fetchJson<KalshiSeriesResponse>(
      `https://api.elections.kalshi.com/trade-api/v2/series/${encodeURIComponent(ticker)}`,
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
