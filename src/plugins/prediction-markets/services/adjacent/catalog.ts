import { matchesPredictionCategory } from "../../categories";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionMarketSummary,
  PredictionVenue,
} from "../../types";
import { fetchJson } from "../fetch";
import type { AdjacentCatalogMarket, AdjacentCatalogResponse } from "./types";

const ADJACENT_MARKETS_URL = "https://api.adjacent.markets/api/v1/public/markets";
const ADJACENT_PAGE_SIZE = 100;
const ADJACENT_TOP_PAGES = 6;
const ADJACENT_SEARCH_PAGES = 2;

export function shouldUseAdjacentCatalog(
  browseTab: PredictionBrowseTab,
  searchQuery: string,
): boolean {
  return browseTab === "top" || searchQuery.trim().length > 0;
}

export function normalizeAdjacentCatalogMarket(
  record: AdjacentCatalogMarket,
): PredictionMarketSummary | null {
  const platform = record.platform === "kalshi" || record.platform === "polymarket"
    ? record.platform
    : null;
  const ticker = record.ticker?.trim();
  const question = record.question?.trim();
  if (!platform || !ticker || !question) return null;

  const key = record.market_id?.trim() || `${platform}:${ticker}`;
  const yesPrice = adjacentProbabilityToYesPrice(record.probability);

  return {
    key,
    venue: platform,
    marketId: ticker,
    title: question,
    marketLabel: question,
    eventLabel: question,
    eventTicker: platform === "kalshi" ? ticker.split("-").slice(0, -1).join("-") || undefined : undefined,
    category: record.category,
    tags: record.category ? [record.category] : [],
    status: record.status === "active" ? "open" : (record.status ?? "unknown"),
    url: record.link?.trim()
      || (platform === "kalshi"
        ? `https://kalshi.com/markets/${ticker}`
        : "https://polymarket.com"),
    description: "",
    endsAt: record.end_date ?? null,
    updatedAt: null,
    createdAt: null,
    yesPrice,
    noPrice: yesPrice != null ? Math.max(0, 1 - yesPrice) : null,
    yesBid: null,
    yesAsk: null,
    noBid: null,
    noAsk: null,
    spread: null,
    lastTradePrice: yesPrice,
    volume24h: record.volume_24h ?? null,
    volume24hUnit: "usd",
    totalVolume: record.volume ?? null,
    totalVolumeUnit: "usd",
    openInterest: record.open_interest ?? null,
    openInterestUnit: "usd",
    liquidity: null,
    liquidityUnit: "usd",
  };
}

function adjacentProbabilityToYesPrice(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 1) return value / 100;
  return value;
}

function buildAdjacentCatalogUrl(params: {
  page: number;
  platform?: PredictionVenue;
  search?: string;
}): string {
  const url = new URL(ADJACENT_MARKETS_URL);
  url.searchParams.set("scope", "all");
  url.searchParams.set("sort", "volume");
  url.searchParams.set("sort_dir", "desc");
  url.searchParams.set("limit", String(ADJACENT_PAGE_SIZE));
  url.searchParams.set("page", String(params.page));
  if (params.platform) url.searchParams.set("platform", params.platform);
  if (params.search) url.searchParams.set("q", params.search);
  return url.toString();
}

function marketsFromResponse(response: AdjacentCatalogResponse): AdjacentCatalogMarket[] {
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.markets)) return response.markets;
  return [];
}

async function fetchAdjacentCatalogPages(options: {
  platform?: PredictionVenue;
  search?: string;
  pages: number;
}): Promise<AdjacentCatalogMarket[]> {
  const records: AdjacentCatalogMarket[] = [];
  for (let page = 1; page <= options.pages; page += 1) {
    const response = await fetchJson<AdjacentCatalogResponse>(
      buildAdjacentCatalogUrl({
        page,
        platform: options.platform,
        search: options.search,
      }),
    );
    const pageRecords = marketsFromResponse(response);
    records.push(...pageRecords);
    const totalPages = response.meta?.total_pages;
    if (pageRecords.length === 0) break;
    if (totalPages != null && page >= totalPages) break;
    if (response.meta?.has_next === false) break;
  }
  return records;
}

export async function loadAdjacentVenueCatalog(
  venue: PredictionVenue,
  searchQuery = "",
  categoryId: PredictionCategoryId = "all",
): Promise<PredictionMarketSummary[]> {
  const search = searchQuery.trim();
  const records = await fetchAdjacentCatalogPages({
    platform: venue,
    search: search || undefined,
    pages: search ? ADJACENT_SEARCH_PAGES : ADJACENT_TOP_PAGES,
  });
  const deduped = new Map<string, PredictionMarketSummary>();
  for (const record of records) {
    const normalized = normalizeAdjacentCatalogMarket(record);
    if (!normalized || normalized.venue !== venue) continue;
    if (categoryId !== "all" && !matchesPredictionCategory(normalized, categoryId)) continue;
    if (search) {
      const haystack = [
        normalized.title,
        normalized.marketLabel,
        normalized.category ?? "",
        normalized.marketId,
      ].join(" ").toLowerCase();
      if (!haystack.includes(search.toLowerCase())) continue;
    }
    deduped.set(normalized.key, normalized);
  }
  return [...deduped.values()].sort((left, right) => (
    (right.volume24h ?? 0) - (left.volume24h ?? 0)
  ));
}
