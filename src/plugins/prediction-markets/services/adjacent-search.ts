import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionMarketSummary,
  PredictionVenue,
} from "../types";
import { matchesPredictionCategory } from "../categories";
import { getSharedAdjacentClient } from "../../builtin/adjacent/client";
import type { AdjacentMarket } from "../../builtin/adjacent/types";
import type { AdjacentKalshiCatalogRow } from "./kalshi/adjacent-catalog";

const ADJACENT_SEARCH_PER_PAGE = 50;

export interface AdjacentSearchResult {
  markets: PredictionMarketSummary[];
  hasMore: boolean;
  nextCursor: string | null;
}

function adjacentSearchSortParams(
  searchQuery: string,
  browseTab: PredictionBrowseTab,
): { sort?: string; sortDir?: string } {
  if (searchQuery) return {};
  if (browseTab === "ending") return { sort: "expiration", sortDir: "asc" };
  return { sort: "volume", sortDir: "desc" };
}

function adjacentPlatformParam(
  venue: PredictionVenue | undefined,
): string | undefined {
  if (venue === "polymarket") return "polymarket";
  if (venue === "kalshi") return "kalshi";
  return "kalshi,polymarket";
}

function platformFromMarketId(
  marketId: string | undefined,
): PredictionVenue | null {
  if (!marketId) return null;
  if (marketId.startsWith("kalshi:")) return "kalshi";
  if (marketId.startsWith("polymarket:")) return "polymarket";
  return null;
}

function eventTickerFromAdjacentRow(
  row: AdjacentKalshiCatalogRow,
): string | undefined {
  const fromEventId = row.event_id?.replace(/^(kalshi|polymarket):/i, "").trim();
  if (fromEventId) return fromEventId;
  return row.event_ticker?.trim();
}

function mapAdjacentSearchMarket(
  row: AdjacentKalshiCatalogRow,
): PredictionMarketSummary | null {
  const marketId = row.market_id ?? row.id;
  const platform = platformFromMarketId(marketId) ?? (row.platform?.trim().toLowerCase() as PredictionVenue | null);
  if (!platform || (platform !== "kalshi" && platform !== "polymarket")) return null;

  const ticker = row.ticker?.trim() ?? marketId?.replace(/^(kalshi|polymarket):/i, "").trim() ?? "";
  if (!ticker) return null;

  const yesPrice = row.probability != null ? row.probability / 100 : null;
  const yesBid = row.yes_bid != null ? row.yes_bid / 100 : null;
  const yesAsk = row.yes_ask != null ? row.yes_ask / 100 : null;
  const noBid = row.no_bid != null ? row.no_bid / 100 : null;
  const noAsk = row.no_ask != null ? row.no_ask / 100 : null;
  const lastTradePrice = row.last_trade_price != null ? row.last_trade_price / 100 : yesPrice;
  const noPrice = yesPrice != null ? Math.max(0, 1 - yesPrice) : null;
  const eventTicker = eventTickerFromAdjacentRow(row);
  const title = (row.question ?? row.title ?? ticker).trim();
  const outcomeLabel = eventTicker && ticker.startsWith(`${eventTicker}-`)
    ? ticker.slice(eventTicker.length + 1)
    : "";
  const marketLabel = outcomeLabel || row.subtitle?.trim() || title;
  const eventLabel = (row.event_title ?? title).trim();
  const category = row.category?.trim();

  return {
    key: `${platform}:${ticker}`,
    venue: platform,
    marketId: ticker,
    title,
    marketLabel,
    eventLabel,
    eventTicker,
    seriesTicker: row.series_ticker?.trim() || ticker.split("-")[0] || undefined,
    category,
    tags: category
      ? [category]
      : [],
    status: row.status === "active" ? "open" : (row.status ?? "unknown"),
    url: row.link?.trim()
      || row.url?.trim()
      || (platform === "kalshi"
        ? `https://kalshi.com/markets/${ticker}`
        : `https://polymarket.com/event/${ticker}`),
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
  };
}

function adjacentMarketToCatalogRow(market: AdjacentMarket): AdjacentKalshiCatalogRow {
  const id = market.id ?? "";
  return {
    market_id: `${market.platform}:${id}`,
    id,
    ticker: market.slug ?? id,
    platform: market.platform,
    question: market.title,
    title: market.title,
    subtitle: market.subtitle,
    category: market.category,
    tags: market.tags,
    status: market.status,
    probability: market.yes_price,
    yes_price: market.yes_price,
    latest_price: market.yes_price,
    yes_bid: market.yes_bid,
    yes_ask: market.yes_ask,
    no_bid: market.no_bid,
    no_ask: market.no_ask,
    last_trade_price: market.last_trade_price,
    volume_24h: market.volume_24h,
    volume: market.total_volume,
    open_interest: market.open_interest,
    end_date: market.ends_at,
    ends_at: market.ends_at,
    link: market.url,
    url: market.url,
    event_id: market.event_id,
    event_title: market.event_title,
    created_at: null,
    updated_at: market.updated_at,
    series_ticker: id.split("-")[0] || undefined,
  };
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
  browseTab?: PredictionBrowseTab;
  page?: number;
}): Promise<AdjacentSearchResult> {
  const query = options.query.trim();
  const categoryId = options.categoryId ?? "all";
  const page = options.page ?? 1;

  const client = getSharedAdjacentClient();
  const platform = adjacentPlatformParam(options.venue);
  const response = await client.searchMarkets(
    query,
    ADJACENT_SEARCH_PER_PAGE,
    platform,
  );

  const markets = (response.markets ?? [])
    .map(adjacentMarketToCatalogRow)
    .map(mapAdjacentSearchMarket)
    .filter((market): market is PredictionMarketSummary => market != null);

  const filtered = categoryId === "all"
    ? markets
    : markets.filter((market) => matchesPredictionCategory(market, categoryId));

  const hasMore = !!response.next_cursor;
  return {
    markets: filtered,
    hasMore,
    nextCursor: response.next_cursor ?? null,
  };
}
