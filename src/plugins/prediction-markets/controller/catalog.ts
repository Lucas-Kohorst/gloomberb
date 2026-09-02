import { runAfterStartupBackground } from "../../../utils/startup-interaction";
import { shouldYieldToUi, whenUiQuiet } from "../../../utils/ui-yield";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  buildPredictionCatalogCacheKey,
  buildPredictionCatalogResourceKey,
  capPredictionCatalogByEvent,
  mergePredictionCatalogPage,
  samePredictionCatalogSummaries,
  updatePredictionErrorState,
  updatePredictionPendingCounts,
} from "../cache";
import {
  type PredictionCatalogSource,
  formatPredictionLoadError,
  getPredictionCatalogStatus,
} from "./status";
import { useAutoRefresh } from "../../builtin/shared/auto-refresh";
import { getCachedPredictionResource } from "../services/fetch";
import { kalshiCatalogCursor, loadKalshiCatalog, loadMoreKalshiCatalog } from "../services/kalshi/adapter";
import { loadMorePolymarketCatalog, loadPolymarketCatalog, nextPolymarketCatalogOffset } from "../services/polymarket/adapter";
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
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  const [polymarketLoadedAt, setPolymarketLoadedAt] = useState<number | null>(null);
  const [kalshiLoadedAt, setKalshiLoadedAt] = useState<number | null>(null);
  const [polymarketNextOffset, setPolymarketNextOffset] = useState<number | null>(null);
  const [kalshiNextCursor, setKalshiNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
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
  const polymarketSearchResourceKey = useMemo(
    () =>
      normalizedSearchQuery
        ? buildPredictionCatalogResourceKey(
            "polymarket",
            categoryId,
            normalizedSearchQuery,
            browseTab,
          )
        : null,
    [browseTab, categoryId, normalizedSearchQuery],
  );
  const kalshiSearchResourceKey = useMemo(
    () =>
      normalizedSearchQuery
        ? buildPredictionCatalogResourceKey(
            "kalshi",
            categoryId,
            normalizedSearchQuery,
            browseTab,
          )
        : null,
    [browseTab, categoryId, normalizedSearchQuery],
  );

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
      polymarketSearchKey && polymarketSearchResourceKey
        ? readCatalogSlice(
            catalogCache,
            polymarketSearchKey,
            polymarketSearchResourceKey,
          )
        : EMPTY_CATALOG_SLICE,
    [
      catalogCache,
      polymarketSearchKey,
      polymarketSearchResourceKey,
    ],
  );
  const kalshiSearch = useMemo(
    () =>
      kalshiSearchKey && kalshiSearchResourceKey
        ? readCatalogSlice(catalogCache, kalshiSearchKey, kalshiSearchResourceKey)
        : EMPTY_CATALOG_SLICE,
    [catalogCache, kalshiSearchKey, kalshiSearchResourceKey],
  );

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
    const merged: PredictionMarketSummary[] = [];
    if (includePolymarket) {
      merged.push(
        ...mergeCatalogMarkets(polymarketBrowse, polymarketSearch),
      );
    }
    if (includeKalshi) {
      merged.push(...mergeCatalogMarkets(kalshiBrowse, kalshiSearch));
    }
    return merged;
  }, [
    includeKalshi,
    includePolymarket,
    kalshiBrowse,
    kalshiSearch,
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
      const showPending =
        options?.showPending ??
        (activeCatalogRef.current[cacheKey]?.length ?? 0) === 0;
      if (showPending) {
        setCatalogPending((current) =>
          updatePredictionPendingCounts(current, cacheKey, 1),
        );
      }
      try {
        const next = await loadPolymarketCatalog(search, category, browseTab, options);
        if (shouldYieldToUi()) await whenUiQuiet();
        setCatalogCache((current) => {
          const previous = current[cacheKey] ?? activeCatalogRef.current[cacheKey];
          const slice = options?.firstPageOnly
            ? mergePredictionCatalogPage(previous, next)
            : next;
          if (samePredictionCatalogSummaries(previous, slice)) {
            return current;
          }
          return {
            ...current,
            [cacheKey]: slice,
          };
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
      } finally {
        setPolymarketLoadedAt(Date.now());
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
      const showPending =
        options?.showPending ??
        (activeCatalogRef.current[cacheKey]?.length ?? 0) === 0;
      if (showPending) {
        setCatalogPending((current) =>
          updatePredictionPendingCounts(current, cacheKey, 1),
        );
      }
      try {
        const next = await loadKalshiCatalog(search, category, browseTab, options);
        if (shouldYieldToUi()) await whenUiQuiet();
        setKalshiFeed(getKalshiCatalogFeed());
        setCatalogCache((current) => {
          const previous = current[cacheKey] ?? activeCatalogRef.current[cacheKey];
          const slice = options?.firstPageOnly
            ? mergePredictionCatalogPage(previous, next)
            : next;
          if (samePredictionCatalogSummaries(previous, slice)) {
            return current;
          }
          return {
            ...current,
            [cacheKey]: slice,
          };
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
      } finally {
        setKalshiLoadedAt(Date.now());
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
    if (!searchQuery.trim()) {
      setDebouncedSearchQuery("");
      return;
    }
    const timeoutId = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Reloads follow the one refresh cadence the user configured, instead of two
  // hardcoded intervals nobody can change.
  useEffect(() => {
    if (!includePolymarket) return;
    void loadPolymarket(
      polymarketCatalogKey,
      debouncedSearchQuery,
      categoryId,
    );
  }, [
    categoryId,
    debouncedSearchQuery,
    includePolymarket,
    loadPolymarket,
    normalizedSearchQuery,
    polymarketSearchKey,
  ]);

  useAutoRefresh(includePolymarket ? polymarketLoadedAt : null, useCallback(() => {
    void loadPolymarket(polymarketCatalogKey, debouncedSearchQuery, categoryId);
  }, [categoryId, debouncedSearchQuery, loadPolymarket, polymarketCatalogKey]));

  useEffect(() => {
    if (!includeKalshi) return;
    void loadKalshi(kalshiCatalogKey, debouncedSearchQuery, categoryId);
  }, [
    categoryId,
    debouncedSearchQuery,
    includeKalshi,
    kalshiSearchKey,
    loadKalshi,
    normalizedSearchQuery,
  ]);

  const refreshCatalog = useCallback(() => {
    if (includePolymarket) {
      void loadPolymarket(polymarketBrowseKey, "", categoryId, {
        showPending: true,
        force: true,
        firstPageOnly: true,
      });
      if (polymarketSearchKey && normalizedSearchQuery) {
        void loadPolymarket(
          polymarketSearchKey,
          debouncedSearchQuery,
          categoryId,
          { force: true },
        );
      }
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
      if (kalshiSearchKey && normalizedSearchQuery) {
        void loadKalshi(kalshiSearchKey, debouncedSearchQuery, categoryId, {
          force: true,
        });
      }
    }
  }, [
    categoryId,
    debouncedSearchQuery,
    includeKalshi,
    includePolymarket,
    kalshiBrowseKey,
    kalshiSearchKey,
    loadKalshi,
    loadPolymarket,
    normalizedSearchQuery,
    polymarketBrowseKey,
    polymarketSearchKey,
  ]);

  const loadMoreCatalog = useCallback(async () => {
    if (loadingMore) return;
    const canLoadPolymarket = includePolymarket && polymarketNextOffset != null;
    const canLoadKalshi = includeKalshi && !!kalshiNextCursor;
    if (!canLoadPolymarket && !canLoadKalshi) return;
    setLoadingMore(true);
    try {
      if (canLoadPolymarket && polymarketNextOffset != null) {
        const page = await loadMorePolymarketCatalog(
          "",
          categoryId,
          polymarketNextOffset,
        );
        setCatalogCache((current) => ({
          ...current,
          [polymarketBrowseKey]: mergeCatalogMarkets(
            current[polymarketBrowseKey] ?? activeCatalogRef.current[polymarketBrowseKey] ?? [],
            page.markets,
          ),
        }));
        setPolymarketNextOffset(page.hasMore ? page.nextOffset : null);
        setCatalogLastRefreshAt(Date.now());
      }
      if (canLoadKalshi && kalshiNextCursor) {
        const page = await loadMoreKalshiCatalog(
          "",
          categoryId,
          kalshiNextCursor,
        );
        setCatalogCache((current) => ({
          ...current,
          [kalshiBrowseKey]: mergeCatalogMarkets(
            current[kalshiBrowseKey] ?? activeCatalogRef.current[kalshiBrowseKey] ?? [],
            page.markets,
          ),
        }));
        setKalshiNextCursor(page.nextCursor);
        setKalshiFeed(getKalshiCatalogFeed());
        setCatalogLastRefreshAt(Date.now());
      }
    } finally {
      setLoadingMore(false);
    }
  }, [
    categoryId,
    includeKalshi,
    includePolymarket,
    kalshiBrowseKey,
    kalshiNextCursor,
    loadingMore,
    polymarketBrowseKey,
    polymarketNextOffset,
  ]);

  useAutoRefresh(includeKalshi ? kalshiLoadedAt : null, useCallback(() => {
    void loadKalshi(kalshiCatalogKey, debouncedSearchQuery, categoryId);
  }, [categoryId, debouncedSearchQuery, kalshiCatalogKey, loadKalshi]));

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
    catalogLoadCount,
    catalogLoadingMore: loadingMore,
    catalogStatus,
    kalshiFeed,
    debouncedSearchQuery,
    loadMoreCatalog,
    setCatalogCache,
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
