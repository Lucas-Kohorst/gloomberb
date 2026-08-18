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
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePluginAppActions } from "../../runtime";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import {
  CATALOG_FILTERS,
  catalogRowUrl,
  catalogRowsFromPredictionHits,
  filterCatalogRows,
  listStaticCatalogInventory,
  type CatalogFilterId,
  type CatalogSeriesRow,
} from "./catalog-inventory";
import { usePredictionMarketHits } from "./use-series-catalog";

type CatalogColumnId = "series" | "source" | "kind" | "expression";
type CatalogColumn = DataTableColumn & { id: CatalogColumnId };

interface CatalogSortPreference {
  columnId: CatalogColumnId | null;
  direction: SortDirection;
}

const DEFAULT_SORT: CatalogSortPreference = { columnId: "source", direction: "asc" };
const DEFAULT_INSTRUMENT = { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." };

function nextSortPreference(
  current: CatalogSortPreference,
  columnId: string,
): CatalogSortPreference {
  const typed = columnId as CatalogColumnId;
  if (current.columnId !== typed) return { columnId: typed, direction: "asc" };
  if (current.direction === "asc") return { columnId: typed, direction: "desc" };
  return DEFAULT_SORT;
}

function sortValue(columnId: CatalogColumnId, row: CatalogSeriesRow): string {
  switch (columnId) {
    case "series":
      return row.label;
    case "source":
      return row.source;
    case "kind":
      return row.kind;
    case "expression":
      return row.expression;
  }
}

function buildColumns(width: number): CatalogColumn[] {
  const sourceWidth = 11;
  const kindWidth = 12;
  const expressionWidth = Math.min(28, Math.max(16, Math.floor(width * 0.28)));
  const seriesWidth = Math.max(18, width - 2 - 4 - sourceWidth - kindWidth - expressionWidth);
  return [
    { id: "series", label: "SERIES", width: seriesWidth, align: "left" },
    { id: "source", label: "SOURCE", width: sourceWidth, align: "left" },
    { id: "kind", label: "KIND", width: kindWidth, align: "left" },
    { id: "expression", label: "G", width: expressionWidth, align: "left" },
  ];
}

export function DataCatalogPane({ focused, width, height }: PaneProps) {
  const { createPaneFromTemplate } = usePluginAppActions();
  const [seedQuery] = usePaneSettingValue("query", "");
  const [searchQuery, setSearchQuery] = useState(seedQuery);
  const [filter, setFilter] = useState<CatalogFilterId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<CatalogSortPreference>(DEFAULT_SORT);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const searchMarkets = searchQuery.trim().length >= 3
    && (filter === "all" || filter === "prediction");
  const { markets, loading } = usePredictionMarketHits(searchQuery, searchMarkets);

  const rows = useMemo(() => {
    const staticRows = listStaticCatalogInventory(DEFAULT_INSTRUMENT);
    const liveRows = catalogRowsFromPredictionHits(markets);
    const merged = new Map<string, CatalogSeriesRow>();
    for (const entry of [...liveRows, ...staticRows]) {
      if (!merged.has(entry.id)) merged.set(entry.id, entry);
    }
    const filtered = filterCatalogRows([...merged.values()], filter, searchQuery);
    if (!sortPreference.columnId) return filtered;
    const direction = sortPreference.direction;
    const columnId = sortPreference.columnId;
    return [...filtered].sort((left, right) => (
      compareSortValues(sortValue(columnId, left), sortValue(columnId, right), direction)
      || left.label.localeCompare(right.label)
    ));
  }, [filter, markets, searchQuery, sortPreference]);

  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const selectedUrl = selectedRow ? catalogRowUrl(selectedRow) : null;

  const columns = useMemo(() => buildColumns(width), [width]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((token) => token + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const chartSelected = useCallback((row: CatalogSeriesRow | null) => {
    if (!row) return;
    createPaneFromTemplate("chart-composer-pane", { arg: row.expression });
  }, [createPaneFromTemplate]);

  const openSelected = useCallback(() => {
    if (!selectedUrl) return;
    openUrl(selectedUrl);
  }, [selectedUrl]);

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "s") || isPlainKey(event, "/")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !searchFocused });

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "o") && selectedUrl) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
    }
  }, { enabled: focused && !searchFocused && !!selectedUrl });

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    if (event.name === "o" && selectedUrl) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
      return true;
    }
    return false;
  }, [focusSearch, openSelected, selectedUrl]);

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
    source: selectedRow?.source,
    label: "source",
    loading,
    info: searchQuery.trim()
      ? [{ id: "search", parts: [{ text: `filter: ${searchQuery.trim()}`, tone: "value" }] }]
      : [],
    hints: [
      { id: "search", key: "s", label: "earch", onPress: focusSearch },
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
              activeValue={filter}
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
        onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(current, columnId))}
        getItemKey={(row) => row.id}
        onActivate={chartSelected}
        renderCell={renderCell}
        emptyStateTitle={searchQuery.trim() ? `No series matching "${searchQuery.trim()}"` : "No series"}
        emptyStateHint={loading ? "Searching prediction markets…" : "Press [s] to search."}
      />
    </Box>
  );
}
