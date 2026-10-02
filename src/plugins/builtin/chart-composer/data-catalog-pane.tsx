import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  PaneListChrome,
  usePaneListSearch,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
} from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { useOptionalAppSelector, usePaneSettingValue } from "../../../state/app/context";
import { usePluginAppActions } from "../../runtime";
import { paneSearchHint, usePaneStatusLinkFooter } from "../shared/pane-footer";
import { PaneTemplateInputStep } from "../../../components/pane-template-wizard";
import { type PromptContext, useDialog } from "../../../ui/dialog";
import {
  CATALOG_FILTERS,
  CHART_COMPOSER_TEMPLATE_ID,
  DATA_CATALOG_PANE_ID,
  catalogEmptyCopy,
  catalogExpressionForRow,
  catalogInstrumentMatchesQuery,
  catalogRowsForResolvedInstruments,
  filterCatalogRows,
  listStaticCatalogInventory,
  looksLikeCatalogTickerQuery,
  parseCatalogQuery,
  type CatalogFilterId,
  type CatalogSeriesRow,
} from "./catalog-inventory";
import { useCatalogUniverse } from "./use-series-catalog";
import { getSharedRegistry } from "../../registry";

type CatalogColumnId = "series" | "source" | "kind" | "expression";
type CatalogColumn = DataTableColumn & { id: CatalogColumnId };

interface CatalogSortPreference {
  columnId: CatalogColumnId;
  direction: SortDirection;
}

const DEFAULT_SORT: CatalogSortPreference = { columnId: "source", direction: "asc" };
const EMPTY_DISABLED: readonly string[] = [];

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

function buildColumns(): CatalogColumn[] {
  return [
    { id: "series", label: "SERIES", width: 18, align: "left", flexGrow: 1 },
    { id: "source", label: "SOURCE", width: 18, align: "left" },
    { id: "kind", label: "KIND", width: 12, align: "left" },
    { id: "expression", label: "G", width: 16, align: "left" },
  ];
}

export function DataCatalogPane({ focused, width, height }: PaneProps) {
  const { createPaneFromTemplate } = usePluginAppActions();
  const dialog = useDialog();
  const [seedQuery] = usePaneSettingValue("query", "");
  const seededQuery = parseCatalogQuery(seedQuery);
  const [searchQuery, setSearchQuery] = useState(seededQuery.filter ? seededQuery.text : seedQuery);
  const [filter, setFilter] = useState<CatalogFilterId>(seededQuery.filter ?? "all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<CatalogSortPreference>(DEFAULT_SORT);
  const listSearch = usePaneListSearch({
    focused,
    value: searchQuery,
    onQueryChange: setSearchQuery,
    placeholder: "series, source, or expression",
  });
  const { searchFocused } = listSearch;
  const disabledPlugins = useOptionalAppSelector((state) => state.config.disabledPlugins, EMPTY_DISABLED);
  const disabledSources = useOptionalAppSelector((state) => state.config.disabledSources ?? EMPTY_DISABLED, EMPTY_DISABLED);

  const parsedQuery = parseCatalogQuery(searchQuery);
  const activeFilter = parsedQuery.filter ?? filter;
  const lookupQuery = parsedQuery.text;

  useEffect(() => {
    if (parsedQuery.filter) setFilter(parsedQuery.filter);
  }, [parsedQuery.filter]);

  const tickerQuery = looksLikeCatalogTickerQuery(lookupQuery);
  const { instruments, loading: universeLoading } = useCatalogUniverse(
    tickerQuery ? lookupQuery : "",
  );
  const loading = tickerQuery && universeLoading;
  const emptyCopy = catalogEmptyCopy(loading, searchQuery);

  const rows = useMemo(() => {
    const catalogs = getSharedRegistry()?.getAvailableChartSeriesCatalogs() ?? [];
    const staticRows = listStaticCatalogInventory(instruments, catalogs);
    const resolvedRows = tickerQuery
      ? catalogRowsForResolvedInstruments(
        instruments.filter((instrument) => catalogInstrumentMatchesQuery(instrument, lookupQuery)),
      )
      : [];
    const merged = new Map<string, CatalogSeriesRow>();
    for (const entry of [...resolvedRows, ...staticRows]) {
      if (!merged.has(entry.id)) merged.set(entry.id, entry);
    }
    const filtered = filterCatalogRows([...merged.values()], activeFilter, lookupQuery);
    const direction = sortPreference.direction;
    const columnId = sortPreference.columnId;
    return [...filtered].sort((left, right) => (
      compareSortValues(sortValue(columnId, left), sortValue(columnId, right), direction)
      || left.label.localeCompare(right.label)
    ));
  }, [activeFilter, disabledPlugins, disabledSources, instruments, lookupQuery, sortPreference, tickerQuery]);

  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const selectedUrl = selectedRow?.url ?? null;

  const columns = useMemo(() => buildColumns(), []);

  const chartSelected = useCallback(async (row: CatalogSeriesRow | null) => {
    if (!row) return;
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
      createPaneFromTemplate(CHART_COMPOSER_TEMPLATE_ID, { arg: expression });
      return;
    }
    createPaneFromTemplate(CHART_COMPOSER_TEMPLATE_ID, { arg: row.expression });
  }, [createPaneFromTemplate, dialog]);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (listSearch.handleSearchKey(event)) return true;
    if (searchFocused) return false;
    if (event.name === "g" && selectedRow) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void chartSelected(selectedRow);
      return true;
    }
    return false;
  }, [chartSelected, listSearch.handleSearchKey, searchFocused, selectedRow]);

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      listSearch.focusSearch();
      return true;
    }
    return handleTableKeyDown(event);
  }, [handleTableKeyDown, listSearch.focusSearch]);

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
    registrationId: DATA_CATALOG_PANE_ID,
    focused: focused && !searchFocused,
    url: selectedUrl,
    source: selectedUrl ? selectedRow?.source : null,
    label: "source",
    loading,
    hints: [
      {
        id: "graph",
        key: "g",
        label: "raph",
        onPress: () => { void chartSelected(selectedRow); },
        disabled: !selectedRow || searchFocused,
      },
      paneSearchHint(listSearch.focusSearch, { disabled: searchFocused }),
    ],
    showOpenHint: !!selectedUrl && !searchFocused,
  });

  const selectFilter = useCallback((value: string) => {
    const next = value as CatalogFilterId;
    setFilter(next);
    setSearchQuery((current) => {
      const split = parseCatalogQuery(current);
      if (!split.filter) return current;
      if (next === "all" || !split.text) return split.text;
      return `${split.text}:${next}`;
    });
  }, []);

  const tabs = useMemo(
    () => CATALOG_FILTERS.map((entry) => ({ label: entry.label, value: entry.id })),
    [],
  );

  return (
    <DataTableView<CatalogSeriesRow, CatalogColumn>
      focused={focused && !searchFocused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={(
        <PaneListChrome
          width={width}
          focused={focused}
          tabs={tabs}
          activeValue={activeFilter}
          onSelect={selectFilter}
          search={listSearch.search}
        />
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
      emptyStateTitle={emptyCopy.title}
      emptyStateHint={emptyCopy.hint}
    />
  );
}
