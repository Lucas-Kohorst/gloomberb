import {
  buildPredictionCatalogLoadResourceKey,
  resolvePredictionCatalogOptions,
  type PredictionCatalogBrowseOptions,
  type PredictionCatalogLoadOptions,
} from "../../cache";
import {
  getPolymarketCategoryTagSlugs,
} from "../../categories";
import type {
  PredictionCategoryId,
  PredictionMarketSummary,
} from "../../types";
import {
  fetchJson,
  loadCachedPredictionResource,
  PREDICTION_CACHE_POLICIES,
} from "../fetch";
import {
  normalizePolymarketCatalog,
} from "./normalize";
import {
  searchAdjacentCatalog,
} from "../adjacent-search";
import { normalizePredictionSearchQuery } from "../../search";
import type {
  PolymarketEventRecord,
} from "./types";

export {
  normalizePolymarketCatalog,
  normalizePolymarketMarket,
} from "./normalize";
export { loadPolymarketDetail } from "./detail";

const POLYMARKET_CATALOG_OFFSETS = [0, 200, 400];
const POLYMARKET_CATEGORY_OFFSETS = [0, 200];
const POLYMARKET_PAGE_SIZE = 200;
type PolymarketCatalogSort = "volume24hr" | "endDate" | "createdAt";

export function nextPolymarketCatalogOffset(
  categoryId: PredictionCategoryId,
  searchQuery = "",
): number | null {
  if (searchQuery.trim()) return null;
  const offsets = categoryId === "all" ? POLYMARKET_CATALOG_OFFSETS : POLYMARKET_CATEGORY_OFFSETS;
  return (offsets.at(-1) ?? 0) + POLYMARKET_PAGE_SIZE;
}

function buildPolymarketCatalogUrl(
  offset: number,
  tagSlug?: string,
  limit = 200,
  sortOrder: PolymarketCatalogSort = "volume24hr",
): string {
  const url = new URL("https://gamma-api.polymarket.com/events");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("order", sortOrder);
  url.searchParams.set("ascending", sortOrder === "endDate" ? "true" : "false");
  if (tagSlug) url.searchParams.set("tag_slug", tagSlug);
  return url.toString();
}

async function loadPolymarketCatalogPages(
  offsets: number[],
  tagSlug?: string,
  limit = 200,
  signal?: AbortSignal,
  sortOrder: PolymarketCatalogSort = "volume24hr",
): Promise<PolymarketEventRecord[]> {
  const results = await Promise.allSettled(
    offsets.map((offset) =>
      fetchJson<PolymarketEventRecord[]>(
        buildPolymarketCatalogUrl(offset, tagSlug, limit, sortOrder),
        signal,
      ),
    ),
  );
  const pages = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (pages.length > 0) return pages;

  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  return [];
}

export async function loadPolymarketCatalog(
  searchQuery = "",
  categoryId: PredictionCategoryId = "all",
  browseOrOptions: PredictionCatalogBrowseOptions = "top",
  legacyOptions: PredictionCatalogLoadOptions = {},
): Promise<PredictionMarketSummary[]> {
  const { browseTab, options } = resolvePredictionCatalogOptions(
    browseOrOptions,
    legacyOptions,
  );
  const sortOrder: PolymarketCatalogSort = browseTab === "ending"
    ? "endDate"
    : browseTab === "new"
      ? "createdAt"
      : "volume24hr";
  const normalizedQuery = normalizePredictionSearchQuery(searchQuery).toLowerCase();
  const requestedLimit = Math.max(1, Math.min(200, options.limit ?? 200));
  const pageLimit = Math.max(20, requestedLimit);
  const resourceKey = buildPredictionCatalogLoadResourceKey(
    "polymarket",
    categoryId,
    normalizedQuery,
    browseTab,
    requestedLimit,
    options,
  );
  return await loadCachedPredictionResource(
    "catalog",
    resourceKey,
    async () => {
      if (normalizedQuery.length > 0) {
        const searchResult = await searchAdjacentCatalog({
          query: normalizedQuery,
          venue: "polymarket",
          categoryId,
          page: 1,
          signal: options.signal,
        });
        return searchResult.markets.slice(0, requestedLimit);
      }

      if (categoryId !== "all") {
        const tagSlugs = getPolymarketCategoryTagSlugs(categoryId);
        const categoryPages = await Promise.all(
          tagSlugs.map((tagSlug) =>
            loadPolymarketCatalogPages(
              options.firstPageOnly || options.limit ? [0] : POLYMARKET_CATEGORY_OFFSETS,
              tagSlug,
              pageLimit,
              options.signal,
              sortOrder,
            ).catch(() => []),
          ),
        );
        const categorized = normalizePolymarketCatalog(
          categoryPages.flat(),
          "",
          categoryId,
        );
        if (categorized.length > 0) return categorized.slice(0, requestedLimit);
      }

      const pages = await loadPolymarketCatalogPages(
        options.firstPageOnly || options.limit ? [0] : POLYMARKET_CATALOG_OFFSETS,
        undefined,
        pageLimit,
        options.signal,
        sortOrder,
      );
      return normalizePolymarketCatalog(pages, "", categoryId).slice(0, requestedLimit);
    },
    PREDICTION_CACHE_POLICIES.catalog,
    {
      ...options,
      // Search results must not be served from a previous empty/stale query.
      force: options.force || normalizedQuery.length > 0,
    },
  );
}

export async function loadMorePolymarketCatalog(
  searchQuery: string,
  categoryId: PredictionCategoryId,
  offset: number,
  signal?: AbortSignal,
): Promise<{ markets: PredictionMarketSummary[]; hasMore: boolean; nextOffset: number }> {
  if (normalizePredictionSearchQuery(searchQuery)) {
    return { markets: [], hasMore: false, nextOffset: offset };
  }
  const tagSlugs = categoryId === "all" ? [undefined] : getPolymarketCategoryTagSlugs(categoryId);
  const pages = await Promise.all(
    tagSlugs.map((tagSlug) => loadPolymarketCatalogPages([offset], tagSlug, POLYMARKET_PAGE_SIZE, signal).catch(() => [])),
  );
  const raw = pages.flat();
  return {
    markets: normalizePolymarketCatalog(raw, "", categoryId),
    hasMore: raw.length >= POLYMARKET_PAGE_SIZE,
    nextOffset: offset + POLYMARKET_PAGE_SIZE,
  };
}
