import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataTableView,
  InputSearchBar,
  Spinner,
  useExternalLinkFooter,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { colors, priceColor } from "../../../theme/colors";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PaneProps } from "../../../types/plugin";
import { Box, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
import { usePluginTickerActions } from "../../runtime";
import { useAutoRefresh } from "../shared/auto-refresh";
import { loadingErrorFooterInfo } from "../shared/table-pane";
import { fetchIpoCalendar } from "./client";
import {
  DEFAULT_SORT_PREFERENCE,
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
  stockAnalysisUrl,
  type IPOColumn,
  type IPOSortPreference,
} from "./model";
import { IPO_CALENDAR_PANE_ID, type IPORecord, type LoadStatus } from "./types";

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

  const load = useCallback(async () => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setStatus((current) => (current === "loaded" ? current : "loading"));
    setError(null);

    try {
      const data = await fetchIpoCalendar();
      if (fetchGenRef.current !== gen) return;
      setRecords(data);
      setStatus("loaded");
      setLastUpdated(Date.now());
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => {
    void load();
  });

  const filtered = useMemo(
    () => records.filter((record) => matchesSearch(record, searchQuery)),
    [records, searchQuery],
  );

  const sorted = useMemo(
    () => sortRows(filtered, sortPreference),
    [filtered, sortPreference],
  );

  const columns = useMemo(() => buildColumns(width), [width]);

  useEffect(() => {
    if (selectedTicker && sorted.some((record) => record.ticker === selectedTicker)) return;
    const first = sorted[0];
    if (first) {
      setSelectedTicker(first.ticker);
    } else if (selectedTicker !== null) {
      setSelectedTicker(null);
    }
  }, [selectedTicker, sorted]);

  const loading = status === "loading" && records.length === 0;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((token) => token + 1);
  }, []);

  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const updateSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setSelectedTicker(null);
  }, []);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, []);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    if (isPlainKey(event, "/") || isPlainKey(event, "s")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch, refresh]);

  const handleActivate = useCallback((record: IPORecord) => {
    pinTicker(record.ticker, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
  }, [pinTicker]);

  useShortcut((event) => {
    if (!focused || searchFocused) return;
    if (event.targetEditable) return;
    if (isPlainKey(event, "/") || isPlainKey(event, "s")) {
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
    () => sorted.find((record) => record.ticker === selectedTicker) ?? null,
    [selectedTicker, sorted],
  );

  const footerInfo = useMemo(() => [
    ...loadingErrorFooterInfo(status === "loading", status === "error" ? error : null),
    ...(searchQuery ? [{
      id: "search",
      parts: [{ text: `filter: ${searchQuery}`, tone: "value" as const }],
    }] : []),
  ], [error, searchQuery, status]);

  const footerHints = useMemo(() => [
    { id: "search", key: "s", label: "earch", onPress: focusSearch },
    { id: "refresh", key: "r", label: "efresh", onPress: refresh },
  ], [focusSearch, refresh]);

  useExternalLinkFooter({
    registrationId: IPO_CALENDAR_PANE_ID,
    focused,
    url: selectedRecord ? stockAnalysisUrl(selectedRecord.ticker) : null,
    source: "stockanalysis.com",
    info: footerInfo,
    hints: footerHints,
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
            text: row.status,
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
      normalizeValue={(value) => value.trim()}
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
    <DataTableView<IPORecord, IPOColumn>
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      rootWidth={width}
      rootHeight={height}
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
  );
}
