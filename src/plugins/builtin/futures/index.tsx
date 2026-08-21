import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type InputRenderable } from "../../../ui";
import {
  DataTableView,
  InputSearchBar,
  usePaneFooter,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type PaneFooterSegment,
} from "../../../components";
import { buildColumnVisibilityField, resolveVisibleColumns } from "../../../components/data-table/column-settings";
import { useShortcut } from "../../../react/input";
import { usePaneInstance } from "../../../state/app/context";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PaneProps } from "../../../types/plugin";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { usePluginTickerActions } from "../../runtime";
import type { PluginModule } from "../plugin-module";
import {
  countLoadingQuotes,
  latestQuoteTimestamp,
  useQuoteBoard,
} from "../shared/use-quote-board";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { useGraphChartPopOut } from "../shared/graph-pop-out";
import {
  FUTURES_CONTRACTS,
  FUTURES_SECTOR_LABELS,
  type FuturesContract,
  type FuturesSector,
  getContractsBySector,
} from "./contracts";
import {
  buildFuturesRows,
  DEFAULT_FUTURES_SORT,
  nextFuturesSort,
  type FuturesSortPreference,
  type FuturesTableRow,
} from "./model";
import {
  createFuturesColumns,
  DEFAULT_FUTURES_COLUMN_IDS,
  FUTURES_COLUMN_DEFS,
  renderFuturesCell,
  type FuturesColumn,
} from "./table";

const REFRESH_INTERVAL_MS = 60_000;
const FUTURES_SYMBOLS = FUTURES_CONTRACTS.map((contract) => contract.symbol);

function matchesFuturesSearch(contract: FuturesContract, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    contract.code.toLowerCase().includes(normalized) ||
    contract.name.toLowerCase().includes(normalized) ||
    contract.symbol.toLowerCase().includes(normalized)
  );
}

function FuturesPane({ focused, width, height }: PaneProps) {
  const { pinTicker } = usePluginTickerActions();
  const paneInstance = usePaneInstance();
  const { quotes, refresh } = useQuoteBoard(FUTURES_SYMBOLS, REFRESH_INTERVAL_MS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<FuturesSortPreference>(DEFAULT_FUTURES_SORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [collapsedSectors, setCollapsedSectors] = useState<Set<FuturesSector>>(new Set());
  const searchInputRef = useRef<InputRenderable | null>(null);

  const contractsBySector = useMemo(() => getContractsBySector(), []);
  const rows = useMemo(
    () => buildFuturesRows(contractsBySector, sortPreference, quotes, {
      filter: (contract) => matchesFuturesSearch(contract, searchQuery),
      collapsed: collapsedSectors,
    }),
    [contractsBySector, quotes, sortPreference, searchQuery, collapsedSectors],
  );

  const columns = useMemo<FuturesColumn[]>(
    () => resolveVisibleColumns(
      createFuturesColumns(width),
      paneInstance?.settings?.columnIds,
      DEFAULT_FUTURES_COLUMN_IDS,
    ),
    [paneInstance?.settings?.columnIds, width],
  );

  const renderCell = useCallback((
    row: FuturesTableRow,
    column: FuturesColumn,
    _index: number,
    rowState: { selected: boolean },
  ) => renderFuturesCell(row, column, rowState, quotes), [quotes]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const toggleSector = useCallback((sector: FuturesSector) => {
    setCollapsedSectors((current) => {
      const next = new Set(current);
      if (next.has(sector)) {
        next.delete(sector);
      } else {
        next.add(sector);
      }
      return next;
    });
  }, []);

  const selectedRow = useMemo(() => {
    return rows.find((row) => {
      if (row.type === "header") return `header-${row.sector}` === selectedId;
      return row.contract.symbol === selectedId;
    }) ?? null;
  }, [rows, selectedId]);

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some((row) => (row.type === "header" ? `header-${row.sector}` : row.contract.symbol) === selectedId)) {
      const firstNavigable = rows.find((row) => row.type === "row") ?? rows[0] ?? null;
      setSelectedId(firstNavigable ? (firstNavigable.type === "header" ? `header-${firstNavigable.sector}` : firstNavigable.contract.symbol) : null);
    }
  }, [rows, selectedId]);

  useShortcut((event) => {
    if (!focused || !isPlainKey(event, "r") || searchFocused) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    refresh();
  }, { enabled: focused && !searchFocused });

  const popOutChart = useGraphChartPopOut();
  const graphSelected = useCallback(() => {
    if (!selectedRow || selectedRow.type !== "row") return;
    popOutChart(`FUT:${selectedRow.contract.code}`);
  }, [popOutChart, selectedRow]);

  useShortcut((event) => {
    if (!focused || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
    if (event.name === "g") {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
    }
  }, { enabled: focused && !searchFocused });

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
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
    if (event.name === "g") {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return true;
    }
    return false;
  }, [focusSearch, graphSelected]);

  const loadingCount = countLoadingQuotes(quotes);
  const latestTs = latestQuoteTimestamp(quotes);
  useAutoRefresh(latestTs || null, refresh);
  usePaneFooter("futures", () => {
    const info: PaneFooterSegment[] = [];
    if (loadingCount > 0) info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
    if (latestTs > 0) {
      info.push({
        id: "fresh",
        parts: [{
          text: new Date(latestTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          tone: "muted",
        }],
      });
    }
    if (searchQuery.trim()) {
      info.push({ id: "search", parts: [{ text: `search: ${searchQuery.trim()}`, tone: "value" }] });
    }
    return {
      info,
      hints: [
        { id: "graph", key: "g", label: "raph", onPress: graphSelected, disabled: !(selectedRow && selectedRow.type === "row") },
        { id: "search", key: "s", label: "earch", onPress: focusSearch },
        { id: "refresh", key: "r", label: "efresh", onPress: refresh },
      ],
    };
  }, [focusSearch, graphSelected, latestTs, loadingCount, refresh, searchQuery, selectedRow]);

  return (
    <DataTableView<FuturesTableRow, FuturesColumn>
      focused={focused && !searchFocused}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.type === "row" ? row.contract.symbol : `header-${row.sector}`,
        onChange: (id) => setSelectedId(id),
      }}
      isNavigable={() => true}
      onActivate={(row) => {
        if (row.type === "header") {
          toggleSector(row.sector);
          return;
        }
        pinTicker(row.contract.symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
      }}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextFuturesSort(current, columnId))}
      getItemKey={(row) => row.type === "header" ? `header-${row.sector}` : row.contract.symbol}
      renderSectionHeader={(row) => row.type === "header"
        ? {
            text: `${collapsedSectors.has(row.sector) ? "▶" : "▼"} ${FUTURES_SECTOR_LABELS[row.sector]}`,
            onMouseDown: () => toggleSector(row.sector),
          }
        : null}
      renderCell={renderCell}
      emptyStateTitle={searchQuery.trim() ? "No matching contracts." : "No contracts configured."}
      emptyStateHint={searchQuery.trim() ? "Clear search or press r to refresh." : "Press [s] to search."}
      rootBefore={(
        <InputSearchBar
          value={searchQuery}
          focused={focused}
          active={searchFocused}
          width={width}
          focusToken={searchFocusToken}
          inputRef={searchInputRef}
          placeholder="ticker or name"
          debounceMs={80}
          onFocus={focusSearch}
          onBlur={blurSearch}
          onNavigateDown={blurSearch}
          onQueryChange={setSearchQuery}
        />
      )}
      onRootKeyDown={handleRootKeyDown}
    />
  );
}

export const futuresModule: PluginModule = {
  panes: [
    {
      id: "futures",
      name: "Futures",
      icon: "F",
      component: FuturesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 76, height: 34 },
      settings: {
        title: "Futures Settings",
        fields: [buildColumnVisibilityField(FUTURES_COLUMN_DEFS)],
      },
    },
  ],

  paneTemplates: [
    {
      id: "futures-pane",
      paneId: "futures",
      label: "Futures Board",
      description:
        "Front-month futures across equity index, rates, energy, metals, agriculture, and FX, with last price, session change, and sortable columns. Search by ticker or name and expand/collapse sectors.",
      keywords: [
        "futures",
        "commodities",
        "crude",
        "oil",
        "gold",
        "silver",
        "copper",
        "corn",
        "wheat",
        "treasuries",
        "contracts",
        "cme",
      ],
      shortcut: { prefix: "FUT" },
    },
  ],
};
