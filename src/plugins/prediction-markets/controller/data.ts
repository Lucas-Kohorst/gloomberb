import { useMemo } from "react";
import { measurePerf } from "../../../utils/perf-marks";
import { PREDICTION_CATALOG_PAINT_HEAD } from "../cache";
import { usePredictionCatalogData } from "./catalog";
import { usePredictionDetailData } from "./detail";
import {
  buildPredictionVisibleRowLookup,
  resolvePredictionSelectedRowState,
  resolvePredictionSelectedSummary,
} from "./selection";
import {
  filterPredictionMarkets,
  getDefaultPredictionSort,
  sortPredictionMarkets,
} from "../metrics";
import { sortPredictionOutcomeMarkets } from "../outcome-order";
import { isLivePredictionDetailTab } from "../navigation";
import { resolveWatchlistMarkets } from "../collection-watchlist";
import { buildPredictionListRows, flattenPredictionListRows } from "../rows";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionDetailTab,
  PredictionHistoryRange,
  PredictionMarketSummary,
  PredictionSortPreference,
  PredictionVenueScope,
} from "../types";

export function usePredictionMarketsDataState({
  browseTab,
  categoryId,
  detailOpen,
  detailTab,
  effectiveVenueScope,
  focused,
  historyRange,
  includeKalshi,
  includePolymarket,
  pollIntervalMs,
  searchQuery,
  selectedDetailMarketKey,
  selectedRowKey,
  sortPreference,
  watchlistSet,
  watchlistSnapshots,
  expandedGroupKeys,
}: {
  browseTab: PredictionBrowseTab;
  categoryId: PredictionCategoryId;
  detailOpen: boolean;
  detailTab: PredictionDetailTab;
  effectiveVenueScope: PredictionVenueScope;
  expandedGroupKeys: ReadonlySet<string>;
  focused: boolean;
  historyRange: PredictionHistoryRange;
  includeKalshi: boolean;
  includePolymarket: boolean;
  pollIntervalMs: number;
  searchQuery: string;
  selectedDetailMarketKey: string | null;
  selectedRowKey: string | null;
  sortPreference: PredictionSortPreference;
  watchlistSet: Set<string>;
  watchlistSnapshots: PredictionMarketSummary[];
}) {
  const {
    allMarkets,
    catalogHasMore,
    catalogLastRefreshAt,
    catalogLoadCount,
    catalogLoadingMore,
    catalogStatus,
    kalshiFeed,
    debouncedSearchQuery,
    refreshCatalog,
    loadMoreCatalog,
    setCatalogCache,
  } = usePredictionCatalogData({
    browseTab,
    categoryId,
    includeKalshi,
    includePolymarket,
    pollIntervalMs,
    searchQuery,
  });

  const listMarkets = useMemo(() => {
    if (categoryId !== "watchlist") return allMarkets;
    const resolved = resolveWatchlistMarkets(
      allMarkets,
      watchlistSnapshots,
      watchlistSet,
    );
    if (resolved.length === 0) return resolved;
    const eventKeys = new Set<string>();
    for (const market of resolved) {
      if (market.venue === "polymarket" && market.eventId) {
        eventKeys.add(`polymarket:event:${market.eventId}`);
      } else if (market.venue === "kalshi" && market.eventTicker) {
        eventKeys.add(`kalshi:event:${market.eventTicker}`);
      }
    }
    if (eventKeys.size === 0) return resolved;
    const seen = new Set(resolved.map((market) => market.key));
    const extra: PredictionMarketSummary[] = [];
    for (const market of allMarkets) {
      if (seen.has(market.key)) continue;
      const eventKey =
        market.venue === "polymarket" && market.eventId
          ? `polymarket:event:${market.eventId}`
          : market.venue === "kalshi" && market.eventTicker
            ? `kalshi:event:${market.eventTicker}`
            : null;
      if (!eventKey || !eventKeys.has(eventKey)) continue;
      seen.add(market.key);
      extra.push(market);
    }
    return extra.length === 0 ? resolved : [...resolved, ...extra];
  }, [allMarkets, categoryId, watchlistSet, watchlistSnapshots]);

  const allRows = useMemo(
    () =>
      measurePerf("prediction.rows.build", () => buildPredictionListRows(listMarkets), {
        marketCount: listMarkets.length,
      }),
    [listMarkets],
  );

  const visibleRows = useMemo(() => {
    return measurePerf("prediction.rows.filter-sort", () => {
      const filtered = filterPredictionMarkets(
        allRows,
        effectiveVenueScope,
        categoryId,
        searchQuery,
        watchlistSet,
      );
      const sorted = sortPredictionMarkets(
        filtered,
        sortPreference.columnId
          ? sortPreference
          : getDefaultPredictionSort(browseTab),
      );
      const painted = sorted.length > PREDICTION_CATALOG_PAINT_HEAD
        ? sorted.slice(0, PREDICTION_CATALOG_PAINT_HEAD)
        : sorted;
      return flattenPredictionListRows(painted, expandedGroupKeys);
    }, {
      browseTab,
      categoryId,
      rowCount: allRows.length,
      search: searchQuery.trim(),
      sortColumnId: sortPreference.columnId,
      sortDirection: sortPreference.direction,
      venueScope: effectiveVenueScope,
    });
  }, [
    allRows,
    browseTab,
    categoryId,
    effectiveVenueScope,
    searchQuery,
    expandedGroupKeys,
    sortPreference,
    watchlistSet,
  ]);

  const visibleRowLookup = useMemo(
    () => buildPredictionVisibleRowLookup(visibleRows),
    [visibleRows],
  );

  const selectedRowState = useMemo(
    () => resolvePredictionSelectedRowState(selectedRowKey, visibleRowLookup),
    [selectedRowKey, visibleRowLookup],
  );
  const selectedRow = selectedRowState.row;
  const selectedDetailRow = useMemo(() => {
    if (!selectedRow?.parentKey) return selectedRow;
    return (
      visibleRows.find((candidate) => candidate.key === selectedRow.parentKey) ??
      selectedRow
    );
  }, [selectedRow, visibleRows]);
  const selectedSummary = useMemo(
    () =>
      resolvePredictionSelectedSummary({
        detailOpen,
        selectedDetailMarketKey,
        selectedRow: selectedDetailRow,
      }),
    [detailOpen, selectedDetailMarketKey, selectedDetailRow],
  );
  const selectedSummaryKey = selectedSummary?.key ?? null;
  const selectedIndex = selectedRowState.index;
  const sortedOutcomeMarkets = useMemo(
    () =>
      selectedDetailRow?.kind === "group"
        ? sortPredictionOutcomeMarkets(selectedDetailRow.markets)
        : [],
    [selectedDetailRow],
  );
  const {
    detail,
    detailError,
    detailLoadCount,
    lastRefreshAt,
    transportState,
    actions: detailActions,
  } = usePredictionDetailData({
    focused,
    historyRange,
    pollLiveData: !detailOpen || isLivePredictionDetailTab(detailTab),
    selectedSummary,
    setCatalogCache,
  });

  return {
    catalogHasMore,
    catalogLastRefreshAt,
    catalogLoadCount,
    catalogLoadingMore,
    catalogStatus,
    kalshiFeed,
    debouncedSearchQuery,
    detail,
    detailError,
    detailLoadCount,
    lastRefreshAt,
    loadMoreCatalog,
    selectedIndex,
    selectedRow,
    selectedDetailRow,
    selectedSummary,
    selectedSummaryKey,
    sortedOutcomeMarkets,
    transportState,
    visibleRows,
    actions: {
      refreshCatalog,
      setNextDetailLoadDelay: detailActions.setNextDetailLoadDelay,
    },
  };
}
