import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTableView, LoadingState, usePaneFooter, type DataTableCell, type DataTableColumn, type DataTableKeyEvent } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { TextAttributes } from "../../../ui";
import { useAppSelector, usePaneCollection } from "../../../state/app/context";
import { useAssetData, usePluginTickerActions } from "../../runtime";
import { getCollectionTickersFromConfig } from "../portfolio-list/pane/data";
import { handleRefreshKey } from "../shared/table-pane";
import { colors } from "../../../theme/colors";
import { applySortPreference, nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { buildPortfolioEventRows, type PortfolioEventRow } from "./portfolio-events-model";
import type { CorporateActionsData } from "../../../types/financials";

type ColumnId = "date" | "symbol" | "event" | "period" | "value" | "detail";
type Column = DataTableColumn & { id: ColumnId };
const columns: Column[] = [
  { id: "date", label: "DATE", width: 10, align: "left" },
  { id: "symbol", label: "SYMBOL", width: 8, align: "left" },
  { id: "event", label: "EVENT", width: 9, align: "left" },
  { id: "period", label: "PERIOD", width: 9, align: "left" },
  { id: "value", label: "VALUE", width: 10, align: "right" },
  { id: "detail", label: "DETAIL", width: 10, flexGrow: 1, align: "left" },
];

export function PortfolioEventsPane({ focused, width, height }: PaneProps) {
  const provider = useAssetData();
  const { navigateTicker } = usePluginTickerActions();
  const { collectionId } = usePaneCollection();
  const config = useAppSelector((state) => state.config);
  const tickerMap = useAppSelector((state) => state.tickers);
  const tickers = useMemo(() => getCollectionTickersFromConfig(config, tickerMap, collectionId), [collectionId, config, tickerMap]);
  const [data, setData] = useState<Map<string, { data: CorporateActionsData | null; name?: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortPreference, setSortPreference] = useState<SortPreference<ColumnId>>({ columnId: "date", direction: "asc" });

  const reload = useCallback(() => {
    const getCorporateActions = provider?.getCorporateActions;
    if (!getCorporateActions || tickers.length === 0) { setData(new Map()); setLoading(false); return; }
    setLoading(true); setError(null);
    Promise.all(tickers.map(async (ticker): Promise<[string, { data: CorporateActionsData | null; name?: string }]> => {
      try { return [ticker.metadata.ticker, { data: await getCorporateActions(ticker.metadata.ticker, ticker.metadata.exchange), name: ticker.metadata.name }]; }
      catch { return [ticker.metadata.ticker, { data: null, name: ticker.metadata.name }]; }
    })).then((entries) => setData(new Map(entries))).finally(() => setLoading(false));
  }, [provider, tickers]);
  useEffect(() => { reload(); }, [reload]);

  const rows = useMemo(() => buildPortfolioEventRows(tickers.map((ticker) => ({
    symbol: ticker.metadata.ticker, name: data.get(ticker.metadata.ticker)?.name ?? ticker.metadata.name,
    currency: ticker.metadata.currency ?? config.baseCurrency, data: data.get(ticker.metadata.ticker)?.data ?? null,
  }))), [config.baseCurrency, data, tickers]);
  const sortedRows = useMemo(() => applySortPreference(rows, sortPreference, (row, id) => id === "date" ? row.date : id === "symbol" ? row.symbol : id === "event" ? row.status : id === "period" ? row.period : id === "value" ? row.value : row.detail), [rows, sortPreference]);
  const renderCell = useCallback((row: PortfolioEventRow, column: Column, _index: number, state: { selected: boolean }): DataTableCell => ({
    text: column.id === "date" ? row.date : column.id === "symbol" ? row.symbol : column.id === "event" ? row.status : column.id === "period" ? row.period : column.id === "value" ? row.value : row.detail,
    color: state.selected ? colors.selectedText : column.id === "event" ? colors.textBright : colors.text,
    attributes: column.id === "event" ? TextAttributes.BOLD : undefined,
  }), []);
  const handleKeyDown = useCallback((event: DataTableKeyEvent) => handleRefreshKey(event, reload, { stopPropagation: true }), [reload]);
  usePaneFooter("portfolio-events", () => ({ info: loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : [] }), [error, loading]);
  if (loading && rows.length === 0) return <LoadingState title="Loading portfolio events..." />;
  return <DataTableView<PortfolioEventRow, Column>
    focused={focused} rootWidth={width} rootHeight={height} columns={columns} items={sortedRows}
    selection={{ kind: "index", selectedIndex: selectedIdx, onChange: setSelectedIdx }}
    onActivate={(row) => navigateTicker(row.symbol)} onRootKeyDown={handleKeyDown}
    sortColumnId={sortPreference.columnId} sortDirection={sortPreference.direction}
    onHeaderClick={(id) => setSortPreference((current) => nextSortPreference(current, id as ColumnId, { defaultDirection: id === "date" ? "asc" : "asc" }))}
    getItemKey={(row) => row.id} renderCell={renderCell} emptyStateTitle={tickers.length === 0 ? "No tickers in scope." : error ?? "No portfolio events found"}
  />;
}
