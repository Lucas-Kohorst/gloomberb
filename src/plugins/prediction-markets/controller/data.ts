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
import { buildPredictionListRows, expandPredictionListRows } from "../rows";
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
  expandedGroupKey,
}: {
  browseTab: PredictionBrowseTab;
  categoryId: PredictionCategoryId;
  detailOpen: boolean;
  detailTab: PredictionDetailTab;
  effectiveVenueScope: PredictionVenueScope;
  expandedGroupKey: string | null;
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
    catalogLoadCount,
    catalogStatus,
    debouncedSearchQuery,
    refreshCatalog,
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
        browseTab,
        effectiveVenueScope,
        categoryId,
        debouncedSearchQuery,
        watchlistSet,
      );
      const sorted = sortPredictionMarkets(
        filtered,
        sortPreference.columnId
          ? sortPreference
          : getDefaultPredictionSort(browseTab),
      );
      return expandPredictionListRows(sorted, expandedGroupKey);
    }, {
      browseTab,
      categoryId,
      expanded: expandedGroupKey != null,
      rowCount: allRows.length,
      search: debouncedSearchQuery.trim(),
      sortColumnId: sortPreference.columnId,
      sortDirection: sortPreference.direction,
      venueScope: effectiveVenueScope,
    });
  }, [
    allRows,
    browseTab,
    categoryId,
    debouncedSearchQuery,
    effectiveVenueScope,
    expandedGroupKey,
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
  const detailRow = selectedRow?.kind === "strike"
    ? visibleRows.find((row) => row.key === selectedRow.parentKey) ?? selectedRow
    : selectedRow;
  const selectedSummary = useMemo(
    () =>
      resolvePredictionSelectedSummary({
        detailOpen,
        selectedDetailMarketKey,
        selectedRow: detailRow,
      }),
    [detailOpen, detailRow, selectedDetailMarketKey],
  );
  const selectedSummaryKey = selectedSummary?.key ?? null;
  const selectedIndex = selectedRowState.index;
  const sortedOutcomeMarkets = useMemo(
    () =>
      detailRow?.kind === "group"
        ? sortPredictionOutcomeMarkets(detailRow.markets)
        : [],
    [detailRow],
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
    catalogStatus,
    catalogLoadCount,
    debouncedSearchQuery,
    detail,
    detailError,
    detailLoadCount,
    lastRefreshAt,
    selectedIndex,
    selectedRow,
    detailRow,
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
