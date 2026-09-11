import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type InputRenderable } from "../../../ui";
import {
  DataTableView,
  InputSearchBar,
  dataErrorMessage,
  isNoDataError,
  noDataMessage,
  unavailableTitle,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import type { TickerFinancials } from "../../../types/financials";
import type { PaneProps } from "../../../types/plugin";
import { usePaneInstance } from "../../../state/app/context";
import { getSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { colors, priceColor } from "../../../theme/colors";
import { applySortPreference, compareSortValues, type SortDirection } from "../../../utils/sort-values";
import { formatCompact, formatCurrency, formatNumber, formatPercent, formatPercentRaw } from "../../../utils/format";
import { usePluginTickerActions } from "../../runtime";
import { handleRefreshKey, loadingErrorFooterInfo, useClampSelectedIndex } from "../shared/table-pane";
import { paneSearchHint } from "../shared/pane-footer";
import { useBoundTicker as useSymbolBinding } from "../shared/ticker-request";

type RelativeColumnId = "symbol" | "price" | "change" | "marketCap" | "pe" | "forwardPe" | "evSales" | "fcfYield" | "revenueGrowth" | "margin";
type RelativeColumn = DataTableColumn & { id: RelativeColumnId };
type RelativeRow = {
  symbol: string;
  financials: TickerFinancials | null;
  error?: string;
};

function relativeSymbolsFromPane(symbol: string | null, paneSettings: Record<string, unknown> | undefined): string[] {
  const settingsSymbols = Array.isArray(paneSettings?.symbols)
    ? paneSettings.symbols.filter((value): value is string => typeof value === "string")
    : [];
  if (settingsSymbols.length > 0) return settingsSymbols;
  return symbol ? [symbol] : [];
}

function buildRelativeColumns(): RelativeColumn[] {
  return [
    { id: "symbol", label: "TICKER", width: 8, align: "left" },
    { id: "price", label: "LAST", width: 10, align: "right" },
    { id: "change", label: "CHG%", width: 8, align: "right" },
    { id: "marketCap", label: "MCAP", width: 9, align: "right" },
    { id: "pe", label: "P/E", width: 8, align: "right" },
    { id: "forwardPe", label: "FWD", width: 8, align: "right" },
    { id: "evSales", label: "EV/S", width: 8, align: "right" },
    { id: "fcfYield", label: "FCF%", width: 8, align: "right" },
    { id: "revenueGrowth", label: "REV%", width: 8, align: "right" },
    { id: "margin", label: "OP%", width: 8, align: "right", flexGrow: 1 },
  ];
}

interface RelativeSortPreference {
  columnId: RelativeColumnId;
  direction: SortDirection;
}

const DEFAULT_RELATIVE_SORT: RelativeSortPreference = { columnId: "marketCap", direction: "desc" };

function evSales(financials: TickerFinancials | null): number | undefined {
  const ev = financials?.fundamentals?.enterpriseValue;
  const revenue = financials?.fundamentals?.revenue;
  return ev != null && revenue ? ev / revenue : undefined;
}

function fcfYield(financials: TickerFinancials | null): number | undefined {
  const fcf = financials?.fundamentals?.freeCashFlow;
  const marketCap = financials?.quote?.marketCap;
  return fcf != null && marketCap ? fcf / marketCap : undefined;
}

function relativeSortValue(row: RelativeRow, columnId: RelativeColumnId): string | number | null {
  const quote = row.financials?.quote;
  const fundamentals = row.financials?.fundamentals;
  switch (columnId) {
    case "symbol":
      return row.symbol.toLocaleLowerCase();
    case "price":
      return quote?.price ?? null;
    case "change":
      return quote?.changePercent ?? null;
    case "marketCap":
      return quote?.marketCap ?? null;
    case "pe":
      return fundamentals?.trailingPE ?? null;
    case "forwardPe":
      return fundamentals?.forwardPE ?? null;
    case "evSales":
      return evSales(row.financials) ?? null;
    case "fcfYield":
      return fcfYield(row.financials) ?? null;
    case "revenueGrowth":
      return fundamentals?.revenueGrowth ?? fundamentals?.lastQuarterGrowth ?? null;
    case "margin":
      return fundamentals?.operatingMargin ?? null;
  }
}

function sortRelativeRows(
  rows: readonly RelativeRow[],
  preference: RelativeSortPreference,
): RelativeRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => (
      compareSortValues(
        relativeSortValue(left.row, preference.columnId),
        relativeSortValue(right.row, preference.columnId),
        preference.direction,
      ) || left.index - right.index
    ))
    .map((entry) => entry.row);
}

export function RelativeValuationPane({ focused, width, height }: PaneProps) {
  const pane = usePaneInstance();
  const { symbol } = useSymbolBinding();
  const symbols = useMemo(
    () => relativeSymbolsFromPane(symbol, pane?.settings),
    [pane?.settings, symbol],
  );
  const { navigateTicker } = usePluginTickerActions();
  const [rows, setRows] = useState<RelativeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortPreference, setSortPreference] = useState<RelativeSortPreference>(DEFAULT_RELATIVE_SORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const columns = useMemo(() => buildRelativeColumns(), []);
  const sortedRows = useMemo(
    () => applySortPreference(rows.filter((row) => !searchQuery.trim() || `${row.symbol} ${row.financials?.quote?.name ?? ""}`.toLowerCase().includes(searchQuery.trim().toLowerCase())), sortPreference, (row, columnId) => {
      const quote = row.financials?.quote;
      const fundamentals = row.financials?.fundamentals;
      switch (columnId) {
        case "symbol": return row.symbol;
        case "price": return quote?.price ?? null;
        case "change": return quote?.changePercent ?? null;
        case "marketCap": return quote?.marketCap ?? null;
        case "pe": return fundamentals?.trailingPE ?? null;
        case "forwardPe": return fundamentals?.forwardPE ?? null;
        case "evSales": return evSales(row.financials) ?? null;
        case "fcfYield": return fcfYield(row.financials) ?? null;
        case "revenueGrowth": return fundamentals?.revenueGrowth ?? fundamentals?.lastQuarterGrowth ?? null;
        case "margin": return fundamentals?.operatingMargin ?? null;
      }
    }),
    [rows, searchQuery, sortPreference],
  );
  const fetchGenRef = useRef(0);

  const reload = useCallback((forceRefresh = false) => {
    if (symbols.length === 0) {
      setRows([]);
      setError(null);
      return;
    }
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator) {
      setRows([]);
      setError("Market data unavailable");
      return;
    }
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);
    // One batched snapshot request instead of one request per peer.
    coordinator.loadSnapshotsBatch(symbols.map((peer) => ({ symbol: peer })), { forceRefresh })
      .then((entries) => {
        if (fetchGenRef.current !== gen) return;
        setRows(symbols.map((peer, index) => {
          const entry = entries[index];
          return {
            symbol: peer,
            financials: entry?.data ?? entry?.lastGoodData ?? null,
            error: entry?.error?.message,
          };
        }));
      })
      .catch((err) => {
        if (fetchGenRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (fetchGenRef.current === gen) setLoading(false);
      });
  }, [symbols]);

  useEffect(() => {
    reload(false);
  }, [reload]);

  useClampSelectedIndex(rows.length, selectedIdx, setSelectedIdx);

  const renderCell = useCallback((row: RelativeRow, column: RelativeColumn, _index: number, rowState: { selected: boolean }): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    const quote = row.financials?.quote;
    const fundamentals = row.financials?.fundamentals;
    switch (column.id) {
      case "symbol":
        return { text: row.symbol, color: selectedColor ?? (row.error ? colors.warning : colors.textBright), attributes: TextAttributes.BOLD };
      case "price":
        return { text: quote?.price != null ? formatCurrency(quote.price, quote.currency) : "—", color: selectedColor ?? colors.text };
      case "change":
        return { text: quote?.changePercent != null ? formatPercentRaw(quote.changePercent) : "—", color: selectedColor ?? priceColor(quote?.changePercent ?? 0) };
      case "marketCap":
        return { text: formatCompact(quote?.marketCap), color: selectedColor ?? colors.textDim };
      case "pe":
        return { text: formatNumber(fundamentals?.trailingPE, 1), color: selectedColor ?? colors.text };
      case "forwardPe":
        return { text: formatNumber(fundamentals?.forwardPE, 1), color: selectedColor ?? colors.text };
      case "evSales":
        return { text: formatNumber(evSales(row.financials), 1), color: selectedColor ?? colors.text };
      case "fcfYield":
        return { text: formatPercent(fcfYield(row.financials)), color: selectedColor ?? priceColor(fcfYield(row.financials) ?? 0) };
      case "revenueGrowth":
        return { text: formatPercent(fundamentals?.revenueGrowth ?? fundamentals?.lastQuarterGrowth), color: selectedColor ?? priceColor(fundamentals?.revenueGrowth ?? fundamentals?.lastQuarterGrowth ?? 0) };
      case "margin":
        return { text: formatPercent(fundamentals?.operatingMargin), color: selectedColor ?? colors.text };
    }
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if ((event as { targetEditable?: boolean }).targetEditable) return false;
    if (event.name === "/") { event.preventDefault?.(); event.stopPropagation?.(); setSearchFocused(true); setSearchFocusToken((value) => value + 1); return true; }
    if (event.name === "o") {
      const row = sortedRows[selectedIdx];
      if (row) {
        event.preventDefault?.();
        event.stopPropagation?.();
        navigateTicker(row.symbol);
        return true;
      }
    }
    return handleRefreshKey(event, () => reload(true), { stopPropagation: true });
  }, [navigateTicker, reload, selectedIdx, sortedRows]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((value) => value + 1);
  }, []);
  const refresh = useCallback(() => reload(true), [reload]);
  const openSelected = useCallback(() => {
    const row = sortedRows[selectedIdx];
    if (row) navigateTicker(row.symbol);
  }, [navigateTicker, selectedIdx, sortedRows]);

  usePaneFooter("relative-valuation", () => ({
    info: loadingErrorFooterInfo(loading, error),
    hints: [
      paneSearchHint(focusSearch),
      { id: "open", key: "o", label: "pen", onPress: openSelected, disabled: !sortedRows[selectedIdx] },
    ],
  }), [error, focusSearch, loading, openSelected, selectedIdx, sortedRows]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => (
      current.columnId === columnId
        ? { columnId: current.columnId, direction: current.direction === "asc" ? "desc" : "asc" }
        : { columnId: columnId as RelativeColumnId, direction: columnId === "symbol" ? "asc" : "desc" }
    ));
  }, []);

  return (
    <DataTableView<RelativeRow, RelativeColumn>
      focused={focused && !searchFocused}
      selection={{
        kind: "index",
        selectedIndex: sortedRows.length > 0 ? selectedIdx : -1,
        onChange: (index) => setSelectedIdx(index),
      }}
      onActivate={(row) => navigateTicker(row.symbol)}
      onRootKeyDown={handleKeyDown}
      rootWidth={width}
      rootHeight={height}
      rootBefore={<InputSearchBar value={searchQuery} focused={focused} active={searchFocused} width={width} focusToken={searchFocusToken} inputRef={searchInputRef} placeholder="ticker or company" debounceMs={80} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onNavigateDown={() => setSearchFocused(false)} onQueryChange={setSearchQuery} />}
      columns={columns}
      items={sortedRows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={handleHeaderClick}
      getItemKey={(row) => row.symbol}
      renderCell={renderCell}
      emptyStateTitle={loading
        ? "Loading peers..."
        : error && !isNoDataError(error)
          ? unavailableTitle("peer")
          : "No peer data"}
      emptyStateMessage={loading
        ? undefined
        : error && !isNoDataError(error)
          ? dataErrorMessage(error)
          : symbol
            ? noDataMessage(symbol, "peers")
            : undefined}
    />
  );
}
