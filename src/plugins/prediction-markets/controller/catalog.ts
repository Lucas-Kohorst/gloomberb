import { shouldYieldToUi, whenUiQuiet } from "../../../utils/ui-yield";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  buildPredictionCatalogCacheKey,
  buildPredictionCatalogResourceKey,
  capPredictionCatalogByEvent,
  mergePredictionCatalogPage,
  overlayLivePredictionQuotes,
  samePredictionCatalogSummaries,
  updatePredictionErrorState,
  updatePredictionPendingCounts,
} from "../cache";
import {
  type PredictionCatalogSource,
  formatPredictionLoadError,
  getPredictionCatalogStatus,
} from "./status";
import { useAutoRefresh } from "../../builtin/shared/use-auto-refresh";
import { getCachedPredictionResource } from "../services/fetch";
import { kalshiCatalogCursor, loadKalshiCatalog, loadMoreKalshiCatalog } from "../services/kalshi/adapter";
import { loadMorePolymarketCatalog, loadPolymarketCatalog, nextPolymarketCatalogOffset } from "../services/polymarket/adapter";
import { searchAdjacentCatalog } from "../services/adjacent-search";
import { normalizePredictionSearchQuery } from "../search";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionMarketSummary,
  PredictionVenue,
} from "../types";

type PredictionCatalogCache = Record<string, PredictionMarketSummary[]>;
export type PredictionCatalogCacheSetter = Dispatch<SetStateAction<PredictionCatalogCache>>;
const EMPTY_CATALOG_SLICE: PredictionMarketSummary[] = [];

interface UsePredictionCatalogDataOptions {
  browseTab: PredictionBrowseTab;
  categoryId: PredictionCategoryId;
  includeKalshi: boolean;
  includePolymarket: boolean;
  pollIntervalMs: number;
  searchQuery: string;
}

function readCatalogSlice(
  catalogCache: PredictionCatalogCache,
  cacheKey: string,
  resourceKey: string,
): PredictionMarketSummary[] {
  const fromState = catalogCache[cacheKey];
  if (fromState) return fromState;
  const persisted = getCachedPredictionResource<PredictionMarketSummary[]>(
    "catalog",
    resourceKey,
  );
  if (!persisted || persisted.length === 0) return EMPTY_CATALOG_SLICE;
  return capPredictionCatalogByEvent(persisted);
}

export function usePredictionCatalogData({
  browseTab,
  categoryId,
  includeKalshi,
  includePolymarket,
  pollIntervalMs,
  searchQuery,
}: UsePredictionCatalogDataOptions) {
  const [catalogCache, setCatalogCache] = useState<PredictionCatalogCache>({});
  const [catalogPending, setCatalogPending] = useState<Record<string, number>>(
    {},
  );
  const [catalogErrors, setCatalogErrors] = useState<
    Record<string, string | null>
  >({});
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(() =>
    normalizePredictionSearchQuery(searchQuery),
  );
  const [catalogLastRefreshAt, setCatalogLastRefreshAt] = useState<number | null>(null);
  const [polymarketLoadedAt, setPolymarketLoadedAt] = useState<number | null>(null);
  const [kalshiLoadedAt, setKalshiLoadedAt] = useState<number | null>(null);
  const [polymarketNextOffset, setPolymarketNextOffset] = useState<number | null>(null);
  const [kalshiNextCursor, setKalshiNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [kalshiFeed, setKalshiFeed] = useState<"live" | "delayed">("live");
  const activeCatalogRef = useRef<PredictionCatalogCache>({});

  const normalizedSearchQuery = debouncedSearchQuery.trim().toLowerCase();
  const polymarketBrowseKey = useMemo(
    () => buildPredictionCatalogCacheKey("polymarket", categoryId, "", browseTab),
    [browseTab, categoryId],
  );
  const kalshiBrowseKey = useMemo(
    () => buildPredictionCatalogCacheKey("kalshi", categoryId, "", browseTab),
    [browseTab, categoryId],
  );
  const polymarketSearchKey = useMemo(
    () =>
      normalizedSearchQuery
        ? buildPredictionCatalogCacheKey(
            "polymarket",
            categoryId,
            debouncedSearchQuery,
            browseTab,
          )
        : null,
    [browseTab, categoryId, debouncedSearchQuery, normalizedSearchQuery],
  );
  const kalshiSearchKey = useMemo(
    () =>
      normalizedSearchQuery
        ? buildPredictionCatalogCacheKey(
            "kalshi",
            categoryId,
            debouncedSearchQuery,
            browseTab,
          )
        : null,
    [browseTab, categoryId, debouncedSearchQuery, normalizedSearchQuery],
  );
  const polymarketBrowseResourceKey = useMemo(
    () =>
      buildPredictionCatalogResourceKey("polymarket", categoryId, "", browseTab),
    [browseTab, categoryId],
  );
  const kalshiBrowseResourceKey = useMemo(
    () => buildPredictionCatalogResourceKey("kalshi", categoryId, "", browseTab),
    [browseTab, categoryId],
  );
  const polymarketCatalogKey = polymarketSearchKey ?? polymarketBrowseKey;
  const kalshiCatalogKey = kalshiSearchKey ?? kalshiBrowseKey;

  const polymarketBrowse = useMemo(
    () => readCatalogSlice(
      catalogCache,
      polymarketBrowseKey,
      polymarketBrowseResourceKey,
    ),
    [catalogCache, polymarketBrowseKey, polymarketBrowseResourceKey],
  );
  const kalshiBrowse = useMemo(
    () => readCatalogSlice(
      catalogCache,
      kalshiBrowseKey,
      kalshiBrowseResourceKey,
    ),
    [catalogCache, kalshiBrowseKey, kalshiBrowseResourceKey],
  );
  const polymarketSearch = useMemo(
    () =>
      polymarketSearchKey
        ? catalogCache[polymarketSearchKey] ?? EMPTY_CATALOG_SLICE
        : EMPTY_CATALOG_SLICE,
    [catalogCache, polymarketSearchKey],
  );
  const kalshiSearch = useMemo(
    () =>
      kalshiSearchKey
        ? catalogCache[kalshiSearchKey] ?? EMPTY_CATALOG_SLICE
        : EMPTY_CATALOG_SLICE,
    [catalogCache, kalshiSearchKey],
  );
  // Search is force-fetched. Hydrating a previous empty persist slice looks
  // like a finished query and paints "No markets matched" instead of Adjacent
  // hits. Ready means this session has written the search key (including []).
  const polymarketSearchReady =
    !includePolymarket
    || !polymarketSearchKey
    || Object.hasOwn(catalogCache, polymarketSearchKey);
  const kalshiSearchReady =
    !includeKalshi
    || !kalshiSearchKey
    || Object.hasOwn(catalogCache, kalshiSearchKey);
  const catalogSearchReady = polymarketSearchReady && kalshiSearchReady;

  activeCatalogRef.current = {
    [polymarketBrowseKey]: polymarketBrowse,
    [kalshiBrowseKey]: kalshiBrowse,
    ...(polymarketSearchKey ? { [polymarketSearchKey]: polymarketSearch } : {}),
    ...(kalshiSearchKey ? { [kalshiSearchKey]: kalshiSearch } : {}),
  };

  const activeCatalogKeys = useMemo(
    () =>
      [
        includePolymarket ? polymarketBrowseKey : null,
        includeKalshi ? kalshiBrowseKey : null,
        includePolymarket ? polymarketSearchKey : null,
        includeKalshi ? kalshiSearchKey : null,
      ].filter((value): value is string => value != null),
    [
      includeKalshi,
      includePolymarket,
      kalshiBrowseKey,
      kalshiSearchKey,
      polymarketBrowseKey,
      polymarketSearchKey,
    ],
  );
  const activeCatalogSources = useMemo(() => {
    const sources: PredictionCatalogSource[] = [];
    const pushSource = (
      venue: PredictionVenue,
      cacheKey: string,
      markets: PredictionMarketSummary[],
    ) => {
      sources.push({
        venue,
        cacheKey,
        error: catalogErrors[cacheKey] ?? null,
        markets,
      });
    };
    if (includePolymarket) {
      pushSource("polymarket", polymarketBrowseKey, polymarketBrowse);
      if (polymarketSearchKey) {
        pushSource("polymarket", polymarketSearchKey, polymarketSearch);
      }
    }
    if (includeKalshi) {
      pushSource("kalshi", kalshiBrowseKey, kalshiBrowse);
      if (kalshiSearchKey) {
        pushSource("kalshi", kalshiSearchKey, kalshiSearch);
      }
    }
    return sources;
  }, [
    catalogErrors,
    includeKalshi,
    includePolymarket,
    kalshiBrowse,
    kalshiBrowseKey,
    kalshiSearch,
    kalshiSearchKey,
    polymarketBrowse,
    polymarketBrowseKey,
    polymarketSearch,
    polymarketSearchKey,
  ]);
  const catalogLoadCount = activeCatalogKeys.reduce(
    (count, cacheKey) => count + (catalogPending[cacheKey] ?? 0),
    0,
  );
  const catalogStatus = useMemo(
    () => getPredictionCatalogStatus(activeCatalogSources),
    [activeCatalogSources],
  );
  const allMarkets = useMemo(() => {
    if (normalizedSearchQuery) {
      const searched: PredictionMarketSummary[] = [];
      if (includePolymarket) searched.push(...polymarketSearch);
      if (includeKalshi) searched.push(...kalshiSearch);
      // Adjacent is the search index. Once this session has written the search
      // key — hits or [] — do not fall back to the volume-sorted browse page.
      // Diesel is missing there, which is why command-bar finds it and the pane
      // used to show "No markets matched".
      if (searched.length > 0 || catalogSearchReady) return searched;
    }
    const merged: PredictionMarketSummary[] = [];
    if (includePolymarket) merged.push(...polymarketBrowse);
    if (includeKalshi) merged.push(...kalshiBrowse);
    return merged;
  }, [
    catalogSearchReady,
    includeKalshi,
    includePolymarket,
    kalshiBrowse,
    kalshiSearch,
    normalizedSearchQuery,
    polymarketBrowse,
    polymarketSearch,
  ]);

  const loadPolymarket = useCallback(
    async (
      cacheKey: string,
      search: string,
      category: PredictionCategoryId,
      options?: { showPending?: boolean; force?: boolean; firstPageOnly?: boolean },
    ) => {
      const searching = normalizePredictionSearchQuery(search).length > 0;
      const showPending =
        options?.showPending ??
        (searching || (activeCatalogRef.current[cacheKey]?.length ?? 0) === 0);
      if (showPending) {
        setCatalogPending((current) =>
          updatePredictionPendingCounts(current, cacheKey, 1),
        );
      }
      try {
        const next = await loadPolymarketCatalog(search, category, browseTab, options);
        // Browse polls can wait so typing stays smooth. Search results must
        // paint even while the box is focused — input yield has no timeout.
        if (!searching && shouldYieldToUi()) await whenUiQuiet();
        setCatalogCache((current) => {
          const previous = current[cacheKey] ?? activeCatalogRef.current[cacheKey];
          const slice = options?.firstPageOnly
            ? mergePredictionCatalogPage(previous, next)
            : overlayLivePredictionQuotes(previous, next);
          return commitCatalogCache(current, cacheKey, previous, slice);
        });
        setCatalogErrors((current) =>
          updatePredictionErrorState(current, cacheKey, null),
        );
        setPolymarketNextOffset(nextPolymarketCatalogOffset(category, search));
      } catch (error) {
        setCatalogErrors((current) =>
          updatePredictionErrorState(
            current,
            cacheKey,
            formatPredictionLoadError("polymarket", "markets", error),
          ),
        );
        if (searching) {
          setCatalogCache((current) => seedEmptyCatalogCache(current, cacheKey));
        }
      } finally {
        const loadedAt = Date.now();
        setPolymarketLoadedAt(loadedAt);
        setCatalogLastRefreshAt(loadedAt);
        if (showPending) {
          setCatalogPending((current) =>
            updatePredictionPendingCounts(current, cacheKey, -1),
          );
        }
      }
    },
    [browseTab],
  );

  const loadKalshi = useCallback(
    async (
      cacheKey: string,
      search: string,
      category: PredictionCategoryId,
      options?: { showPending?: boolean; force?: boolean; firstPageOnly?: boolean },
    ) => {
      const searching = normalizePredictionSearchQuery(search).length > 0;
      const showPending =
        options?.showPending ??
        (searching || (activeCatalogRef.current[cacheKey]?.length ?? 0) === 0);
      if (showPending) {
        setCatalogPending((current) =>
          updatePredictionPendingCounts(current, cacheKey, 1),
        );
      }
      try {
        const next = await loadKalshiCatalog(search, category, browseTab, options);
        if (!searching && shouldYieldToUi()) await whenUiQuiet();
        setCatalogCache((current) => {
          const previous = current[cacheKey] ?? activeCatalogRef.current[cacheKey];
          const slice = options?.firstPageOnly
            ? mergePredictionCatalogPage(previous, next)
            : overlayLivePredictionQuotes(previous, next);
          return commitCatalogCache(current, cacheKey, previous, slice);
        });
        setCatalogErrors((current) =>
          updatePredictionErrorState(current, cacheKey, null),
        );
        setKalshiNextCursor(kalshiCatalogCursor(search, category));
      } catch (error) {
        setCatalogErrors((current) =>
          updatePredictionErrorState(
            current,
            cacheKey,
            formatPredictionLoadError("kalshi", "markets", error),
          ),
        );
        if (searching) {
          setCatalogCache((current) => seedEmptyCatalogCache(current, cacheKey));
        }
      } finally {
        const loadedAt = Date.now();
        setKalshiLoadedAt(loadedAt);
        setCatalogLastRefreshAt(loadedAt);
        if (showPending) {
          setCatalogPending((current) =>
            updatePredictionPendingCounts(current, cacheKey, -1),
          );
        }
      }
    },
    [browseTab],
  );

  useEffect(() => {
    const normalized = normalizePredictionSearchQuery(searchQuery);
    if (!normalized) {
      setDebouncedSearchQuery("");
      return;
    }
    const timeoutId = setTimeout(() => {
      setDebouncedSearchQuery(normalized);
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Reloads follow the one refresh cadence the user configured, instead of two
  // hardcoded intervals nobody can change.
  useEffect(() => {
    if (!includePolymarket) return;
    if (normalizedSearchQuery) return;
    void loadPolymarket(polymarketBrowseKey, "", categoryId);
  }, [
    categoryId,
    includePolymarket,
    loadPolymarket,
    normalizedSearchQuery,
    polymarketBrowseKey,
  ]);

  useAutoRefresh(includePolymarket && !normalizedSearchQuery ? polymarketLoadedAt : null, useCallback(() => {
    void loadPolymarket(polymarketBrowseKey, "", categoryId);
  }, [categoryId, loadPolymarket, polymarketBrowseKey]), pollIntervalMs / 60_000);

  useEffect(() => {
    if (!includeKalshi) return;
    if (normalizedSearchQuery) return;
    void loadKalshi(kalshiBrowseKey, "", categoryId);
  }, [
    categoryId,
    includeKalshi,
    kalshiBrowseKey,
    loadKalshi,
    normalizedSearchQuery,
  ]);

  const loadAdjacentSearch = useCallback(
    async (
      venue: PredictionVenue,
      cacheKey: string,
      query: string,
      signal?: AbortSignal,
    ) => {
      setCatalogPending((current) =>
        updatePredictionPendingCounts(current, cacheKey, 1),
      );
      try {
        const result = await searchAdjacentCatalog({
          query,
          venue,
          categoryId,
          page: 1,
          signal,
        });
        if (signal?.aborted) return;
        setCatalogCache((current) =>
          commitCatalogCache(current, cacheKey, current[cacheKey], result.markets),
        );
        setCatalogErrors((current) =>
          updatePredictionErrorState(current, cacheKey, null),
        );
        if (venue === "kalshi") {
          setKalshiNextCursor(result.nextCursor);
        }
        if (venue === "polymarket") {
          setPolymarketNextOffset(null);
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
          return;
        }
        setCatalogErrors((current) =>
          updatePredictionErrorState(
            current,
            cacheKey,
            formatPredictionLoadError(venue, "markets", error),
          ),
        );
        setCatalogCache((current) => seedEmptyCatalogCache(current, cacheKey));
      } finally {
        setCatalogPending((current) =>
          updatePredictionPendingCounts(current, cacheKey, -1),
        );
        if (signal?.aborted) return;
        const loadedAt = Date.now();
        if (venue === "kalshi") setKalshiLoadedAt(loadedAt);
        if (venue === "polymarket") setPolymarketLoadedAt(loadedAt);
        setCatalogLastRefreshAt(loadedAt);
      }
    },
    [categoryId],
  );

  useEffect(() => {
    if (!normalizedSearchQuery) return;
    const kalshiKey = includeKalshi ? kalshiSearchKey : null;
    const polymarketKey = includePolymarket ? polymarketSearchKey : null;
    if (!kalshiKey && !polymarketKey) return;
    const controller = new AbortController();
    if (kalshiKey) {
      void loadAdjacentSearch("kalshi", kalshiKey, normalizedSearchQuery, controller.signal);
    }
    if (polymarketKey) {
      void loadAdjacentSearch(
        "polymarket",
        polymarketKey,
        normalizedSearchQuery,
        controller.signal,
      );
    }
    return () => {
      controller.abort();
    };
  }, [
    includeKalshi,
    includePolymarket,
    kalshiSearchKey,
    loadAdjacentSearch,
    normalizedSearchQuery,
    polymarketSearchKey,
  ]);

  const refreshCatalog = useCallback(() => {
    if (normalizedSearchQuery) {
      if (includePolymarket && polymarketSearchKey) {
        void loadAdjacentSearch("polymarket", polymarketSearchKey, normalizedSearchQuery);
      }
      if (includeKalshi && kalshiSearchKey) {
        void loadAdjacentSearch("kalshi", kalshiSearchKey, normalizedSearchQuery);
      }
      return;
    }
    if (includePolymarket) {
      void loadPolymarket(polymarketBrowseKey, "", categoryId, {
        showPending: true,
        force: true,
        firstPageOnly: true,
      });
    }
    if (includeKalshi) {
      void (async () => {
        await loadKalshi(kalshiBrowseKey, "", categoryId, {
          showPending: true,
          force: true,
          firstPageOnly: true,
        });
        await loadKalshi(kalshiBrowseKey, "", categoryId, { showPending: false });
      })();
    }
  }, [
    categoryId,
    includeKalshi,
    includePolymarket,
    kalshiBrowseKey,
    kalshiSearchKey,
    loadAdjacentSearch,
    loadKalshi,
    loadPolymarket,
    normalizedSearchQuery,
    polymarketBrowseKey,
    polymarketSearchKey,
  ]);

  useAutoRefresh(includeKalshi && !normalizedSearchQuery ? kalshiLoadedAt : null, useCallback(() => {
    void loadKalshi(kalshiBrowseKey, "", categoryId);
  }, [categoryId, kalshiBrowseKey, loadKalshi]), pollIntervalMs / 60_000);

  const loadMoreCatalog = useCallback(async () => {
    if (loadingMore) return;
    const canLoadPolymarket = includePolymarket && polymarketNextOffset != null;
    const canLoadKalshi = includeKalshi && !!kalshiNextCursor;
    if (!canLoadPolymarket && !canLoadKalshi) return;
    setLoadingMore(true);
    try {
      if (canLoadPolymarket && polymarketNextOffset != null) {
        const page = await loadMorePolymarketCatalog(
          debouncedSearchQuery,
          categoryId,
          polymarketNextOffset,
        );
        setCatalogCache((current) => ({
          ...current,
          [polymarketCatalogKey]: mergeCatalogMarkets(
            current[polymarketCatalogKey] ?? activeCatalogRef.current[polymarketCatalogKey] ?? [],
            page.markets,
          ),
        }));
        setPolymarketNextOffset(page.hasMore ? page.nextOffset : null);
        setCatalogLastRefreshAt(Date.now());
      }
      if (canLoadKalshi && kalshiNextCursor) {
        const page = await loadMoreKalshiCatalog(
          debouncedSearchQuery,
          categoryId,
          kalshiNextCursor,
        );
        setCatalogCache((current) => ({
          ...current,
          [kalshiCatalogKey]: mergeCatalogMarkets(
            current[kalshiCatalogKey] ?? activeCatalogRef.current[kalshiCatalogKey] ?? [],
            page.markets,
          ),
        }));
        setKalshiNextCursor(page.nextCursor);
        setCatalogLastRefreshAt(Date.now());
      }
    } finally {
      setLoadingMore(false);
    }
  }, [
    categoryId,
    debouncedSearchQuery,
    includeKalshi,
    includePolymarket,
    kalshiCatalogKey,
    kalshiNextCursor,
    loadingMore,
    polymarketCatalogKey,
    polymarketNextOffset,
  ]);

  return {
    allMarkets,
    catalogHasMore: (includePolymarket && polymarketNextOffset != null) || (includeKalshi && !!kalshiNextCursor),
    catalogLastRefreshAt,
    catalogLoadCount,
    catalogLoadingMore: loadingMore,
    catalogStatus,
    catalogSearchReady,
    kalshiFeed,
    debouncedSearchQuery,
    refreshCatalog,
    loadMoreCatalog,
    setCatalogCache,
  };
}

function commitCatalogCache(
  current: PredictionCatalogCache,
  cacheKey: string,
  previous: PredictionMarketSummary[] | undefined,
  slice: PredictionMarketSummary[],
): PredictionCatalogCache {
  if (
    Object.hasOwn(current, cacheKey)
    && samePredictionCatalogSummaries(previous, slice)
  ) {
    return current;
  }
  return {
    ...current,
    [cacheKey]: slice,
  };
}

function seedEmptyCatalogCache(
  current: PredictionCatalogCache,
  cacheKey: string,
): PredictionCatalogCache {
  if (Object.hasOwn(current, cacheKey)) return current;
  return {
    ...current,
    [cacheKey]: EMPTY_CATALOG_SLICE,
  };
}

function mergeCatalogMarkets(
  current: PredictionMarketSummary[],
  extra: PredictionMarketSummary[],
): PredictionMarketSummary[] {
  if (extra.length === 0) return current;
  const seen = new Set(current.map((market) => market.key));
  const merged = [...current];
  for (const market of extra) {
    if (seen.has(market.key)) continue;
    seen.add(market.key);
    merged.push(market);
  }
  return merged;
}
