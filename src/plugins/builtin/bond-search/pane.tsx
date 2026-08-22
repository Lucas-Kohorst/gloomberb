import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import {
  DataTableView,
  EmptyState,
  InputSearchBar,
  Spinner,
  Tabs,
  usePaneFooter,
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
import { withConnectionRequest } from "../connections/register";
import { graphFooterHint } from "../shared/graph-pop-out";
import { loadCorporateYields } from "./fred-yields";
import {
  BOND_SEARCH_PANE_ID,
  buildSearchColumns,
  buildYieldColumns,
  formatSpreadBp,
  formatYieldDate,
  formatYieldPercent,
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
      return { text: formatYieldPercent(entry.yield), color: selectedColor ?? colors.textBright };
    case "spread":
      return {
        text: formatSpreadBp(entry.spreadBp),
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
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sort, setSort] = useState<{ columnId: YieldColumnId; direction: SortDirection }>({
    columnId: "rating",
    direction: "asc",
  });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const { createPaneFromTemplate } = usePluginAppActions();
  const { pinTicker } = usePluginTickerActions();
  const dataProvider = useAssetData();

  const [searchQuery, setSearchQuery] = useState(String(seedQuery ?? ""));
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [searchHits, setSearchHits] = useState<BondSearchHit[]>([]);
  const [searchStatus, setSearchStatus] = useState<LoadStatus>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchSelectedIdx, setSearchSelectedIdx] = useState(0);
  const [searchSort, setSearchSort] = useState<{ columnId: SearchColumnId; direction: SortDirection } | null>(null);
  const searchInputRef = useRef<InputRenderable | null>(null);

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
        setSearchSelectedIdx(0);
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
  const columns = useMemo<YieldColumnDef[]>(() => buildYieldColumns(width), [width]);
  const searchColumns = useMemo(() => buildSearchColumns(width), [width]);
  const visibleSearchHits = useMemo(
    () => (searchSort ? sortedSearchHits(searchHits, searchSort) : searchHits),
    [searchHits, searchSort],
  );
  const selectedEntry = rows[selectedIdx] ?? null;
  const selectedHit = visibleSearchHits[searchSelectedIdx] ?? null;

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
    if (rows.length === 0) {
      if (selectedIdx !== 0) setSelectedIdx(0);
      return;
    }
    if (selectedIdx >= rows.length) setSelectedIdx(0);
  }, [rows.length, selectedIdx]);

  const updatedAgo = useUpdatedAgo(lastUpdated);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const selectTab = useCallback((value: string) => {
    setActiveTab(value === "search" ? "search" : "yields");
  }, [setActiveTab]);

  const handleRootKeyDown = useCallback(
    (event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
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
      if (activeTab === "search") {
        if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
          stopSearchFocusNavigation(event);
          focusSearch();
          return true;
        }
        if (event.name === "s" || event.name === "/") {
          event.preventDefault?.();
          event.stopPropagation?.();
          focusSearch();
          return true;
        }
      }
      return false;
    },
    [activeTab, chartSelected, focusSearch, load, openHit, runSearch, searchQuery, selectedHit],
  );

  useShortcut((event) => {
    if (!focused || searchFocused) return;
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
          graphFooterHint(openSelectedHit, selectedHit?.kind === "series"),
          { id: "refresh", key: "r", label: "efresh", onPress: () => runSearch(searchQuery) },
          { id: "search", key: "/", label: "search", onPress: focusSearch },
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
        { id: "refresh", key: "r", label: "efresh", onPress: () => load(true) },
      ];
      return { info, hints };
    },
    [
      activeTab,
      chartSelected,
      error,
      focusSearch,
      focused,
      lastUpdated,
      load,
      openSelectedHit,
      runSearch,
      searchError,
      searchQuery,
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
        focused={focused && !searchFocused}
      />
    </Box>
  );

  const bodyHeight = Math.max(1, height - 1);

  if (activeTab === "search") {
    const searchBar = (
      <InputSearchBar
        value={searchQuery}
        focused={focused}
        active={searchFocused}
        width={width}
        focusToken={searchFocusToken}
        inputRef={searchInputRef}
        placeholder="issuer, CUSIP, or series"
        debounceMs={120}
        onFocus={focusSearch}
        onBlur={blurSearch}
        onNavigateDown={blurSearch}
        onQueryChange={setSearchQuery}
      />
    );
    const searchBodyHeight = Math.max(1, height - 2);
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        {searchBar}
        {searchStatus === "loading" && visibleSearchHits.length === 0 ? (
          <Box flexGrow={1} justifyContent="center" alignItems="center">
            <Spinner label="Searching bonds..." />
          </Box>
        ) : (
          <DataTableView<BondSearchHit, SearchColumnDef>
            focused={focused && !searchFocused}
            rootWidth={width}
            rootHeight={searchBodyHeight}
            selection={{
              kind: "index",
              selectedIndex: searchSelectedIdx,
              onChange: (index) => setSearchSelectedIdx(index),
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
                if (!current) return { columnId: id, direction: "asc" };
                return nextSort(current, id, "asc");
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
        focused={focused && !searchFocused}
        rootWidth={width}
        rootHeight={bodyHeight}
        selection={{
          kind: "index",
          selectedIndex: selectedIdx,
          onChange: (index) => setSelectedIdx(index),
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
        getItemKey={(entry, index) => `${entry.seriesId}-${index}`}
        renderCell={renderYieldCell}
        emptyStateTitle="No corporate yield data."
        emptyStateHint="Press r to refresh."
      />
    </Box>
  );
}

export { formatYieldDate };
