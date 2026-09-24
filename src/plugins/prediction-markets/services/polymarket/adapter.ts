import {
  buildPredictionCatalogLoadResourceKey,
  resolvePredictionCatalogOptions,
  type PredictionCatalogBrowseOptions,
  type PredictionCatalogLoadOptions,
} from "../../cache";
import type {
  PredictionCategoryId,
  PredictionMarketSummary,
} from "../../types";
import {
  loadCachedPredictionResource,
  PREDICTION_CACHE_POLICIES,
} from "../fetch";
import {
  listAdjacentCatalog,
  searchAdjacentCatalog,
} from "../adjacent-search";
import { normalizePredictionSearchQuery } from "../../search";

export {
  normalizePolymarketCatalog,
  normalizePolymarketMarket,
} from "./normalize";
export { loadPolymarketDetail } from "./detail";

export function nextPolymarketCatalogOffset(
  _categoryId: PredictionCategoryId,
  searchQuery = "",
): number | null {
  if (normalizePredictionSearchQuery(searchQuery)) return null;
  return 2;
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
  const normalizedQuery = normalizePredictionSearchQuery(searchQuery).toLowerCase();
  const requestedLimit = Math.max(1, Math.min(200, options.limit ?? 200));
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

      const listed = await listAdjacentCatalog({
        venue: "polymarket",
        categoryId,
        browseTab,
        page: 1,
        signal: options.signal,
      });
      return listed.markets.slice(0, requestedLimit);
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
  const listed = await listAdjacentCatalog({
    venue: "polymarket",
    categoryId,
    page: offset,
    signal,
  });
  return {
    markets: listed.markets,
    hasMore: listed.hasMore,
    nextOffset: offset + 1,
  };
}
