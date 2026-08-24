import { useMemo } from "react";
import { measurePerf } from "../../../utils/perf-marks";
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
import { buildPredictionListRows, flattenPredictionListRows } from "../rows";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionDetailTab,
  PredictionHistoryRange,
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
  searchQuery,
  selectedDetailMarketKey,
  selectedRowKey,
  sortPreference,
  watchlistSet,
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
  searchQuery: string;
  selectedDetailMarketKey: string | null;
  selectedRowKey: string | null;
  sortPreference: PredictionSortPreference;
  watchlistSet: Set<string>;
}) {
  const {
    allMarkets,
    catalogHasMore,
    catalogLastRefreshAt,
    catalogLoadCount,
    catalogLoadingMore,
    catalogStatus,
    debouncedSearchQuery,
    refreshCatalog,
    loadMoreCatalog,
    setCatalogCache,
  } = usePredictionCatalogData({
    browseTab,
    categoryId,
    includeKalshi,
    includePolymarket,
    searchQuery,
  });

  const allRows = useMemo(
    () =>
      measurePerf("prediction.rows.build", () => buildPredictionListRows(allMarkets), {
        marketCount: allMarkets.length,
      }),
    [allMarkets],
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
      return flattenPredictionListRows(sorted, expandedGroupKeys);
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
