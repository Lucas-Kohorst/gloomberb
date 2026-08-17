import { useCallback, useMemo, useState } from "react";
import { DataTableView, usePaneFooter, type PaneFooterSegment } from "../../../components";
import { buildColumnVisibilityField, resolveVisibleColumns } from "../../../components/data-table/column-settings";
import { useShortcut } from "../../../react/input";
import { usePaneInstance } from "../../../state/app/context";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PaneProps } from "../../../types/plugin";
import { isPlainKey } from "../../../utils/keyboard";
import { usePluginTickerActions } from "../../runtime";
import type { PluginModule } from "../plugin-module";
import {
  countLoadingQuotes,
  latestQuoteTimestamp,
  useQuoteBoard,
} from "../shared/use-quote-board";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import {
  FUTURES_CONTRACTS,
  FUTURES_SECTOR_LABELS,
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

function FuturesPane({ focused, width, height }: PaneProps) {
  const { pinTicker } = usePluginTickerActions();
  const paneInstance = usePaneInstance();
  const { quotes, refresh } = useQuoteBoard(FUTURES_SYMBOLS, REFRESH_INTERVAL_MS);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<FuturesSortPreference>(DEFAULT_FUTURES_SORT);

  const contractsBySector = useMemo(() => getContractsBySector(), []);
  const rows = useMemo(
    () => buildFuturesRows(contractsBySector, sortPreference, quotes),
    [contractsBySector, quotes, sortPreference],
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

  useShortcut((event) => {
    if (!focused || !isPlainKey(event, "r")) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    refresh();
  }, { enabled: focused });

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
    return { info, hints: [{ id: "refresh", key: "r", label: "efresh", onPress: refresh }] };
  }, [latestTs, loadingCount, refresh]);

  return (
    <DataTableView<FuturesTableRow, FuturesColumn>
      focused={focused}
      selection={{
        kind: "id",
        selectedId: selectedSymbol,
        getId: (row) => row.type === "row" ? row.contract.symbol : `header-${row.sector}`,
        onChange: (_id, row) => {
          if (row.type === "row") setSelectedSymbol(row.contract.symbol);
        },
      }}
      isNavigable={(row) => row.type === "row"}
      onActivate={(row) => {
        if (row.type !== "row") return;
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
        ? { text: FUTURES_SECTOR_LABELS[row.sector] }
        : null}
      renderCell={renderCell}
      emptyStateTitle="No contracts configured."
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
        "Front-month futures across equity index, rates, energy, metals, agriculture, and FX, with last price, session change, and sortable columns.",
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
