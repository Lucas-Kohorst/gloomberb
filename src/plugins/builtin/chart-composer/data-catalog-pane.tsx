import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, type InputRenderable } from "../../../ui";
import {
  DataTableView,
  InputSearchBar,
  Tabs,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
} from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { openUrl } from "../../../components/ui/external-link";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { usePaneSettingValue } from "../../../state/app/context";
import { encodeSortPreference } from "../../../components/data-table/sort-settings";
import { resolveVisibleColumns } from "../../../components/data-table/column-settings";
import {
  CATALOG_COLUMN_DEFS,
  CATALOG_COLUMN_IDS,
  DEFAULT_CATALOG_SORT,
  getCatalogPaneSettings,
  sortCatalogRows,
  type CatalogColumnId,
  type CatalogSortPreference,
} from "./catalog-settings";
import { usePluginAppActions } from "../../runtime";
import { paneRefreshHint, paneSearchHint, usePaneStatusLinkFooter } from "../shared/pane-footer";
import { PaneTemplateInputStep } from "../../../components/pane-template-wizard";
import { type PromptContext, useDialog } from "../../../ui/dialog";
import {
  CATALOG_FILTERS,
  catalogEmptyCopy,
  catalogExpressionForRow,
  catalogInstrumentMatchesQuery,
  catalogRowUrl,
  catalogRowsForResolvedInstruments,
  catalogRowsFromPredictionHits,
  filterCatalogRows,
  listStaticCatalogInventory,
  looksLikeCatalogTickerQuery,
  type CatalogFilterId,
  type CatalogSeriesRow,
} from "./catalog-inventory";
import {
  resetCatalogPrefetchCaches,
  useCatalogAdjacentIndices,
  useCatalogBenchRows,
  useCatalogPollRows,
} from "./catalog-prefetch";
import { resetCatalogOwidCaches } from "./catalog-owid";
import { useCatalogOwidRows } from "./use-catalog-owid";
import {
  resetCatalogPredictionHitsCache,
  useCatalogUniverse,
  usePredictionMarketHits,
} from "./use-series-catalog";

type CatalogColumn = DataTableColumn & { id: CatalogColumnId };

function nextSortPreference(
  current: CatalogSortPreference,
  columnId: string,
): CatalogSortPreference {
  const typed = columnId as CatalogColumnId;
  if (current.columnId !== typed) return { columnId: typed, direction: "asc" };
  if (current.direction === "asc") return { columnId: typed, direction: "desc" };
  return DEFAULT_CATALOG_SORT;
}

function buildColumns(width: number, columnIds: readonly CatalogColumnId[]): CatalogColumn[] {
  const layout: Record<CatalogColumnId, { label: string; width: number; flex?: boolean }> = {
    series: { label: "SERIES", width: 18, flex: true },
    source: { label: "SOURCE", width: 18 },
    kind: { label: "KIND", width: 12 },
    expression: { label: "G", width: Math.min(28, Math.max(16, Math.floor(width * 0.28))) },
  };
  const visible = resolveVisibleColumns(
    CATALOG_COLUMN_DEFS,
    columnIds,
    CATALOG_COLUMN_IDS,
  ).map((column) => column.id as CatalogColumnId);
  const ids = visible.length > 0 ? visible : [...CATALOG_COLUMN_IDS];
  const flexId = ids.includes("series") ? "series" : ids[0];
  const fixedWidth = ids.filter((id) => id !== flexId).reduce((sum, id) => sum + layout[id]!.width, 0);
  const flexWidth = Math.max(layout[flexId ?? "series"]!.width, width - 2 - ids.length - fixedWidth);
  return ids.map((id) => ({
    id,
    label: layout[id]!.label,
    width: id === flexId ? flexWidth : layout[id]!.width,
    align: "left",
  }));
}

export function DataCatalogPane({ focused, width, height }: PaneProps) {
  const { createPaneFromTemplate } = usePluginAppActions();
  const dialog = useDialog();
  const [seedQuery] = usePaneSettingValue("query", "");
  const [searchQuery, setSearchQuery] = useState(seedQuery);
  const [filter, setFilter] = usePaneSettingValue<CatalogFilterId>("defaultTab", "all");
  const [columnIds] = usePaneSettingValue<unknown>("columnIds", CATALOG_COLUMN_IDS);
  const [sortSetting, setSortSetting] = usePaneSettingValue<unknown>("sort", encodeSortPreference(DEFAULT_CATALOG_SORT));
  const paneSettings = getCatalogPaneSettings({ defaultTab: filter, columnIds, sort: sortSetting });
  const resolvedFilter = paneSettings.defaultTab;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sortPreference = paneSettings.sort;
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const tickerQuery = looksLikeCatalogTickerQuery(searchQuery);
  const { instruments, loading: universeLoading } = useCatalogUniverse(
    tickerQuery ? searchQuery : "",
  );
  const { markets, loading: marketsLoading, error: marketsError } = usePredictionMarketHits(
    true,
    refreshNonce,
  );
  const { rows: benchRows, loading: benchLoading } = useCatalogBenchRows(refreshNonce);
  const { rows: pollRows, loading: pollsLoading } = useCatalogPollRows(refreshNonce);
  const { rows: owidRows, loading: owidLoading } = useCatalogOwidRows(searchQuery, refreshNonce);
  const { indices: adjacentIndices, loading: indicesLoading } = useCatalogAdjacentIndices(
    refreshNonce,
  );
  const liveLoading = marketsLoading || benchLoading || pollsLoading || indicesLoading || owidLoading;
  const predictionError = !marketsLoading && markets.length === 0 ? marketsError : null;
  const emptyCopy = catalogEmptyCopy(
    liveLoading || (tickerQuery && universeLoading),
    searchQuery,
    filter !== "data" ? predictionError : null,
  );

  const rows = useMemo(() => {
    const staticRows = listStaticCatalogInventory(instruments, { adjacentIndices });
    const liveRows = catalogRowsFromPredictionHits(markets);
    const resolvedRows = tickerQuery
      ? catalogRowsForResolvedInstruments(
        instruments.filter((instrument) => catalogInstrumentMatchesQuery(instrument, searchQuery)),
      )
      : [];
    const merged = new Map<string, CatalogSeriesRow>();
    const withoutStaticLive = staticRows.filter((entry) => (
      (benchRows.length === 0 || entry.sourceId !== "benchmark")
      && (pollRows.length === 0 || entry.sourceId !== "poll")
    ));
    for (const entry of [...liveRows, ...benchRows, ...pollRows, ...owidRows, ...resolvedRows, ...withoutStaticLive]) {
      if (!merged.has(entry.id)) merged.set(entry.id, entry);
    }
    const filtered = filterCatalogRows([...merged.values()], resolvedFilter, searchQuery);
    return sortCatalogRows(filtered, sortPreference);
  }, [adjacentIndices, benchRows, resolvedFilter, instruments, markets, owidRows, pollRows, searchQuery, sortPreference, tickerQuery]);

  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const selectedUrl = selectedRow ? catalogRowUrl(selectedRow) : null;
  const footerSource = selectedRow?.source;

  const columns = useMemo(() => buildColumns(width, paneSettings.columnIds), [paneSettings.columnIds, width]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((token) => token + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const chartSelected = useCallback(async (row: CatalogSeriesRow | null) => {
    if (!row) return;
    if (row.needsEntity) {
      const entity = await dialog.prompt<string>({
        closeOnClickOutside: true,
        content: (context: PromptContext<string>) => (
          <PaneTemplateInputStep
            {...context}
            step={{
              key: "entity",
              label: `Chart ${row.label}`,
              placeholder: "USA",
              type: "text",
              body: [`Enter an ISO alpha-3 or OWID entity code to chart ${row.label} (e.g. USA, OWID_WRL).`],
            }}
          />
        ),
      }).catch(() => undefined);
      const expression = catalogExpressionForRow(row, entity);
      if (!expression) return;
      createPaneFromTemplate("chart-composer-pane", { arg: expression });
      return;
    }
    if (row.needsTicker) {
      const option = row.sourceId === "option";
      const ticker = await dialog.prompt<string>({
        closeOnClickOutside: true,
        content: (context: PromptContext<string>) => (
          <PaneTemplateInputStep
            {...context}
            step={{
              key: "ticker",
              label: `Chart ${row.label}`,
              placeholder: option ? "AAPL 260618C00200000" : "AAPL",
              type: "text",
              body: [option
                ? `Enter an option symbol to chart ${row.label}.`
                : `Enter a ticker to chart ${row.label}.`],
            }}
          />
        ),
      }).catch(() => undefined);
      const expression = catalogExpressionForRow(row, ticker);
      if (!expression) return;
      createPaneFromTemplate("chart-composer-pane", { arg: expression });
      return;
    }
    createPaneFromTemplate("chart-composer-pane", { arg: row.expression });
  }, [createPaneFromTemplate, dialog]);

  const openSelected = useCallback(() => {
    if (!selectedUrl) return;
    openUrl(selectedUrl);
  }, [selectedUrl]);

  const refreshCatalog = useCallback(() => {
    if (liveLoading) return;
    resetCatalogPrefetchCaches();
    resetCatalogPredictionHitsCache();
    resetCatalogOwidCaches();
    setRefreshNonce((nonce) => nonce + 1);
  }, [liveLoading]);

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "/")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !searchFocused });

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "g") && selectedRow) {
      event.preventDefault?.();
      event.stopPropagation?.();
      chartSelected(selectedRow);
    }
  }, { enabled: focused && !searchFocused && !!selectedRow });

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "o") && selectedUrl) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
    }
  }, { enabled: focused && !searchFocused && !!selectedUrl });

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refreshCatalog();
    }
  }, { enabled: focused && !searchFocused });

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    if (event.name === "g" && selectedRow) {
      event.preventDefault?.();
      event.stopPropagation?.();
      chartSelected(selectedRow);
      return true;
    }
    if (event.name === "o" && selectedUrl) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
      return true;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refreshCatalog();
      return true;
    }
    return false;
  }, [chartSelected, focusSearch, openSelected, refreshCatalog, selectedRow, selectedUrl]);

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    return handleTableKeyDown(event);
  }, [focusSearch, handleTableKeyDown]);

  const renderCell = useCallback((
    row: CatalogSeriesRow,
    column: CatalogColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "series":
        return { text: row.label, color: selectedColor ?? colors.textBright };
      case "source":
        return { text: row.source, color: selectedColor ?? colors.textMuted };
      case "kind":
        return { text: row.kind, color: selectedColor ?? colors.textDim };
      case "expression":
        return { text: row.expression, color: selectedColor ?? colors.text };
    }
  }, []);

  usePaneStatusLinkFooter({
    registrationId: "data-catalog",
    focused,
    url: selectedUrl,
    source: footerSource,
    label: "source",
    loading: liveLoading,
    error: predictionError,
    hints: [
      { id: "graph", key: "g", label: "raph", onPress: () => chartSelected(selectedRow), disabled: !selectedRow },
      paneSearchHint(focusSearch),
      paneRefreshHint(refreshCatalog, { disabled: liveLoading }),
    ],
    showOpenHint: !!selectedUrl,
  });

  const tabs = useMemo(
    () => CATALOG_FILTERS.map((entry) => ({ label: entry.label, value: entry.id })),
    [],
  );

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableView<CatalogSeriesRow, CatalogColumn>
        focused={focused && !searchFocused}
        rootBefore={(
          <Box flexDirection="column">
            <InputSearchBar
              value={searchQuery}
              focused={focused}
              active={searchFocused}
              width={width}
              focusToken={searchFocusToken}
              inputRef={searchInputRef}
              placeholder="series, source, or expression"
              debounceMs={80}
              onFocus={focusSearch}
              onBlur={blurSearch}
              onNavigateDown={blurSearch}
              onQueryChange={setSearchQuery}
            />
            <Tabs
              tabs={tabs}
              activeValue={resolvedFilter}
              onSelect={(value) => setFilter(value as CatalogFilterId)}
              focused={focused && !searchFocused}
              compact
            />
          </Box>
        )}
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        onRootKeyDown={handleRootKeyDown}
        columns={columns}
        items={rows}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={(columnId) => setSortSetting(encodeSortPreference(nextSortPreference(sortPreference, columnId)))}
        getItemKey={(row) => row.id}
        onActivate={chartSelected}
        renderCell={renderCell}
        emptyStateTitle={emptyCopy.title}
        emptyStateHint={emptyCopy.hint}
      />
    </Box>
  );
}
