import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTableView, LoadingState, type DataTableCell, type DataTableColumn, type DataTableKeyEvent, type PaneFooterSegment } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { TextAttributes } from "../../../ui";
import { useAppSelector, usePaneCollection, usePaneInstance } from "../../../state/app/context";
import { useAssetData, usePluginTickerActions } from "../../runtime";
import { getCollectionTickersFromConfig } from "../portfolio-list/pane/data";
import { handleRefreshKey } from "../shared/table-pane";
import { usePaneStatusFooter } from "../shared/pane-footer";
import { colors } from "../../../theme/colors";
import { mapPool } from "../../../utils/map-pool";
import { applySortPreference, nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { buildPortfolioEventRows, resolvePortfolioEventsCollectionId, type PortfolioEventRow } from "./portfolio-events-model";
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

/** A collection can hold hundreds of tickers, and each one is its own request. */
const CORPORATE_ACTIONS_CONCURRENCY = 4;

type TickerEvents = { data: CorporateActionsData | null; name?: string; failed?: boolean };

export function PortfolioEventsPane({ focused, width, height }: PaneProps) {
  const provider = useAssetData();
  const { navigateTicker } = usePluginTickerActions();
  const { collectionId: boundCollectionId } = usePaneCollection();
  const paneInstance = usePaneInstance();
  const config = useAppSelector((state) => state.config);
  const collectionId = useMemo(
    () => resolvePortfolioEventsCollectionId(config, paneInstance?.settings, boundCollectionId),
    [boundCollectionId, config, paneInstance?.settings],
  );
  const tickerMap = useAppSelector((state) => state.tickers);
  const tickers = useMemo(() => getCollectionTickersFromConfig(config, tickerMap, collectionId), [collectionId, config, tickerMap]);
  const [data, setData] = useState<Map<string, TickerEvents>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failedCount, setFailedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortPreference, setSortPreference] = useState<SortPreference<ColumnId>>({ columnId: "date", direction: "asc" });
  const requestRef = useRef(0);

  const reload = useCallback(() => {
    const getCorporateActions = provider?.getCorporateActions;
    // Re-scoping the pane starts a new fetch while the old one is still in
    // flight, so a superseded batch must not land on the newer collection.
    requestRef.current += 1;
    const requestId = requestRef.current;
    if (!getCorporateActions || tickers.length === 0) {
      setData(new Map()); setFailedCount(0); setError(null); setLoading(false);
      return;
    }
    setLoading(true); setError(null);
    void mapPool(tickers, CORPORATE_ACTIONS_CONCURRENCY, async (ticker): Promise<[string, TickerEvents]> => {
      try { return [ticker.metadata.ticker, { data: await getCorporateActions(ticker.metadata.ticker, ticker.metadata.exchange), name: ticker.metadata.name }]; }
      catch { return [ticker.metadata.ticker, { data: null, name: ticker.metadata.name, failed: true }]; }
    }).then((entries) => {
      if (requestRef.current !== requestId) return;
      const failed = entries.filter(([, entry]) => entry.failed).length;
      setData(new Map(entries));
      setFailedCount(failed);
      // Every request failing reads as "no events" otherwise, which is a
      // different answer from "the provider never replied".
      setError(failed > 0 && failed === entries.length ? "events unavailable" : null);
    }).finally(() => {
      if (requestRef.current === requestId) setLoading(false);
    });
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
  // A partial failure still fills the table, so the gap only shows up here.
  const partialInfo = useMemo<PaneFooterSegment[]>(() => (
    !error && failedCount > 0 && tickers.length > 0
      ? [{ id: "partial", parts: [{ text: `${failedCount}/${tickers.length} unavailable`, tone: "warning" as const }] }]
      : []
  ), [error, failedCount, tickers.length]);
  usePaneStatusFooter({ registrationId: "portfolio-events", loading, error, info: partialInfo });
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
