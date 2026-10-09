import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  PaneStatusBody,
  QueryBar,
  usePaneStatusFooter,
  useQueryBarSearch,
  type DataTableCell,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, usePaneInstance, usePluginPaneState, usePluginTickerActions } from "../../../public/react";
import { usePaneTickerIdentity } from "../../../state/hooks/pane-ticker";
import { useThemeColors } from "../../../theme/theme-context";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PaneProps } from "../../../types/plugin";
import { Box, TextAttributes } from "../../../ui";
import { formatNumber } from "../../../utils/format";
import { nextHeaderSort } from "../../../utils/sort-values";
import { fetchFails } from "./client";
import {
  DEFAULT_FAIL_SORT,
  FAILS_PANE_ID,
  buildFailColumns,
  failSymbolFilter,
  formatFailPrice,
  resolveFailSymbol,
  sortFails,
  type FailColumn,
  type FailColumnId,
  type FailRow,
  type FailSort,
} from "./model";

const NO_ROWS: FailRow[] = [];

export function FailsToDeliverPane({ focused, width, height }: Pick<PaneProps, "width" | "height" | "focused">) {
  const colors = useThemeColors();
  const { pinTicker } = usePluginTickerActions();
  const commandSymbol = failSymbolFilter(usePaneInstance());
  const { symbol: linkedSymbol } = usePaneTickerIdentity();
  const [search, setSearch] = usePluginPaneState("fail-symbol", "");
  const { active: searchActive, searchProps } = useQueryBarSearch();
  const symbol = resolveFailSymbol(search, commandSymbol, linkedSymbol ?? "");
  // Posted twice a month, so this loads on open and on r, not on the poll interval.
  const request = useCallback(() => fetchFails(symbol), [symbol]);
  const resource = useAsyncResource(request);
  const report = resource.data;
  const [sort, setSort] = useState<FailSort>(DEFAULT_FAIL_SORT);
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", null);
  const rows = useMemo(() => sortFails(report?.rows ?? NO_ROWS, sort), [report?.rows, sort]);
  const columns = useMemo(() => buildFailColumns(width), [width]);

  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId, setSelectedId]);

  const refresh = useCallback(() => { void resource.reload(); }, [resource.reload]);
  usePaneRefreshKey(refresh, { focused, enabled: !searchActive });

  const info = useMemo(() => (
    report?.settlementDate
      ? [{ id: "settlement", parts: [{ text: report.settlementDate, tone: "muted" as const }] }]
      : []
  ), [report?.settlementDate]);
  usePaneStatusFooter({
    registrationId: FAILS_PANE_ID,
    loading: resource.loading && !!report,
    error: resource.error,
    info,
  });

  const onHeaderClick = useCallback((columnId: string) => {
    setSort((current) => nextHeaderSort(current, columnId as FailColumnId, {
      firstDirection: (id) => id === "quantity" || id === "price" || id === "date" ? "desc" : "asc",
      resetTo: DEFAULT_FAIL_SORT,
    }));
  }, []);
  const openRow = useCallback((row: FailRow) => {
    if (!row.symbol) return;
    pinTicker(row.symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
  }, [pinTicker]);
  const renderCell = useCallback((row: FailRow, column: FailColumn): DataTableCell => {
    switch (column.id) {
      case "symbol":
        return {
          text: row.symbol || "—",
          color: row.symbol ? colors.textBright : colors.textMuted,
          attributes: row.symbol ? TextAttributes.BOLD : undefined,
        };
      case "description":
        return { text: row.description, color: colors.text };
      case "quantity":
        return { text: formatNumber(row.quantity, 0), value: row.quantity, color: colors.text };
      case "price":
        return {
          text: formatFailPrice(row.price),
          value: row.price,
          color: row.price == null ? colors.textMuted : colors.text,
        };
      case "date":
        return { text: row.date, value: row.date, color: colors.textMuted };
    }
  }, [colors]);

  const symbolBar = (
    <QueryBar
      width={Math.max(1, width - 2)}
      search={{
        ...searchProps,
        value: search,
        onChange: setSearch,
        placeholder: "symbol",
        focused,
      }}
    />
  );
  const bodyHeight = Math.max(1, height - 1);

  if (!report && resource.loading) {
    return (
      <Box width={width} height={height} flexDirection="column">
        {symbolBar}
        <PaneStatusBody loading align="center" />
      </Box>
    );
  }
  if (!report && resource.error) {
    return (
      <Box width={width} height={height} flexDirection="column">
        {symbolBar}
        <PaneStatusBody error={resource.error} subject="fails" />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {symbolBar}
      <DataTableView<FailRow, FailColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={bodyHeight}
        columns={columns}
        items={rows}
        getItemKey={(row) => row.id}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={onHeaderClick}
        selectedTextOverridesCellColor
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        onActivate={openRow}
        renderCell={renderCell}
        emptyStateTitle={symbol ? `No fails for ${symbol}.` : "No fails reported."}
      />
    </Box>
  );
}
