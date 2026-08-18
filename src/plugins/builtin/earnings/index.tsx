import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTableView, usePaneFooter, type DataTableKeyEvent } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import type { EarningsEvent } from "../../../types/data-provider";
import { useAppSelector, usePaneInstance } from "../../../state/app/context";
import { parseTickerListInput, formatTickerListInput } from "../../../tickers/list";
import { useAssetData, usePluginPaneState, usePluginTickerActions } from "../../runtime";
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
  renderEarningsCell,
  renderEarningsSectionHeader,
  type EarningsColumn,
} from "./table";

function EarningsCalendarPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { navigateTicker } = usePluginTickerActions();
  const pane = usePaneInstance();
  const [events, setEvents] = useState<EarningsEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>("selectedIdx", 0);
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

  const rows = useMemo(() => groupEarningsByRelativeDate(events), [events]);
  const eventRows = useMemo(
    () => rows.filter((row): row is EarningsEventDisplayRow => row.kind === "event"),
    [rows],
  );
  const eventCount = eventRows.length;
  const activeEventIdx = eventCount > 0 ? Math.min(Math.max(selectedIdx, 0), eventCount - 1) : -1;
  const selectedRowIndex = rows.findIndex((row) => row.kind === "event" && row.eventIdx === activeEventIdx);
  const columns = useMemo(() => buildEarningsColumns(width), [width]);

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

  usePaneFooter("earnings-calendar", () => ({
    info: [
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
  }), [error, loading]);

  return (
    <DataTableView<EarningsDisplayRow, EarningsColumn>
      focused={focused}
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
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.key}
      renderSectionHeader={renderEarningsSectionHeader}
      renderCell={renderCell}
      emptyStateTitle={loading ? "Loading earnings..." : "No upcoming earnings found"}
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
