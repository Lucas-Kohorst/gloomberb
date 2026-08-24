import { Box, Text, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShortcut } from "../../../react/input";
import {
  DataTableView,
  InputSearchBar,
  Spinner,
  usePaneFooter,
  type DataTableKeyEvent,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { useAssetData, usePluginTickerActions } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PaneProps } from "../../../types/plugin";

import {
  fetchUniverseFundamentals,
  DEFAULT_UNIVERSE,
} from "./client";
import {
  applyFilters,
  parseFilterArgs,
  activeFilterCount,
} from "./filters";
import type { ScreenerFilters, ScreenerResult } from "./types";
import {
  buildScreenerColumns,
  DEFAULT_SORT_PREFERENCE,
  filterScreenerRows,
  nextSortPreference,
  sortRows,
  type ScreenerColumn,
  type ScreenerRow,
  type ScreenerSortPreference,
} from "./model";
import { renderScreenerCell } from "./table";

export function ScreenerPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { pinTicker } = usePluginTickerActions();

  const [filterArgs] = usePaneSettingValue<string>("filterArgs", "");
  const [allResults, setAllResults] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<ScreenerSortPreference>(DEFAULT_SORT_PREFERENCE);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const fetchGenRef = useRef(0);

  const filters = useMemo<ScreenerFilters>(
    () => parseFilterArgs(filterArgs ?? ""),
    [filterArgs],
  );

  const load = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (!dataProvider) return;
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const results = await fetchUniverseFundamentals(dataProvider, DEFAULT_UNIVERSE, options);
      if (fetchGenRef.current !== gen) return;
      setAllResults(results);
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setLoadError(err instanceof Error ? err.message : String(err));
      setAllResults([]);
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, [dataProvider]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load({ forceRefresh: true });
  }, [load]);

  // Apply filters, then search, then sort
  const filteredRows = useMemo(() => {
    const filtered = applyFilters(allResults, filters);
    if (!searchQuery.trim()) return filtered;
    return filterScreenerRows(filtered, searchQuery);
  }, [allResults, filters, searchQuery]);

  const rows = useMemo(
    () => sortRows(filteredRows, sortPreference),
    [filteredRows, sortPreference],
  );

  const columns = useMemo(() => buildScreenerColumns(width), [width]);

  // Keep selection valid
  useEffect(() => {
    if (selectedSymbol && rows.some((r) => r.symbol === selectedSymbol)) return;
    const first = rows[0];
    if (first) setSelectedSymbol(first.symbol);
    else if (selectedSymbol !== null) setSelectedSymbol(null);
  }, [rows, selectedSymbol]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, []);

  const openSymbol = useCallback((symbol: string) => {
    pinTicker(symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
  }, [pinTicker]);

  const activateSearch = useCallback(() => {
    setSearchActive(true);
    setSearchFocusToken((t) => t + 1);
  }, []);

  const deactivateSearch = useCallback(() => {
    setSearchActive(false);
  }, []);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      activateSearch();
      return true;
    }
    return false;
  }, [activateSearch, refresh]);

  // Close search on Escape when search is active
  useShortcut((ev) => {
    if (!focused || !searchActive) return;
    if (ev.name === "escape") {
      ev.preventDefault?.();
      setSearchActive(false);
      setSearchQuery("");
    }
  }, { allowEditable: true, enabled: focused && searchActive });

  const filterCount = activeFilterCount(filters);

  usePaneFooter("fundamental-screener", () => ({
    info: [
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(loadError ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
      ...(filterCount > 0 ? [{
        id: "filters",
        parts: [{ text: `${filterCount} filter${filterCount > 1 ? "s" : ""}`, tone: "muted" as const }],
      }] : []),
    ],
    hints: [
      { id: "search", key: "s", label: "earch", onPress: activateSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
    ],
  }), [activateSearch, filterCount, loadError, loading, refresh]);

  if (loading && allResults.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Loading fundamentals..." />
      </Box>
    );
  }

  if (loadError && allResults.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Text fg={colors.negative}>{loadError}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {searchActive && (
        <Box height={1}>
          <InputSearchBar
            value={searchQuery}
            focused={focused}
            active={searchActive}
            width={width}
            focusToken={searchFocusToken}
            inputRef={searchInputRef}
            placeholder="Filter by symbol, name, or sector..."
            debounceMs={150}
            onFocus={activateSearch}
            onBlur={deactivateSearch}
            onQueryChange={setSearchQuery}
          />
        </Box>
      )}
      <DataTableView<ScreenerRow, ScreenerColumn>
        focused={focused && !searchActive}
        selection={{
          kind: "id",
          selectedId: selectedSymbol,
          getId: (row) => row.symbol,
          onChange: (symbol) => setSelectedSymbol(symbol),
        }}
        onRootKeyDown={handleTableKeyDown}
        columns={columns}
        items={rows}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={handleHeaderClick}
        getItemKey={(row) => row.symbol}
        onActivate={(row) => openSymbol(row.symbol)}
        renderCell={renderScreenerCell}
        emptyStateTitle={
          loading ? "Loading fundamentals..."
            : loadError ?? (filterCount > 0 ? "No matches" : "No data")
        }
        emptyStateHint={
          filterCount > 0 && !loading
            ? "Try relaxing filter criteria."
            : undefined
        }
      />
    </Box>
  );
}
