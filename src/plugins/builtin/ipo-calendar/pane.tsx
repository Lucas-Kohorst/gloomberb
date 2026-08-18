import { Box, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTableView, InputSearchBar, Spinner, type DataTableCell, type DataTableKeyEvent } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import { usePluginTickerActions } from "../../runtime";
import { colors, priceColor } from "../../../theme/colors";
import { openUrl } from "../../../components/ui/external-link";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { fetchIpoCalendar } from "./client";
import type { IPORecord, LoadStatus } from "./types";
import {
  buildColumns,
  formatDate,
  formatOfferSize,
  formatPrice,
  formatReturn,
  formatShares,
  matchesSearch,
  nextSortPreference,
  sortRows,
  statusColor,
  statusLabel,
  type IPOColumn,
  type IPOSortPreference,
  DEFAULT_SORT_PREFERENCE,
} from "./model";

const SEARCH_DEBOUNCE_MS = 250;

export function IPOCalendarPane({ focused, width, height }: PaneProps) {
  const { pinTicker } = usePluginTickerActions();
  const [records, setRecords] = useState<IPORecord[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<IPOSortPreference>(DEFAULT_SORT_PREFERENCE);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const fetchGenRef = useRef(0);

  const load = useCallback(async (force = false) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setStatus("loading");
    setError(null);

    try {
      const data = await fetchIpoCalendar();
      if (fetchGenRef.current !== gen) return;
      setRecords(data);
      setStatus("loaded");
      setLastUpdated(Date.now());
      if (force) setSelectedTicker(null);
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(true));

  const filtered = useMemo(
    () => records.filter((r) => matchesSearch(r, searchQuery)),
    [records, searchQuery],
  );

  const sorted = useMemo(
    () => sortRows(filtered, sortPreference),
    [filtered, sortPreference],
  );

  const columns = useMemo(() => buildColumns(width), [width]);

  useEffect(() => {
    if (selectedTicker && sorted.some((r) => r.ticker === selectedTicker)) return;
    const first = sorted[0];
    if (first) {
      setSelectedTicker(first.ticker);
    } else if (selectedTicker !== null) {
      setSelectedTicker(null);
    }
  }, [sorted, selectedTicker]);

  const loading = status === "loading" && records.length === 0;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((t) => t + 1);
  }, []);

  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const updateSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setSelectedTicker(null);
  }, []);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, []);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch, refresh]);

  const handleActivate = useCallback((record: IPORecord) => {
    if (record.secUrl) {
      openUrl(record.secUrl);
    } else {
      pinTicker(record.ticker, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
    }
  }, [pinTicker]);

  useShortcut((event) => {
    if (!focused || searchFocused) return;
    if (event.targetEditable) return;
    if (isPlainKey(event, "/")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      focusSearch();
    } else if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
    }
  }, { allowEditable: true, enabled: focused });

  const selectedRecord = useMemo(
    () => sorted.find((r) => r.ticker === selectedTicker) ?? null,
    [sorted, selectedTicker],
  );

  usePaneStatusLinkFooter({
    registrationId: "ipo-calendar",
    focused,
    url: status === "error" ? null : selectedRecord?.secUrl,
    source: "S-1",
    label: "filing",
    loading,
    error: status === "error" ? error : null,
    info: [
      ...(searchQuery ? [{ id: "search", parts: [{ text: `filter: ${searchQuery}`, tone: "value" as const }] }] : []),
    ],
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
    ],
    showOpenHint: !error && !!selectedRecord?.secUrl,
  });

  const renderCell = useCallback(
    (row: IPORecord, column: IPOColumn, _index: number, rowState: { selected: boolean }): DataTableCell => {
      const selectedColor = rowState.selected ? colors.selectedText : undefined;

      switch (column.id) {
        case "ticker":
          return {
            text: row.ticker,
            color: selectedColor ?? colors.textBright,
            attributes: TextAttributes.BOLD,
          };
        case "date":
          return {
            text: formatDate(row.date),
            color: selectedColor ?? colors.textMuted,
          };
        case "status":
          return {
            text: statusLabel(row.status),
            color: selectedColor ?? statusColor(row.status),
          };
        case "exchange":
          return {
            text: row.exchange ?? "—",
            color: selectedColor ?? colors.textDim,
          };
        case "offer":
          return {
            text: formatOfferSize(row.offerSize),
            color: selectedColor ?? colors.textDim,
          };
        case "price":
          return {
            text: formatPrice(row),
            color: selectedColor ?? colors.text,
          };
        case "shares":
          return {
            text: formatShares(row.shares),
            color: selectedColor ?? colors.textDim,
          };
        case "return":
          return {
            text: formatReturn(row.change1D),
            color: selectedColor ?? (row.change1D != null ? priceColor(row.change1D) : colors.textDim),
          };
      }
    },
    [],
  );

  const rootBefore = (
    <InputSearchBar
      value={searchQuery}
      focused={focused}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="ticker, company, or exchange"
      debounceMs={SEARCH_DEBOUNCE_MS}
      normalizeValue={(v) => v.trim()}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={updateSearch}
    />
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading IPO calendar..." />
        </Box>
      </Box>
    );
  }

  if (status === "error" && records.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text fg={colors.negative}>Error: {error}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableView<IPORecord, IPOColumn>
        focused={focused && !searchFocused}
        rootBefore={rootBefore}
        selection={{
          kind: "id",
          selectedId: selectedTicker,
          getId: (row) => row.ticker,
          onChange: (ticker) => setSelectedTicker(ticker),
        }}
        onRootKeyDown={handleTableKeyDown}
        columns={columns}
        items={sorted}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={handleHeaderClick}
        getItemKey={(row) => row.ticker}
        onActivate={handleActivate}
        renderCell={renderCell}
        emptyStateTitle={
          searchQuery
            ? `No IPOs matching "${searchQuery}"`
            : status === "error"
              ? "Failed to load IPO data"
              : "No IPO data"
        }
      />
    </Box>
  );
}
