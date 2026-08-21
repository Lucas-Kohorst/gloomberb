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
import { isPlainKey } from "../../../utils/keyboard";
import type { PaneProps } from "../../../types/plugin";
import { usePluginAppActions, usePluginPaneState } from "../../runtime";
import { loadCorporateYields } from "./fred-yields";
import {
  BOND_SEARCH_PANE_ID,
  buildYieldColumns,
  formatSpreadBp,
  formatYieldDate,
  formatYieldPercent,
  nextSort,
  sortedYields,
  type SortDirection,
  type YieldColumnDef,
  type YieldColumnId,
} from "./model";
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

export function BondSearchPane({ focused, width, height }: PaneProps) {
  const [activeTab, setActiveTab] = usePluginPaneState<BondTab>("activeTab", "yields");
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

  // Search bar (Phase 2 — present but not wired to a live bond search backend).
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const fetchGenRef = useRef(0);

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

  const rows = useMemo(() => sortedYields(entries, sort), [entries, sort]);
  const columns = useMemo<YieldColumnDef[]>(() => buildYieldColumns(width), [width]);
  const selectedEntry = rows[selectedIdx] ?? null;
  const chartSelected = useCallback(() => {
    if (!selectedEntry) return;
    createPaneFromTemplate("chart-composer-pane", { arg: `FRED:${selectedEntry.seriesId}` });
  }, [createPaneFromTemplate, selectedEntry]);

  // Keep selection in range when rows change.
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
    setSearchQuery("");
  }, [setActiveTab]);

  const handleRootKeyDown = useCallback(
    (event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
      if (event.name === "r") {
        event.preventDefault?.();
        event.stopPropagation?.();
        load(true);
        return true;
      }
      if (event.name === "g" && selectedEntry) {
        event.preventDefault?.();
        event.stopPropagation?.();
        chartSelected();
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
    [activeTab, chartSelected, focusSearch, load, selectedEntry],
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
      const info = [
        ...(lastUpdated
          ? [{ id: "asof", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
          : []),
        ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
        ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
      ];
      const hints = [
        { id: "graph", key: "g", label: "raph", onPress: chartSelected, disabled: !selectedEntry },
        { id: "refresh", key: "r", label: "efresh", onPress: () => load(true) },
        ...(activeTab === "search"
          ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }]
          : []),
      ];
      return { info, hints };
    },
    [activeTab, chartSelected, error, focusSearch, focused, lastUpdated, load, selectedEntry, status, updatedAgo],
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
        placeholder="issuer or CUSIP"
        debounceMs={120}
        onFocus={focusSearch}
        onBlur={blurSearch}
        onNavigateDown={blurSearch}
        onQueryChange={setSearchQuery}
      />
    );
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box paddingX={1} marginTop={0}>
          {searchBar}
        </Box>
        <Box flexGrow={1} padding={1}>
          <EmptyState
            title="Bond search coming soon"
            hint="Corporate yield indices are available on the Yields tab."
          />
        </Box>
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

// Re-exported for callers that want the latest update date label.
export { formatYieldDate };
