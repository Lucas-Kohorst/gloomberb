import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTableView, InputSearchBar, usePaneFooter, type DataTableKeyEvent } from "../../../components";
import { type InputRenderable } from "../../../ui";
import {
  buildColumnVisibilityField,
  resolveVisibleColumns,
} from "../../../components/data-table/column-settings";
import type { PaneProps } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import type { EarningsEvent } from "../../../types/data-provider";
import { useAppSelector, usePaneInstance } from "../../../state/app/context";
import { nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { parseTickerListInput, formatTickerListInput } from "../../../tickers/list";
import { useAssetData, usePluginPaneState, usePluginTickerActions } from "../../runtime";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import {
  attachEarningsCalendarPersistence,
  loadEarningsCalendar,
  resetEarningsCalendarPersistence,
} from "./data/cache";
import {
  groupEarningsByRelativeDate,
  resolveEarningsCollectionId,
  resolveEarningsMonitorSymbols,
  scopedSymbolsFromSettings,
  trackedEarningsSymbols,
  type EarningsDisplayRow,
  type EarningsEventDisplayRow,
} from "./model";
import {
  buildEarningsColumns,
  DEFAULT_EARNINGS_COLUMN_IDS,
  EARNINGS_COLUMN_DEFS,
  renderEarningsCell,
  renderEarningsSectionHeader,
  sortEarningsDisplayRows,
  type EarningsColumn,
  type EarningsColumnId,
} from "./table";

function EarningsCalendarPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { navigateTicker } = usePluginTickerActions();
  const pane = usePaneInstance();
  const [events, setEvents] = useState<EarningsEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>("selectedIdx", 0);
  const [sortPreference, setSortPreference] = useState<SortPreference<EarningsColumnId>>({
    columnId: null,
    direction: "asc",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const requestIdRef = useRef(0);

  const tickers = useAppSelector((state) => state.tickers);
  const legacyCollectionId = useAppSelector((state) => (
    state.config.portfolios[0]?.id ?? state.config.watchlists[0]?.id ?? null
  ));
  const scopedSymbols = useMemo(() => scopedSymbolsFromSettings(pane?.settings), [pane?.settings]);
  const scopedCollectionId = useMemo(
    () => resolveEarningsCollectionId(pane?.settings, legacyCollectionId),
    [legacyCollectionId, pane?.settings],
  );
  const fallbackTickerSymbols = useMemo(
    () => trackedEarningsSymbols(tickers.values(), scopedCollectionId),
    [scopedCollectionId, tickers],
  );
  const tickerSymbols = useMemo(
    () => resolveEarningsMonitorSymbols(scopedSymbols, fallbackTickerSymbols),
    [fallbackTickerSymbols, scopedSymbols],
  );

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query
      ? events.filter((event) => `${event.symbol} ${event.name}`.toLowerCase().includes(query))
      : events;
  }, [events, searchQuery]);
  const groupedRows = useMemo(() => groupEarningsByRelativeDate(filteredEvents), [filteredEvents]);
  const rows = useMemo(
    () => sortEarningsDisplayRows(groupedRows, sortPreference),
    [groupedRows, sortPreference],
  );
  const eventRows = useMemo(
    () => rows.filter((row): row is EarningsEventDisplayRow => row.kind === "event"),
    [rows],
  );
  const eventCount = eventRows.length;
  const activeEventIdx = eventCount > 0 ? Math.min(Math.max(selectedIdx, 0), eventCount - 1) : -1;
  const selectedRowIndex = rows.findIndex((row) => row.kind === "event" && row.eventIdx === activeEventIdx);
  const columns = useMemo(
    () => resolveVisibleColumns(
      buildEarningsColumns(width),
      pane?.settings?.columnIds,
      DEFAULT_EARNINGS_COLUMN_IDS,
    ),
    [pane?.settings?.columnIds, width],
  );

  const reload = useCallback((force = false) => {
    const requestId = ++requestIdRef.current;
    if (tickerSymbols.length === 0) {
      setEvents([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    loadEarningsCalendar(dataProvider, tickerSymbols, { force })
      .then((data) => {
        if (requestId !== requestIdRef.current) return;
        setEvents(data);
        setLastUpdated(Date.now());
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
      });
  }, [dataProvider, tickerSymbols]);

  useEffect(() => {
    reload(false);
  }, [reload]);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  useEffect(() => {
    if (eventCount > 0 && selectedIdx >= eventCount) {
      setSelectedIdx(eventCount - 1);
    }
  }, [eventCount, selectedIdx, setSelectedIdx]);

  const openEvent = useCallback((event: EarningsEvent) => {
    navigateTicker(event.symbol);
  }, [navigateTicker]);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSearchFocused(true);
      setSearchFocusToken((value) => value + 1);
      return true;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      reload(true);
      return true;
    }
    return false;
  }, [reload]);

  const renderCell = useCallback((
    row: EarningsDisplayRow,
    column: EarningsColumn,
    _index: number,
    rowState: { selected: boolean },
  ) => {
    return renderEarningsCell(row, column, rowState.selected);
  }, []);

  useAutoRefresh(lastUpdated, () => reload(true));

  usePaneFooter("earnings-calendar", () => ({
    info: [
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: () => reload(true) },
      { id: "search", key: "/", label: "earch", onPress: () => { setSearchFocused(true); setSearchFocusToken((value) => value + 1); } },
    ],
  }), [error, loading, reload]);

  return (
    <DataTableView<EarningsDisplayRow, EarningsColumn>
      focused={focused && !searchFocused}
      selection={{
        kind: "index",
        selectedIndex: selectedRowIndex,
        onChange: (_index, row) => {
          if (row.kind === "event") setSelectedIdx(row.eventIdx);
        },
      }}
      isNavigable={(row) => row.kind === "event"}
      onActivate={(row) => {
        if (row.kind === "event") openEvent(row.event);
      }}
      onRootKeyDown={handleTableKeyDown}
      rootWidth={width}
      rootHeight={height}
      rootBefore={<InputSearchBar value={searchQuery} focused={focused} active={searchFocused} width={width} focusToken={searchFocusToken} inputRef={searchInputRef} placeholder="ticker or company" debounceMs={80} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onNavigateDown={() => setSearchFocused(false)} onQueryChange={setSearchQuery} />}
      columns={columns}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(
        current,
        columnId as EarningsColumnId,
        {
          defaultDirection: columnId === "symbol" || columnId === "name" || columnId === "when" || columnId === "status"
            ? "asc"
            : "desc",
        },
      ))}
      getItemKey={(row) => row.key}
      renderSectionHeader={renderEarningsSectionHeader}
      renderCell={renderCell}
      emptyStateTitle={
        loading
          ? "Loading earnings..."
          : error && events.length === 0
            ? error
            : tickerSymbols.length === 0
              ? "No tickers in scope."
              : "No upcoming earnings found"
      }
    />
  );
}

export const earningsModule: PluginModule = {
  setup(ctx) {
    attachEarningsCalendarPersistence(ctx.persistence);
    ctx.registerCommand({
      id: "earnings-monitor-shortcut",
      label: "Earnings Monitor",
      keywords: ["earnings", "monitor", "calendar", "em", "eps"],
      shortcut: "EM",
      shortcutArg: {
        placeholder: "tickers",
        kind: "text",
        parse: (arg) => ({ tickers: arg.trim() }),
      },
      category: "data",
      description: "Open upcoming earnings, optionally scoped to tickers.",
      execute: (values) => {
        ctx.createPaneFromTemplate("earnings-monitor-pane", {
          arg: values?.tickers ?? "",
        });
      },
    });
  },

  dispose() {
    resetEarningsCalendarPersistence();
  },

  panes: [
    {
      id: "earnings-calendar",
      name: "Earnings Calendar",
      icon: "$",
      component: EarningsCalendarPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 85, height: 25 },
      settings: {
        title: "Earnings Calendar Settings",
        fields: [buildColumnVisibilityField(EARNINGS_COLUMN_DEFS)],
      },
    },
  ],

  paneTemplates: [
    {
      id: "earnings-calendar-pane",
      paneId: "earnings-calendar",
      label: "Earnings Calendar",
      description: "Upcoming earnings dates and estimates for your tickers.",
      keywords: ["earn", "earnings", "calendar", "eps", "revenue", "quarterly"],
      shortcut: { prefix: "ERN" },
      createInstance: (context) => ({
        settings: context.activeCollectionId
          ? { collectionId: context.activeCollectionId }
          : undefined,
      }),
    },
    {
      id: "earnings-monitor-pane",
      paneId: "earnings-calendar",
      label: "Earnings Monitor",
      description: "Upcoming earnings dates and estimates, optionally scoped to tickers.",
      keywords: ["earn", "earnings", "monitor", "em", "eps", "revenue"],
      canCreate: () => true,
      createInstance: (context, options) => {
        const raw = options?.arg?.trim() ?? "";
        const symbols = raw ? parseTickerListInput(raw) : [];
        return {
          title: symbols.length > 0 ? `EM ${formatTickerListInput(symbols)}` : "Earnings Monitor",
          placement: "floating",
          settings: symbols.length > 0
            ? {
              symbols,
              symbolsText: formatTickerListInput(symbols),
            }
            : context.activeCollectionId
              ? { collectionId: context.activeCollectionId }
              : undefined,
        };
      },
    },
  ],
};
