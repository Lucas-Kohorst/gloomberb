import {
  buildPredictionCatalogResourceKey,
} from "../../cache";
import {
  getPolymarketCategoryTagSlugs,
} from "../../categories";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionMarketSummary,
} from "../../types";
import {
  fetchJson,
  loadCachedPredictionResource,
  PREDICTION_CACHE_POLICIES,
} from "../fetch";
import {
  loadAdjacentVenueCatalog,
  shouldUseAdjacentCatalog,
} from "../adjacent/catalog";
import {
  loadPolymarketEvent,
} from "./detail";
import {
  normalizePolymarketCatalog,
  reconcilePolymarketSearchEvents,
} from "./normalize";
import type {
  PolymarketEventRecord,
  PolymarketSearchResponse,
} from "./types";

export { normalizePolymarketMarket } from "./normalize";
export { loadPolymarketDetail } from "./detail";

const POLYMARKET_CATALOG_OFFSETS = [0, 200, 400];
const POLYMARKET_CATEGORY_OFFSETS = [0, 200];

type PolymarketSortOrder = "volume24hr" | "endDate" | "createdAt";

function browseTabToPolymarketSort(browseTab: PredictionBrowseTab): PolymarketSortOrder {
  switch (browseTab) {
    case "new":
      return "createdAt";
    case "ending":
      return "endDate";
    default:
      return "volume24hr";
  }
}

function buildPolymarketCatalogUrl(
  offset: number,
  tagSlug?: string,
  sortOrder: PolymarketSortOrder = "volume24hr",
): string {
  const url = new URL("https://gamma-api.polymarket.com/events");
  url.searchParams.set("limit", "200");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("order", sortOrder);
  url.searchParams.set("ascending", sortOrder === "endDate" ? "true" : "false");
  if (tagSlug) url.searchParams.set("tag_slug", tagSlug);
  return url.toString();
}

function buildPolymarketSearchUrl(query: string): string {
  const url = new URL("https://gamma-api.polymarket.com/public-search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit_per_type", "40");
  url.searchParams.set("search_profiles", "false");
  url.searchParams.set("search_tags", "false");
  url.searchParams.set("events_status", "open");
  url.searchParams.set("optimized", "true");
  return url.toString();
}

async function loadPolymarketCatalogPages(
  offsets: number[],
  tagSlug?: string,
  sortOrder: PolymarketSortOrder = "volume24hr",
): Promise<PolymarketEventRecord[]> {
  const results = await Promise.allSettled(
    offsets.map((offset) =>
      fetchJson<PolymarketEventRecord[]>(
        buildPolymarketCatalogUrl(offset, tagSlug, sortOrder),
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
  browseTab: PredictionBrowseTab = "top",
): Promise<PredictionMarketSummary[]> {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const sortOrder = browseTabToPolymarketSort(browseTab);
  return await loadCachedPredictionResource(
    "catalog",
    buildPredictionCatalogResourceKey("polymarket", categoryId, normalizedQuery, browseTab),
    async () => {
      if (shouldUseAdjacentCatalog(browseTab, normalizedQuery)) {
        try {
          const adjacent = await loadAdjacentVenueCatalog(
            "polymarket",
            normalizedQuery,
            categoryId,
          );
          if (adjacent.length > 0) return adjacent;
        } catch {
          // Fall back to Gamma when Adjacent is down or empty.
        }
      }
      if (normalizedQuery.length > 0) {
        const response = await fetchJson<PolymarketSearchResponse>(
          buildPolymarketSearchUrl(normalizedQuery),
        );
        const searchEvents = response.events ?? [];
        const hydratedEvents = (
          await Promise.all(
            [...new Set(searchEvents.map((event) => event.id).filter(Boolean))]
              .map((eventId) => loadPolymarketEvent(eventId)),
          )
        ).filter((event): event is PolymarketEventRecord => event != null);
        const resolvedEvents = reconcilePolymarketSearchEvents(
          searchEvents,
          hydratedEvents,
        );
        return normalizePolymarketCatalog(
          resolvedEvents,
          normalizedQuery,
          categoryId,
        );
      }

      if (categoryId !== "all") {
        const tagSlugs = getPolymarketCategoryTagSlugs(categoryId);
        const categoryPages = await Promise.all(
          tagSlugs.map((tagSlug) =>
            loadPolymarketCatalogPages(
              POLYMARKET_CATEGORY_OFFSETS,
              tagSlug,
              sortOrder,
            ).catch(() => []),
          ),
        );
        const categorized = normalizePolymarketCatalog(
          categoryPages.flat(),
          "",
          categoryId,
        );
        if (categorized.length > 0) return categorized;
      }

      const pages = await loadPolymarketCatalogPages(
        POLYMARKET_CATALOG_OFFSETS,
        undefined,
        sortOrder,
      );
      return normalizePolymarketCatalog(pages, "", categoryId);
    },
    PREDICTION_CACHE_POLICIES.catalog,
  );
}
