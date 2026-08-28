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
import { getCachedPredictionResource } from "../services/fetch";
import { kalshiCatalogCursor, loadKalshiCatalog, loadMoreKalshiCatalog, getKalshiCatalogFeed } from "../services/kalshi/adapter";
import { loadMorePolymarketCatalog, loadPolymarketCatalog, nextPolymarketCatalogOffset } from "../services/polymarket/adapter";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionMarketSummary,
  PredictionVenue,
} from "../types";

type PredictionCatalogCache = Record<string, PredictionMarketSummary[]>;
export type PredictionCatalogCacheSetter = Dispatch<SetStateAction<PredictionCatalogCache>>;

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
  if (!persisted || persisted.length === 0) return [];
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
  const [catalogLastRefreshAt, setCatalogLastRefreshAt] = useState<number | null>(
    null,
  );
  const [polymarketNextOffset, setPolymarketNextOffset] = useState<number | null>(null);
  const [kalshiNextCursor, setKalshiNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [kalshiFeed, setKalshiFeed] = useState<"live" | "delayed">("live");
  const activeCatalogRef = useRef<PredictionCatalogCache>({});

  const normalizedSearchQuery = debouncedSearchQuery.trim().toLowerCase();
  const catalogCategoryId: PredictionCategoryId =
    categoryId === "watchlist" ? "all" : categoryId;
  const polymarketBrowseKey = useMemo(
    () => buildPredictionCatalogCacheKey("polymarket", catalogCategoryId, "", browseTab),
    [browseTab, catalogCategoryId],
  );
  const kalshiBrowseKey = useMemo(
    () => buildPredictionCatalogCacheKey("kalshi", catalogCategoryId, "", browseTab),
    [browseTab, catalogCategoryId],
  );
  const polymarketSearchKey = useMemo(
    () =>
      normalizedSearchQuery
        ? buildPredictionCatalogCacheKey(
            "polymarket",
            catalogCategoryId,
            debouncedSearchQuery,
            browseTab,
          )
        : null,
    [browseTab, catalogCategoryId, debouncedSearchQuery, normalizedSearchQuery],
  );
  const kalshiSearchKey = useMemo(
    () =>
      normalizedSearchQuery
        ? buildPredictionCatalogCacheKey(
            "kalshi",
            catalogCategoryId,
            debouncedSearchQuery,
            browseTab,
          )
        : null,
    [browseTab, catalogCategoryId, debouncedSearchQuery, normalizedSearchQuery],
  );
  const polymarketBrowseResourceKey = useMemo(
    () =>
      buildPredictionCatalogResourceKey("polymarket", catalogCategoryId, "", browseTab),
    [browseTab, catalogCategoryId],
  );
  const kalshiBrowseResourceKey = useMemo(
    () => buildPredictionCatalogResourceKey("kalshi", catalogCategoryId, "", browseTab),
    [browseTab, catalogCategoryId],
  );
  const polymarketSearchResourceKey = useMemo(
    () =>
      normalizedSearchQuery
        ? buildPredictionCatalogResourceKey(
            "polymarket",
            catalogCategoryId,
            normalizedSearchQuery,
            browseTab,
          )
        : null,
    [browseTab, catalogCategoryId, normalizedSearchQuery],
  );
  const kalshiSearchResourceKey = useMemo(
    () =>
      normalizedSearchQuery
        ? buildPredictionCatalogResourceKey(
            "kalshi",
            catalogCategoryId,
            normalizedSearchQuery,
            browseTab,
          )
        : null,
    [browseTab, catalogCategoryId, normalizedSearchQuery],
  );

  const polymarketBrowse = readCatalogSlice(
    catalogCache,
    polymarketBrowseKey,
    polymarketBrowseResourceKey,
  );
  const kalshiBrowse = readCatalogSlice(
    catalogCache,
    kalshiBrowseKey,
    kalshiBrowseResourceKey,
  );
  const polymarketSearch =
    polymarketSearchKey && polymarketSearchResourceKey
      ? readCatalogSlice(
          catalogCache,
          polymarketSearchKey,
          polymarketSearchResourceKey,
        )
      : [];
  const kalshiSearch =
    kalshiSearchKey && kalshiSearchResourceKey
      ? readCatalogSlice(catalogCache, kalshiSearchKey, kalshiSearchResourceKey)
      : [];

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
        if (!search.trim() && !options?.firstPageOnly) {
          setPolymarketNextOffset(nextPolymarketCatalogOffset(category, search));
        }
        setCatalogLastRefreshAt(Date.now());
      } catch (error) {
        setCatalogErrors((current) =>
          updatePredictionErrorState(
            current,
            cacheKey,
            formatPredictionLoadError("polymarket", "markets", error),
          ),
        );
      } finally {
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
        if (!search.trim() && !options?.firstPageOnly) {
          setKalshiNextCursor(kalshiCatalogCursor(search, category));
        }
        setCatalogLastRefreshAt(Date.now());
      } catch (error) {
        setCatalogErrors((current) =>
          updatePredictionErrorState(
            current,
            cacheKey,
            formatPredictionLoadError("kalshi", "markets", error),
          ),
        );
      } finally {
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

  useEffect(() => {
    if (!includePolymarket) return;
    let cancelled = false;
    let waiting = false;
    const cancelStartup = runAfterStartupBackground(() => {
      void loadPolymarket(polymarketBrowseKey, "", catalogCategoryId, {
        firstPageOnly: true,
      });
    });
    const tick = () => {
      if (cancelled) return;
      if (shouldYieldToUi()) {
        if (waiting) return;
        waiting = true;
        void whenUiQuiet().then(() => {
          waiting = false;
          tick();
        });
        return;
      }
      void loadPolymarket(polymarketBrowseKey, "", catalogCategoryId, {
        firstPageOnly: true,
      });
    };
    const intervalId = setInterval(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      cancelStartup();
      clearInterval(intervalId);
    };
  }, [catalogCategoryId, includePolymarket, loadPolymarket, pollIntervalMs, polymarketBrowseKey]);

  useEffect(() => {
    if (!includeKalshi) return;
    let cancelled = false;
    let waiting = false;
    const cancelStartup = runAfterStartupBackground(() => {
      void loadKalshi(kalshiBrowseKey, "", catalogCategoryId, {
        firstPageOnly: true,
      });
    });
    const tick = () => {
      if (cancelled) return;
      if (shouldYieldToUi()) {
        if (waiting) return;
        waiting = true;
        void whenUiQuiet().then(() => {
          waiting = false;
          tick();
        });
        return;
      }
      void loadKalshi(kalshiBrowseKey, "", catalogCategoryId, {
        firstPageOnly: true,
      });
    };
    const intervalId = setInterval(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      cancelStartup();
      clearInterval(intervalId);
    };
  }, [catalogCategoryId, includeKalshi, kalshiBrowseKey, loadKalshi, pollIntervalMs]);

  useEffect(() => {
    if (!includePolymarket || !polymarketSearchKey || !normalizedSearchQuery) {
      return;
    }
    void loadPolymarket(polymarketSearchKey, debouncedSearchQuery, catalogCategoryId);
  }, [
    catalogCategoryId,
    debouncedSearchQuery,
    includePolymarket,
    loadPolymarket,
    normalizedSearchQuery,
    polymarketSearchKey,
  ]);

  useEffect(() => {
    if (!includeKalshi || !kalshiSearchKey || !normalizedSearchQuery) {
      return;
    }
    void loadKalshi(kalshiSearchKey, debouncedSearchQuery, catalogCategoryId);
  }, [
    catalogCategoryId,
    debouncedSearchQuery,
    includeKalshi,
    kalshiSearchKey,
    loadKalshi,
    normalizedSearchQuery,
  ]);

  const refreshCatalog = useCallback(() => {
    if (includePolymarket) {
      void loadPolymarket(polymarketBrowseKey, "", catalogCategoryId, {
        showPending: true,
        force: true,
        firstPageOnly: true,
      });
      if (polymarketSearchKey && normalizedSearchQuery) {
        void loadPolymarket(
          polymarketSearchKey,
          debouncedSearchQuery,
          catalogCategoryId,
          { force: true },
        );
      }
    }
    if (includeKalshi) {
      void loadKalshi(kalshiBrowseKey, "", catalogCategoryId, {
        showPending: true,
        force: true,
        firstPageOnly: true,
      });
      if (kalshiSearchKey && normalizedSearchQuery) {
        void loadKalshi(kalshiSearchKey, debouncedSearchQuery, catalogCategoryId, {
          force: true,
        });
      }
    }
  }, [
    catalogCategoryId,
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
          catalogCategoryId,
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
          catalogCategoryId,
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
    catalogCategoryId,
    includeKalshi,
    includePolymarket,
    kalshiBrowseKey,
    kalshiNextCursor,
    loadingMore,
    polymarketBrowseKey,
    polymarketNextOffset,
  ]);

  return {
    allMarkets,
    catalogHasMore: (includePolymarket && polymarketNextOffset != null) || (includeKalshi && !!kalshiNextCursor),
    catalogLastRefreshAt,
    catalogLoadCount,
    catalogLoadingMore: loadingMore,
    catalogStatus,
    kalshiFeed,
    debouncedSearchQuery,
    refreshCatalog,
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
