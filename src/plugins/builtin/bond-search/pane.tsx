import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, TextAttributes } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import {
  DataTableView,
  EmptyState,
  PaneListChrome,
  Spinner,
  Tabs,
  usePaneFooter,
  usePaneListSearch,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
} from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PaneProps } from "../../../types/plugin";
import { usePaneSettingValue } from "../../../state/app/context";
import {
  useAssetData,
  usePluginAppActions,
  usePluginPaneState,
  usePluginTickerActions,
} from "../../runtime";
import { paneSearchHint } from "../shared/pane-footer";
import { withConnectionRequest } from "../connections/register";
import { graphFooterHint } from "../shared/graph-pop-out";
import { openUrl } from "../../../components/ui/external-link";
import { loadCorporateYields } from "./fred-yields";
import {
  BOND_SEARCH_PANE_ID,
  buildSearchColumns,
  buildYieldColumns,
  formatSpreadValue,
  formatYieldDate,
  formatYieldValue,
  nextColumnSort,
  nextSort,
  searchKindLabel,
  sortedSearchHits,
  sortedYields,
  type SearchColumnId,
  type SearchColumnDef,
  type SortDirection,
  type YieldColumnDef,
  type YieldColumnId,
} from "./model";
import { searchBonds, type BondSearchHit } from "./search";
import type { BondTab, CorporateYieldEntry, LoadStatus } from "./types";

export { BOND_SEARCH_PANE_ID } from "./model";

interface YieldColumn extends DataTableColumn {
  id: YieldColumnId;
}

const TABS: Array<{ value: BondTab; label: string }> = [
  { value: "yields", label: "Yields" },
  { value: "search", label: "Search" },
];

function renderYieldCell(
  entry: CorporateYieldEntry,
  column: YieldColumn,
  _index: number,
  rowState: { selected: boolean },
): DataTableCell {
  const selectedColor = rowState.selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "label":
      return { text: entry.label, color: selectedColor ?? colors.text, attributes: TextAttributes.BOLD };
    case "rating":
      return { text: entry.rating, color: selectedColor ?? colors.textMuted };
    case "maturity":
      return { text: entry.maturityRange, color: selectedColor ?? colors.textDim };
    case "yield":
      return { text: formatYieldValue(entry.yield), color: selectedColor ?? colors.textBright };
    case "spread":
      return {
        text: formatSpreadValue(entry.spreadBp),
        color: selectedColor ?? (entry.spreadBp == null ? colors.textDim : priceColor(entry.spreadBp)),
      };
  }
}

function renderSearchCell(
  hit: BondSearchHit,
  column: SearchColumnDef,
  _index: number,
  rowState: { selected: boolean },
): DataTableCell {
  const selectedColor = rowState.selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "label":
      return { text: hit.label, color: selectedColor ?? colors.text, attributes: TextAttributes.BOLD };
    case "kind":
      return { text: searchKindLabel(hit), color: selectedColor ?? colors.textMuted };
    case "detail":
      return { text: hit.detail, color: selectedColor ?? colors.textDim };
  }
}

export function BondSearchPane({ focused, width, height }: PaneProps) {
  const [seedQuery] = usePaneSettingValue("query", "");
  const [seedTab] = usePaneSettingValue("activeTab", "yields");
  const [activeTab, setActiveTab] = usePluginPaneState<BondTab>(
    "activeTab",
    seedTab === "search" ? "search" : "yields",
  );
  const [entries, setEntries] = useState<CorporateYieldEntry[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ columnId: YieldColumnId; direction: SortDirection }>({
    columnId: "rating",
    direction: "asc",
  });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const { createPaneFromTemplate } = usePluginAppActions();
  const { pinTicker } = usePluginTickerActions();
  const dataProvider = useAssetData();

  const [searchQuery, setSearchQuery] = useState(String(seedQuery ?? ""));
  const listSearch = usePaneListSearch({
    focused: focused && activeTab === "search",
    value: searchQuery,
    onQueryChange: setSearchQuery,
    placeholder: "issuer, CUSIP, or series",
    debounceMs: 120,
  });
  const [searchHits, setSearchHits] = useState<BondSearchHit[]>([]);
  const [searchStatus, setSearchStatus] = useState<LoadStatus>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedHitId, setSelectedHitId] = useState<string | null>(null);
  const [searchSort, setSearchSort] = useState<{ columnId: SearchColumnId; direction: SortDirection } | null>(null);

  const fetchGenRef = useRef(0);
  const searchGenRef = useRef(0);

  const load = useCallback((refresh = false) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setStatus((current) => (current === "loaded" && !refresh ? "loaded" : "loading"));
    setError(null);
    loadCorporateYields(refresh)
      .then((nextEntries) => {
        if (fetchGenRef.current !== gen) return;
        setEntries(nextEntries);
        setLastUpdated(Date.now());
        setStatus("loaded");
      })
      .catch((loadError) => {
        if (fetchGenRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const runSearch = useCallback((query: string) => {
    searchGenRef.current += 1;
    const gen = searchGenRef.current;
    setSearchStatus("loading");
    setSearchError(null);
    const searchInstruments = dataProvider
      ? (nextQuery: string) =>
          withConnectionRequest("yahoo", "bondSearch", () =>
            dataProvider.search(nextQuery, { preferBroker: false }),
          )
      : undefined;
    searchBonds(query, { searchInstruments })
      .then((result) => {
        if (searchGenRef.current !== gen) return;
        setSearchHits(result.hits);
        setSearchError(result.instrumentError ?? null);
        setSearchStatus("loaded");
        setSearchSort(null);
      })
      .catch((loadError) => {
        if (searchGenRef.current !== gen) return;
        setSearchError(loadError instanceof Error ? loadError.message : String(loadError));
        setSearchStatus("error");
      });
  }, [dataProvider]);

  useEffect(() => {
    if (activeTab !== "search") return;
    runSearch(searchQuery);
  }, [activeTab, runSearch, searchQuery]);

  const rows = useMemo(() => sortedYields(entries, sort), [entries, sort]);
  const columns = useMemo<YieldColumnDef[]>(() => buildYieldColumns(), []);
  const searchColumns = useMemo(() => buildSearchColumns(), []);
  const visibleSearchHits = useMemo(
    () => (searchSort ? sortedSearchHits(searchHits, searchSort) : searchHits),
    [searchHits, searchSort],
  );
  const selectedEntry = rows.find((entry) => entry.seriesId === selectedSeriesId) ?? null;
  const selectedHit = visibleSearchHits.find((hit) => hit.id === selectedHitId) ?? null;

  const chartSelected = useCallback(() => {
    if (!selectedEntry) return;
    createPaneFromTemplate("chart-composer-pane", { arg: `FRED:${selectedEntry.seriesId}` });
  }, [createPaneFromTemplate, selectedEntry]);

  const openHit = useCallback((hit: BondSearchHit) => {
    if (hit.kind === "series") {
      createPaneFromTemplate(hit.templateId, { arg: hit.arg });
      return;
    }
    if (!hit.symbol) return;
    pinTicker(hit.symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID, forceNewPane: true });
  }, [createPaneFromTemplate, pinTicker]);

  const openSelectedHit = useCallback(() => {
    if (!selectedHit) return;
    openHit(selectedHit);
  }, [openHit, selectedHit]);

  useEffect(() => {
    if (selectedSeriesId && rows.some((entry) => entry.seriesId === selectedSeriesId)) return;
    setSelectedSeriesId(rows[0]?.seriesId ?? null);
  }, [rows, selectedSeriesId]);

  useEffect(() => {
    if (selectedHitId && visibleSearchHits.some((hit) => hit.id === selectedHitId)) return;
    setSelectedHitId(visibleSearchHits[0]?.id ?? null);
  }, [selectedHitId, visibleSearchHits]);

  const updatedAgo = useUpdatedAgo(lastUpdated);

  const selectTab = useCallback((value: string) => {
    listSearch.blurSearch();
    setActiveTab(value === "search" ? "search" : "yields");
  }, [listSearch.blurSearch, setActiveTab]);

  const handleRootKeyDown = useCallback(
    (event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
      if (activeTab === "search" && listSearch.handleSearchKey(event)) return true;
      if (listSearch.searchFocused) return false;
      if (event.name === "r") {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (activeTab === "search") runSearch(searchQuery);
        else load(true);
        return true;
      }
      if (event.name === "g") {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (activeTab === "search") {
          if (selectedHit?.kind === "series") openHit(selectedHit);
        } else {
          chartSelected();
        }
        return true;
      }
      if (event.name === "o" && activeTab === "yields" && selectedEntry) {
        event.preventDefault?.();
        event.stopPropagation?.();
        openUrl(`https://fred.stlouisfed.org/series/${selectedEntry.seriesId}`);
        return true;
      }
      if (activeTab === "search" && context.selectedIndex <= 0 && isPlainArrowUp(event)) {
        stopSearchFocusNavigation(event);
        listSearch.focusSearch();
        return true;
      }
      return false;
    },
    [
      activeTab,
      chartSelected,
      listSearch.focusSearch,
      listSearch.handleSearchKey,
      listSearch.searchFocused,
      load,
      openHit,
      runSearch,
      searchQuery,
      selectedEntry,
      selectedHit,
    ],
  );

  useShortcut((event) => {
    if (!focused || listSearch.searchFocused) return;
    if (event.name === "1") {
      event.preventDefault?.();
      event.stopPropagation?.();
      selectTab("yields");
    } else if (event.name === "2") {
      event.preventDefault?.();
      event.stopPropagation?.();
      selectTab("search");
    }
  });

  usePaneFooter(
    BOND_SEARCH_PANE_ID,
    () => {
      if (!focused) return null;
      if (activeTab === "search") {
        const info = [
          ...(searchStatus === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
          ...(searchError ? [{ id: "error", parts: [{ text: searchError, tone: "warning" as const }] }] : []),
        ];
        const hints = [
          graphFooterHint(openSelectedHit, selectedHit?.kind === "series" && !listSearch.searchFocused),
          paneSearchHint(listSearch.focusSearch, { disabled: listSearch.searchFocused }),
        ];
        return { info, hints };
      }
      const info = [
        ...(lastUpdated
          ? [{ id: "asof", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
          : []),
        ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
        ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
      ];
      const hints = [
        graphFooterHint(chartSelected, !!selectedEntry),
        ...(selectedEntry ? [{
          id: "open" as const,
          key: "o" as const,
          label: "pen" as const,
          onPress: () => openUrl(`https://fred.stlouisfed.org/series/${selectedEntry.seriesId}`),
        }] : []),
      ];
      return { info, hints };
    },
    [
      activeTab,
      chartSelected,
      error,
      focused,
      lastUpdated,
      listSearch.focusSearch,
      listSearch.searchFocused,
      openSelectedHit,
      searchError,
      searchStatus,
      selectedEntry,
      selectedHit,
      status,
      updatedAgo,
    ],
  );

  const tabs = (
    <Box height={1}>
      <Tabs
        tabs={TABS}
        activeValue={activeTab}
        onSelect={selectTab}
        compact
        variant="pill"
        focused={focused && !listSearch.searchFocused}
      />
    </Box>
  );

  const bodyHeight = Math.max(1, height - 1);

  if (activeTab === "search") {
    const searchBodyHeight = Math.max(1, height - 2);
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <PaneListChrome
          width={width}
          focused={focused}
          search={listSearch.search}
        />
        {searchStatus === "loading" && visibleSearchHits.length === 0 ? (
          <Box flexGrow={1} justifyContent="center" alignItems="center">
            <Spinner label="Searching bonds..." />
          </Box>
        ) : (
          <DataTableView<BondSearchHit, SearchColumnDef>
            focused={focused && !listSearch.searchFocused}
            rootWidth={width}
            rootHeight={searchBodyHeight}
            selection={{
              kind: "id",
              selectedId: selectedHitId,
              getId: (hit) => hit.id,
              onChange: (id) => setSelectedHitId(id),
            }}
            onActivate={(hit) => openHit(hit)}
            onRootKeyDown={handleRootKeyDown}
            columns={searchColumns}
            items={visibleSearchHits}
            sortColumnId={searchSort?.columnId ?? null}
            sortDirection={searchSort?.direction ?? "asc"}
            onHeaderClick={(columnId) =>
              setSearchSort((current) => {
                const id = columnId as SearchColumnId;
                if (!current) return { columnId: id, direction: "asc" as const };
                return nextColumnSort(current, id, "asc");
              })
            }
            getItemKey={(hit) => hit.id}
            renderCell={renderSearchCell}
            emptyStateTitle={searchQuery.trim() ? "No matching bonds." : "No bond series."}
            emptyStateHint={searchQuery.trim() ? "Try an issuer, CUSIP, or series id." : "Type to search live instruments."}
          />
        )}
      </Box>
    );
  }

  if (status === "loading" && entries.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading corporate yields..." />
        </Box>
      </Box>
    );
  }

  if (error && entries.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box padding={1}>
          <EmptyState title="Corporate yields unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      <DataTableView<CorporateYieldEntry, YieldColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={bodyHeight}
        selection={{
          kind: "id",
          selectedId: selectedSeriesId,
          getId: (entry) => entry.seriesId,
          onChange: (id) => setSelectedSeriesId(id),
        }}
        onActivate={() => chartSelected()}
        onRootKeyDown={handleRootKeyDown}
        columns={columns}
        items={rows}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(columnId) =>
          setSort((current) =>
            nextSort(current, columnId as YieldColumnId, columnId === "label" ? "asc" : "asc"),
          )
        }
        getItemKey={(entry) => entry.seriesId}
        renderCell={renderYieldCell}
        emptyStateTitle="No corporate yield data."
        emptyStateHint="Press r to refresh."
      />
    </Box>
  );
}

export { formatYieldDate };
