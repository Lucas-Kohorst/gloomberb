import type {
  PredictionCategoryId,
  PredictionMarketSummary,
  PredictionVenue,
} from "../types";
import { matchesPredictionCategory } from "../categories";
import { getSharedAdjacentClient } from "../../builtin/adjacent/client";
import type { AdjacentMarket } from "../../builtin/adjacent/types";
import { isHostedWebClient } from "../../../shared/hosted-api";
import type { AdjacentKalshiCatalogRow } from "./kalshi/adjacent-catalog";
import {
  fetchHostedAdjacentJson,
  kalshiEventTickerFromAdjacent,
} from "./kalshi/adjacent-catalog";
import {
  predictionSearchTokens,
} from "../search";

const ADJACENT_SEARCH_PER_PAGE = 50;
const ADJACENT_SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "any", "are", "by", "for", "from", "in", "is", "of", "on", "the", "to", "what", "will",
]);

export interface AdjacentSearchResult {
  markets: PredictionMarketSummary[];
  hasMore: boolean;
  nextCursor: string | null;
}

function adjacentPlatformParam(
  venue: PredictionVenue | undefined,
): string | undefined {
  if (venue === "polymarket") return "polymarket";
  if (venue === "kalshi") return "kalshi";
  return undefined;
}

function platformFromMarketId(
  marketId: string | undefined,
): PredictionVenue | null {
  if (!marketId) return null;
  if (marketId.startsWith("kalshi:")) return "kalshi";
  if (marketId.startsWith("polymarket:")) return "polymarket";
  return null;
}

function stripPlatformPrefix(value: string | undefined): string | undefined {
  const stripped = value?.replace(/^(kalshi|polymarket):/i, "").trim();
  return stripped || undefined;
}

function polymarketEventSlugFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /\/event\/([^/?#]+)/.exec(url)?.[1] ?? undefined;
}

function isConditionId(value: string | undefined): boolean {
  return !!value && /^0x[0-9a-f]+$/i.test(value);
}

function mapAdjacentSearchMarket(
  row: AdjacentKalshiCatalogRow,
): PredictionMarketSummary | null {
  const platform = platformFromMarketId(row.market_id ?? row.id)
    ?? (row.platform?.trim().toLowerCase() as PredictionVenue | null);
  if (!platform || (platform !== "kalshi" && platform !== "polymarket")) return null;

  const rawTicker = stripPlatformPrefix(row.ticker)
    ?? stripPlatformPrefix(row.market_id ?? row.id)
    ?? "";
  const displayTicker = stripPlatformPrefix(row.display_ticker);
  const link = row.link?.trim() || row.url?.trim() || "";
  const eventSlug = polymarketEventSlugFromUrl(link);

  let marketId: string;
  let conditionId: string | undefined;
  if (platform === "polymarket") {
    if (isConditionId(rawTicker)) conditionId = rawTicker;
    marketId = displayTicker
      || (!isConditionId(rawTicker) ? rawTicker : "")
      || eventSlug
      || "";
  } else {
    marketId = rawTicker;
  }
  if (!marketId) return null;

  const yesPrice = row.probability != null ? row.probability / 100 : null;
  const yesBid = row.yes_bid != null ? row.yes_bid / 100 : null;
  const yesAsk = row.yes_ask != null ? row.yes_ask / 100 : null;
  const noBid = row.no_bid != null ? row.no_bid / 100 : null;
  const noAsk = row.no_ask != null ? row.no_ask / 100 : null;
  const lastTradePrice = row.last_trade_price != null ? row.last_trade_price / 100 : yesPrice;
  const noPrice = yesPrice != null ? Math.max(0, 1 - yesPrice) : null;
  const eventTicker = platform === "kalshi"
    ? kalshiEventTickerFromAdjacent(row, marketId)
    : undefined;
  const eventId = platform === "polymarket"
    ? stripPlatformPrefix(row.event_id) || eventSlug
    : undefined;
  const title = (row.question ?? row.title ?? marketId).trim();
  const outcomeLabel = eventTicker && marketId.startsWith(`${eventTicker}-`)
    ? marketId.slice(eventTicker.length + 1)
    : "";
  const marketLabel = outcomeLabel || row.subtitle?.trim() || title;
  const eventLabel = (row.event_title ?? title).trim();
  const category = row.category?.trim();

  return {
    key: `${platform}:${marketId}`,
    venue: platform,
    marketId,
    title,
    marketLabel,
    eventLabel,
    eventId,
    eventTicker,
    seriesTicker: row.series_ticker?.trim() || marketId.split("-")[0] || undefined,
    category,
    tags: category
      ? [category]
      : [],
    status: row.status === "active" ? "open" : (row.status ?? "unknown"),
    url: link
      || (platform === "kalshi"
        ? `https://kalshi.com/markets/${marketId}`
        : `https://polymarket.com/event/${marketId}`),
    description: "",
    endsAt: row.end_date ?? row.ends_at ?? null,
    updatedAt: row.updated_at ?? null,
    createdAt: row.created_at ?? null,
    yesPrice,
    noPrice,
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    spread: yesBid != null && yesAsk != null ? yesAsk - yesBid : null,
    lastTradePrice,
    volume24h: row.volume_24h ?? null,
    volume24hUnit: "usd",
    totalVolume: row.volume ?? null,
    totalVolumeUnit: "usd",
    openInterest: row.open_interest ?? null,
    openInterestUnit: "usd",
    liquidity: null,
    liquidityUnit: "usd",
    conditionId,
  };
}

function adjacentMarketToCatalogRow(market: AdjacentMarket): AdjacentKalshiCatalogRow {
  const raw = market as unknown as Record<string, unknown>;
  const rawId = (raw.market_id as string) ?? (raw.id as string) ?? "";
  const hasPlatformPrefix = /^(kalshi|polymarket):/i.test(rawId);
  const marketId = hasPlatformPrefix ? rawId : `${market.platform}:${rawId}`;
  const rawTicker = (raw.ticker as string) ?? market.slug ?? rawId.replace(/^(kalshi|polymarket):/i, "");
  const question = (raw.question as string) ?? market.title ?? "";
  return {
    market_id: marketId,
    id: rawId,
    ticker: rawTicker,
    display_ticker: (raw.display_ticker as string) || undefined,
    platform: market.platform,
    question,
    title: question,
    subtitle: (raw.subtitle as string) ?? market.subtitle,
    category: (raw.category as string) ?? market.category,
    tags: (raw.tags as string[]) ?? market.tags,
    status: market.status,
    probability: (raw.probability as number) ?? market.yes_price,
    yes_price: (raw.probability as number) ?? market.yes_price,
    latest_price: (raw.probability as number) ?? market.yes_price,
    yes_bid: (raw.yes_bid as number) ?? market.yes_bid,
    yes_ask: (raw.yes_ask as number) ?? market.yes_ask,
    no_bid: (raw.no_bid as number) ?? market.no_bid,
    no_ask: (raw.no_ask as number) ?? market.no_ask,
    last_trade_price: (raw.last_trade_price as number) ?? market.last_trade_price,
    volume_24h: (raw.volume_24h as number) ?? market.volume_24h,
    volume: (raw.volume as number) ?? market.total_volume,
    open_interest: (raw.open_interest as number) ?? market.open_interest,
    end_date: (raw.end_date as string) ?? market.ends_at,
    ends_at: market.ends_at,
    link: (raw.link as string) ?? market.url,
    url: market.url,
    event_id: (raw.event_id as string) ?? market.event_id,
    event_ticker: (raw.event_ticker as string) || undefined,
    event_title: (raw.event_title as string) ?? market.event_title,
    created_at: null,
    updated_at: market.updated_at,
    series_ticker: rawTicker.split("-")[0] || undefined,
  };
}

function marketsFromAdjacentResponse(response: {
  data?: AdjacentMarket[];
  markets?: AdjacentMarket[];
  next_cursor?: string | null;
  meta?: { has_next?: boolean };
}): { rawMarkets: AdjacentMarket[]; hasMore: boolean } {
  const rawMarkets = response.data ?? response.markets ?? [];
  const hasMore = response.next_cursor != null || response.meta?.has_next === true;
  return { rawMarkets, hasMore };
}

export function adjacentSearchPageCursor(page: number): string {
  return `page:${page}`;
}

export function parseAdjacentSearchPageCursor(
  cursor: string | null | undefined,
): number {
  if (!cursor) return 1;
  const prefixed = cursor.match(/^page:(\d+)$/i);
  if (prefixed) return Number(prefixed[1]);
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function searchAdjacentCatalog(options: {
  query: string;
  venue?: PredictionVenue;
  categoryId?: PredictionCategoryId;
  page?: number;
  signal?: AbortSignal;
}): Promise<AdjacentSearchResult> {
  const query = predictionSearchTokens(options.query).join(" ");
  const categoryId = options.categoryId ?? "all";
  const page = options.page ?? 1;
  const signal = options.signal;
  if (!query) {
    return { markets: [], hasMore: false, nextCursor: null };
  }
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

  const platform = adjacentPlatformParam(options.venue);
  let response: {
    data?: AdjacentMarket[];
    markets?: AdjacentMarket[];
    next_cursor?: string | null;
    meta?: { has_next?: boolean };
  };

  if (isHostedWebClient()) {
    const search: Record<string, string | number | undefined> = {
      search: query,
      per_page: ADJACENT_SEARCH_PER_PAGE,
      page,
      platform,
      scope: "all",
    };
    response = await fetchHostedAdjacentJson<typeof response>("markets", search, signal);
  } else {
    const client = getSharedAdjacentClient();
    response = await client.searchMarkets(query, ADJACENT_SEARCH_PER_PAGE, platform, {
      page,
      signal,
    });
  }

  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

  const { rawMarkets, hasMore } = marketsFromAdjacentResponse(response);
  const markets = rawMarkets
    .map(adjacentMarketToCatalogRow)
    .map(mapAdjacentSearchMarket)
    .filter((market): market is PredictionMarketSummary => market != null);

  if (markets.length === 0) {
    const tokens = predictionSearchTokens(query);
    const fallbackToken = tokens.find((token) => (
      token.length >= 3 && !ADJACENT_SEARCH_STOP_WORDS.has(token)
    ));
    if (
      fallbackToken
      && tokens.length > 1
      && fallbackToken !== query.toLowerCase()
    ) {
      // Adjacent uses AND matching. A phrase can be absent from the market
      // question, or return rows whose shape cannot be mapped, even though one
      // meaningful token identifies the contract.
      return searchAdjacentCatalog({ ...options, query: fallbackToken });
    }
  }

  const filtered = categoryId === "all"
    ? markets
    : markets.filter((market) => matchesPredictionCategory(market, categoryId));

  return {
    markets: filtered,
    hasMore,
    nextCursor: response.next_cursor ?? (hasMore ? adjacentSearchPageCursor(page + 1) : null),
  };
}
