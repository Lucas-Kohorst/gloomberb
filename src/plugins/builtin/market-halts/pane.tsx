import { Box } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTableView, Tabs, type DataTableCell, type DataTableKeyEvent } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import { colors } from "../../../theme/colors";
import { usePluginTickerActions } from "../../runtime";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePaneStatusFooter } from "../shared/pane-footer";
import { fetchMarketHalts } from "./client";
import {
  buildHaltColumns,
  filterHalts,
  HALT_FILTER_TABS,
  nextSortPreference,
  sortHalts,
  DEFAULT_SORT_PREFERENCE,
  type HaltColumn,
  type HaltSortPreference,
} from "./model";
import type { HaltFilter } from "./types";
import type { HaltStatus, MarketHalt } from "./types";

function formatHaltTime(date: Date | null): string {
  if (!date) return "—";
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function statusColor(status: HaltStatus): string | undefined {
  switch (status) {
    case "active":
      return colors.negative;
    case "quote_resumed":
      return colors.warning;
    case "resumed":
      return undefined;
  }
}

function MarketHaltsPane({ focused, width, height }: PaneProps) {
  const { pinTicker } = usePluginTickerActions();
  const [halts, setHalts] = useState<MarketHalt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<HaltFilter>("all");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<HaltSortPreference>(DEFAULT_SORT_PREFERENCE);

  const fetchGenRef = useRef(0);

  const load = useCallback(async (force = false) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchMarketHalts({ forceRefresh: force });
      if (fetchGenRef.current !== gen) return;
      setHalts(data);
      setLastUpdated(Date.now());
      setSelectedTicker(null);
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : "Failed to load market halts");
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(lastUpdated, () => load(true));

  const columns = useMemo(() => buildHaltColumns(width), [width]);

  const filtered = useMemo(
    () => filterHalts(halts, activeFilter),
    [activeFilter, halts],
  );

  const rows = useMemo(
    () => sortHalts(filtered, sortPreference),
    [filtered, sortPreference],
  );

  const selectedIdx = selectedTicker
    ? rows.findIndex((row) => row.ticker === selectedTicker)
    : -1;

  useEffect(() => {
    if (selectedTicker && selectedIdx >= 0) return;
    const firstRow = rows[0];
    if (firstRow) {
      setSelectedTicker(firstRow.ticker);
    } else if (selectedTicker !== null) {
      setSelectedTicker(null);
    }
  }, [rows, selectedIdx, selectedTicker]);

  const openTicker = useCallback((symbol: string) => {
    pinTicker(symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
  }, [pinTicker]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, []);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(true);
      return true;
    }
    return false;
  }, [load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  const activeCount = useMemo(
    () => halts.filter((h) => h.status === "active").length,
    [halts],
  );

  const renderCell = useCallback((
    row: MarketHalt,
    column: HaltColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    const statusCol = statusColor(row.status);

    switch (column.id) {
      case "ticker":
        return {
          text: row.ticker,
          color: selectedColor ?? statusCol ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "exchange":
        return { text: row.exchange, color: selectedColor ?? colors.textDim };
      case "name":
        return { text: row.name ?? "", color: selectedColor ?? colors.text };
      case "haltCode":
        return {
          text: row.haltCode,
          color: selectedColor ?? statusCol ?? colors.text,
        };
      case "haltTime":
        return {
          text: formatHaltTime(row.haltTime),
          color: selectedColor ?? colors.textDim,
        };
      case "quoteResume":
        return {
          text: formatHaltTime(row.quoteResumeTime),
          color: selectedColor ?? colors.textDim,
        };
      case "resumeTime":
        return {
          text: formatHaltTime(row.resumeTime),
          color: selectedColor ?? colors.textDim,
        };
    }
  }, []);

  const footerInfo = useMemo(() => {
    const info: Array<{ id: string; parts: Array<{ text: string; tone?: "label" | "value" | "muted" | "warning"; color?: string; bold?: boolean }> }> = [];
    if (activeCount > 0) {
      info.push({
        id: "active",
        parts: [{ text: `${activeCount} active`, tone: "warning", bold: true }],
      });
    }
    info.push({
      id: "total",
      parts: [{ text: `${halts.length} total`, tone: "muted" }],
    });
    return info;
  }, [activeCount, halts.length]);

  usePaneStatusFooter({
    registrationId: "market-halts",
    loading,
    error,
    info: footerInfo,
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: refresh }],
  });

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1} paddingX={1}>
        <Tabs
          tabs={HALT_FILTER_TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
          activeValue={activeFilter}
          onSelect={(value) => {
            setActiveFilter(value as HaltFilter);
            setSelectedTicker(null);
          }}
          compact
          variant="bare"
          focused={focused}
        />
      </Box>

      <DataTableView<MarketHalt, HaltColumn>
        focused={focused}
        selection={{
          kind: "id",
          selectedId: selectedTicker,
          getId: (row) => row.ticker,
          onChange: (ticker) => setSelectedTicker(ticker),
        }}
        onRootKeyDown={handleTableKeyDown}
        resetScrollKey={activeFilter}
        columns={columns}
        items={rows}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={handleHeaderClick}
        getItemKey={(row) => `${row.ticker}-${row.haltTime.getTime()}`}
        onActivate={(row) => openTicker(row.ticker)}
        renderCell={renderCell}
        emptyStateTitle={loading ? "Loading halts..." : error ?? "No halts today"}
        emptyStateHint={error ? "Nasdaq Trader feed unavailable." : "No active or recent trading halts."}
      />
    </Box>
  );
}

export { MarketHaltsPane };
