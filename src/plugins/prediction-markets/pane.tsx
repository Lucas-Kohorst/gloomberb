import { Box, TextAttributes, useUiHost } from "../../ui";
import { useCallback, useMemo, useRef } from "react";
import { useAppSelector } from "../../state/app/context";
import { useNumberFlashMap } from "../../components/quote-flash";
import {
  DataTableStackView,
  EmptyState,
  InputSearchBar,
  PaneListChrome,
  Spinner,
  Tabs,
  loadingText,
  usePaneFooter,
  useTableLoadMore,
  useUpdatedAgo,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
} from "../../components";
import { openUrl } from "../../components/ui/external-link";
import { useShortcut } from "../../react/input";
import { useGraphChartPopOut } from "../builtin/shared/graph-pop-out";
import { createRowValueCache } from "../../components/ui/row-value-cache";
import type { PaneProps } from "../../types/plugin";
import { colors } from "../../theme/colors";
import { PANE_SECTION_GAP_PX } from "../../theme/spacing";
import { usePredictionMarketsController } from "./controller";
import { PredictionMarketDetailPane } from "./detail/pane";
import { resolvePredictionDetailTitle } from "./detail/shared";
import { createPredictionColumns } from "./columns";
import { getPredictionColumnValue } from "./metrics";
import {
  buildPredictionListRowRevision,
  predictionChartExpression,
  resolvePredictionGraphMarket,
} from "./rows";
import { PREDICTION_FILTER_TABS, VENUE_TABS, resolvePredictionFilterId } from "./navigation";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../utils/search-focus-navigation";
import { paneDelayedStatus, paneLiveStatus, paneSearchHint, paneShareHint } from "../builtin/shared/pane-footer";
import { useShareTable } from "../builtin/shared/use-share-table";
import type {
  PredictionColumnDef,
  PredictionListRow,
} from "./types";

const PREDICTION_CELL_CACHE_SIZE = 12_000;
const RELATIVE_TIME_CELL_BUCKET_MS = 60_000;

const predictionRowVersions = new WeakMap<object, number>();
let nextPredictionRowVersion = 1;

function predictionRowVersion(row: PredictionListRow): number {
  const existing = predictionRowVersions.get(row);
  if (existing != null) return existing;
  const next = nextPredictionRowVersion;
  nextPredictionRowVersion += 1;
  predictionRowVersions.set(row, next);
  return next;
}

function predictionCellVersion(
  row: PredictionListRow,
  column: PredictionColumnDef,
  watchlisted: boolean,
  relativeTimeBucket: number,
  flash: string,
): string {
  return [
    predictionRowVersion(row),
    column.id,
    watchlisted ? 1 : 0,
    column.id === "ends" || column.id === "updated" ? relativeTimeBucket : 0,
    column.id === "yes" ? `${row.focusYesPrice ?? ""}:${flash}` : "",
  ].join("|");
}

function predictionCatalogEmptyCopy(options: {
  emptyWatchlist: boolean;
  categoryId: string;
  searchQuery: string;
  catalogStatus: { tone: "warning" | "danger"; message: string } | null;
}): { title: string; hint?: string } {
  const query = options.searchQuery.trim();
  if (options.emptyWatchlist) {
    return {
      title: "Nothing in your watchlist.",
      hint: "Star a market with w from All.",
    };
  }
  if (options.catalogStatus?.tone === "danger") {
    return {
      title: "Markets unavailable.",
      hint: `${options.catalogStatus.message} Press r to retry.`,
    };
  }
  if (options.categoryId === "watchlist") {
    return {
      title: "No starred markets matched.",
      hint: "Star a market with w, or search from All.",
    };
  }
  if (query) {
    return {
      title: "No markets matched.",
      hint: "Change the venue, browse tab, or search query.",
    };
  }
  return {
    title: "No markets matched.",
    hint: "Change the venue, browse tab, or search query.",
  };
}

export function PredictionMarketsPane({ focused, width, height }: PaneProps) {
  const controller = usePredictionMarketsController({ focused });
  const cellCacheRef = useRef(
    createRowValueCache<string, ReturnType<typeof getPredictionColumnValue>>(
      PREDICTION_CELL_CACHE_SIZE,
    ),
  );
  const relativeTimeBucket = Math.floor(Date.now() / RELATIVE_TIME_CELL_BUCKET_MS);
  const watchlistedRowKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of controller.visibleRows) {
      if (row.watchMarketKeys.some((marketKey) => controller.watchlistSet.has(marketKey))) {
        keys.add(row.key);
      }
    }
    return keys;
  }, [controller.visibleRows, controller.watchlistSet]);
  const valueFlashingEnabled = useAppSelector((state) => state.config.valueFlashingEnabled);
  const oddsByRow = useMemo(() => {
    const next = new Map<string, number | null>();
    for (const row of controller.visibleRows) {
      next.set(row.key, row.focusYesPrice);
    }
    return next;
  }, [controller.visibleRows]);
  const flashDirections = useNumberFlashMap(oddsByRow, valueFlashingEnabled);
  const catalogStatusColor =
    controller.catalogStatus?.tone === "danger"
      ? colors.negative
      : colors.borderFocused;
  const visibleColumns = useMemo(
    () => createPredictionColumns(width, controller.paneSettings.columnIds, {
      hideVenue: controller.effectiveVenueScope !== "all",
    }),
    [controller.effectiveVenueScope, controller.paneSettings.columnIds, width],
  );
  // An empty watchlist yields zero rows no matter what the catalog returns, so
  // a spinner here would never resolve.
  const emptyWatchlist =
    controller.categoryId === "watchlist" && controller.watchlistSet.size === 0;
  const emptyCopy = predictionCatalogEmptyCopy({
    emptyWatchlist,
    categoryId: controller.categoryId,
    searchQuery: controller.searchQuery,
    catalogStatus: controller.catalogStatus,
  });
  const rowsLoading =
    controller.visibleRows.length === 0 &&
    !emptyWatchlist &&
    (controller.catalogLoadCount > 0 || controller.searchLoading);
  const detailTitle = resolvePredictionDetailTitle({
    detail: controller.detail,
    selectedRow: controller.selectedDetailRow,
    selectedSummary: controller.selectedSummary,
  });
  const marketUrl = controller.selectedSummary?.url || controller.selectedRow?.url || null;
  const openMarket = useCallback(() => {
    if (!marketUrl) return;
    openUrl(marketUrl);
  }, [marketUrl]);
  const popOutChart = useGraphChartPopOut();
  const graphExpression = useMemo(() => {
    const summary = controller.selectedSummary
      ?? resolvePredictionGraphMarket(controller.selectedRow);
    return predictionChartExpression(summary);
  }, [controller.selectedRow, controller.selectedSummary]);
  const graphSelected = useCallback(() => {
    popOutChart(graphExpression);
  }, [graphExpression, popOutChart]);
  const catalogUpdatedAgo = useUpdatedAgo(controller.catalogLastRefreshAt);
  const detailUpdatedAgo = useUpdatedAgo(controller.lastRefreshAt);
  const updatedAgo = controller.detailOpen ? detailUpdatedAgo : catalogUpdatedAgo;
  const liveBook = controller.detailOpen && controller.selectedSummary?.venue === "polymarket";
  const catalogLive = !controller.detailOpen && controller.catalogLive;
  const includeKalshi =
    controller.effectiveVenueScope === "all" || controller.effectiveVenueScope === "kalshi";
  const kalshiDelayed = includeKalshi && controller.kalshiFeed === "delayed";
  const kalshiLive = includeKalshi && controller.kalshiFeed === "live";
  const newsTabOpen = controller.detailOpen && controller.detailTab === "news";
  const shareTable = useShareTable();
  const shareVisibleRows = useCallback(() => {
    const columns = visibleColumns.filter((column) => column.id !== "watch");
    void shareTable({
      title: "Prediction Markets",
      columns: columns.map((column) => ({
        id: column.id,
        label: column.label,
        align: column.align,
        width: column.width,
      })),
      items: controller.visibleRows,
      cell: (row, columnId) => {
        const column = columns.find((entry) => entry.id === columnId);
        if (!column) return "";
        return getPredictionColumnValue(column, row, false);
      },
      rowUrl: (row) => row.url,
      paneTemplateId: "new-prediction-markets-pane",
    });
  }, [controller.visibleRows, shareTable, visibleColumns]);
  useShortcut((event) => {
    if (!focused) return;
    if (event.name === "g" && graphExpression) {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return;
    }
    if (!controller.detailOpen && event.name === "s") {
      event.preventDefault?.();
      event.stopPropagation?.();
      shareVisibleRows();
      return;
    }
    if (newsTabOpen || event.name !== "o" || !marketUrl) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    openMarket();
  }, { enabled: focused && ((!newsTabOpen && !!marketUrl) || !!graphExpression || !controller.detailOpen) });
  usePaneFooter("prediction-markets", () => {
    return {
      info: [
        ...(controller.detailOpen ? [] : controller.searchLoading ? [{ id: "search-loading", parts: [{ text: "searching", tone: "muted" as const }] }] : []),
        ...(controller.detailOpen ? [] : controller.catalogStatus ? [{
          id: "catalog",
          parts: [{ text: controller.catalogStatus.message, tone: controller.catalogStatus.tone === "danger" ? "warning" as const : "muted" as const, color: catalogStatusColor }],
        }] : []),
        ...(liveBook || catalogLive || (!controller.detailOpen && kalshiLive) ? [paneLiveStatus()] : []),
        ...(!liveBook && kalshiDelayed ? [paneDelayedStatus()] : []),
        ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
      ],
      trailingInfo: !controller.detailOpen ? [controller.poll.segment] : [],
      hints: [
        { id: "graph", key: "g", label: "raph", onPress: graphSelected, disabled: !graphExpression },
        ...(!controller.detailOpen ? [
          paneSearchHint(controller.actions.focusSearch),
          { id: "watch", key: "w", label: "atch", onPress: controller.selectedRow ? () => controller.actions.toggleWatchlist(controller.selectedRow!) : undefined, disabled: !controller.selectedRow },
        ] : []),
        ...(!newsTabOpen && marketUrl ? [{ id: "open", key: "o", label: "pen", onPress: openMarket }] : []),
        ...(!controller.detailOpen
          ? [paneShareHint(shareVisibleRows, { disabled: controller.visibleRows.length === 0 })]
          : []),
      ],
    };
  }, [
    catalogStatusColor,
    controller.catalogStatus?.message,
    controller.catalogStatus?.tone,
    controller.catalogLastRefreshAt,
    controller.detailOpen,
    controller.detailTab,
    controller.effectiveVenueScope,
    controller.lastRefreshAt,
    controller.poll.segment,
    controller.searchLoading,
    controller.searchQuery,
    controller.selectedRow?.key,
    controller.selectedSummary?.venue,
    controller.kalshiFeed,
    graphExpression,
    graphSelected,
    kalshiDelayed,
    kalshiLive,
    catalogLive,
    liveBook,
    marketUrl,
    newsTabOpen,
    openMarket,
    shareVisibleRows,
    updatedAgo,
    controller.visibleRows.length,
  ]);

  const isDesktopWeb = useUiHost().kind === "desktop-web";
  const venueTabItems = useMemo(
    () => VENUE_TABS.map((tab) => ({ label: tab.label, value: tab.value })),
    [],
  );
  const filterTabItems = useMemo(
    () => PREDICTION_FILTER_TABS.map((tab) => ({ label: tab.label, value: tab.id })),
    [],
  );
  const activeFilterId = resolvePredictionFilterId(
    controller.categoryId,
    controller.browseTab,
  );
  const chromeFocused = focused && !controller.detailOpen;
  const filterTabsFocused = chromeFocused && !controller.searchFocused;
  const searchWidth = Math.max(18, Math.floor(width * 0.28));
  const searchProps = {
    value: controller.searchQuery,
    active: controller.searchFocused,
    focusToken: controller.searchFocusToken,
    inputRef: controller.searchInputRef,
    placeholder: "search markets",
    debounceMs: 0,
    width: searchWidth,
    onFocus: controller.actions.focusSearch,
    onBlur: controller.actions.blurSearch,
    onNavigateDown: controller.actions.blurSearch,
    onQueryChange: controller.actions.setSearchQuery,
  };
  const filterTabs = (
    <Tabs
      tabs={filterTabItems}
      activeValue={activeFilterId}
      onSelect={(value) =>
        controller.actions.selectFilter(value as (typeof PREDICTION_FILTER_TABS)[number]["id"])
      }
      compact
      variant="bare"
      scrollable={isDesktopWeb}
      focused={filterTabsFocused}
    />
  );
  const browseControls = isDesktopWeb ? (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      style={{ gap: `${PANE_SECTION_GAP_PX}px`, boxSizing: "border-box" }}
      data-gloom-role="prediction-markets-chrome"
    >
      {!controller.paneSettings.hideTabs ? (
        <Box height={1} width={width}>
          <Tabs
            tabs={venueTabItems}
            activeValue={controller.effectiveVenueScope}
            onSelect={controller.actions.setVenue}
            compact
            variant="bare"
            scrollable={false}
            focused={filterTabsFocused}
          />
        </Box>
      ) : null}
      <Box height={1} width={width} paddingX={1}>
        {filterTabs}
      </Box>
      <Box height={1} width={width} paddingX={1}>
        <InputSearchBar
          {...searchProps}
          focused={chromeFocused}
          width={Math.max(18, width - 2)}
        />
      </Box>
    </Box>
  ) : (
    <PaneListChrome
      width={width}
      focused={chromeFocused}
      tabs={controller.paneSettings.hideTabs ? undefined : venueTabItems}
      activeValue={controller.effectiveVenueScope}
      onSelect={controller.actions.setVenue}
      tabCompact
      tabVariant="bare"
      tabScrollable={false}
      search={searchProps}
      trailing={filterTabs}
    />
  );

  const renderCell = useCallback((
    row: PredictionListRow,
    column: PredictionColumnDef,
  ) => {
    const watchlisted = watchlistedRowKeys.has(row.key);
    const flash = column.id === "yes" ? flashDirections.get(row.key) : undefined;
    const value = cellCacheRef.current.get(
      `${row.key}:${column.id}`,
      predictionCellVersion(row, column, watchlisted, relativeTimeBucket, flash ?? ""),
      () => getPredictionColumnValue(column, row, watchlisted),
    );
    if (column.id === "watch") {
      return {
        text: value.text,
        color: value.color,
        onMouseDown: (event: any) => {
          event.preventDefault();
          event.stopPropagation?.();
          controller.actions.toggleWatchlist(row);
        },
      };
    }
    const flashColor = flash === "up"
      ? colors.positive
      : flash === "down"
        ? colors.negative
        : undefined;
    return {
      text: value.text,
      color: flashColor ?? value.color,
      attributes: flash ? TextAttributes.DIM : undefined,
    };
  }, [
    controller.actions.toggleWatchlist,
    flashDirections,
    relativeTimeBucket,
    watchlistedRowKeys,
  ]);

  const getRowRevision = useCallback((row: PredictionListRow) => {
    return buildPredictionListRowRevision(
      row,
      watchlistedRowKeys.has(row.key),
      `${relativeTimeBucket}:${flashDirections.get(row.key) ?? ""}`,
    );
  }, [flashDirections, relativeTimeBucket, watchlistedRowKeys]);

  const onCatalogScroll = useTableLoadMore(
    controller.scrollRef,
    controller.catalogHasMore && !controller.catalogLoadingMore && !controller.detailOpen,
    () => { void controller.actions.loadMoreCatalog(); },
  );

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      controller.actions.focusSearch();
      return true;
    }
    return false;
  }, [controller.actions.focusSearch]);

  const detailContent =
    controller.selectedSummary && controller.selectedDetailRow ? (
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        minHeight={0}
        width={width}
        height={Math.max(height - 1, 1)}
        paddingX={1}
        overflow="hidden"
        backgroundColor={colors.panel}
      >
        <PredictionMarketDetailPane
          detail={controller.detail}
          detailError={controller.detailError}
          detailLoadCount={controller.detailLoadCount}
          detailTab={controller.detailTab}
          detailWidth={Math.max(width - 2, 24)}
          focused={focused && controller.detailOpen}
          height={Math.max(height - 1, 1)}
          historyRange={controller.historyRange}
          onDetailTabChange={controller.actions.setDetailTab}
          onHistoryRangeChange={controller.actions.setHistoryRange}
          onSelectMarket={controller.actions.selectMarket}
          scrollRef={controller.detailScrollRef}
          selectedRow={controller.selectedDetailRow}
          selectedSummary={controller.selectedSummary}
        />
      </Box>
    ) : (
      <Box flexGrow={1} backgroundColor={colors.panel} />
    );

  return (
    <DataTableStackView<PredictionListRow, PredictionColumnDef>
      focused={focused}
      keyboardNavigation={!controller.searchFocused}
      detailOpen={controller.detailOpen && !!controller.selectedSummary}
      onBack={controller.actions.closeDetail}
      detailContent={detailContent}
      detailTitle={detailTitle}
      rootBefore={browseControls}
      rootWidth={width}
      rootHeight={height}
      rootBackgroundColor={colors.panel}
      selection={{
        kind: "id",
        selectedId: controller.selectedRow?.key ?? null,
        getId: (row) => row.key,
        onChange: (key, _row, _index, reason) =>
          controller.actions.setBrowseSelection(key, {
            debounceDetail: reason === "keyboard",
          }),
      }}
      onActivate={(row) =>
        controller.actions.openSelectedRow(row.key)}
      onRootKeyDown={handleRootKeyDown}
      columns={visibleColumns}
      items={controller.visibleRows}
      sortColumnId={controller.sortPreference.columnId}
      sortDirection={controller.sortPreference.direction}
      onHeaderClick={controller.actions.handleSortHeaderClick}
      headerScrollRef={controller.headerScrollRef}
      scrollRef={controller.scrollRef}
      getItemKey={(row) => row.key}
      getRowRevision={getRowRevision}
      virtualize
      onBodyScrollActivity={onCatalogScroll}
      renderCell={renderCell}
      emptyContent={
        rowsLoading ? (
          <Box width="100%" paddingX={1} paddingY={1}>
            <Spinner
              label={
                controller.searchQuery.trim().length > 0
                  ? "Searching markets..."
                  : loadingText("markets")
              }
            />
          </Box>
        ) : (
          <Box width="100%" paddingX={1} paddingY={1}>
            <EmptyState fill={false} title={emptyCopy.title} hint={emptyCopy.hint} />
          </Box>
        )
      }
      emptyStateTitle={emptyCopy.title}
      emptyStateHint={emptyCopy.hint}
    />
  );
}
