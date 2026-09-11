import { useCallback, useMemo, useState } from "react";
import { Box, TextAttributes } from "../../../ui";
import {
  DataTableView,
  EmptyState,
  Spinner,
  unavailableText,
  usePaneFooter,
  type DataTableCell,
  type DataTableKeyEvent,
  type PaneHint,
} from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import type { TickerFinancials } from "../../../types/financials";
import { useAssetData } from "../../runtime";
import { useBoundTicker, useTickerRequest } from "../shared/ticker-request";
import { usePaneFooterHintBindings } from "../shared/pane-footer";
import { handleRefreshKey, loadingErrorFooterInfo } from "../shared/table-pane";
import {
  buildAumColumns,
  buildAumMetrics,
  buildAumRows,
  DEFAULT_AUM_SORT,
  nextAumSort,
  sortAumRows,
  type AumColumn,
  type AumRow,
  type AumSortPreference,
} from "./model";

export function AumPane({
  focused,
  width,
  height,
}: {
  focused: boolean;
  width: number;
  height: number;
}) {
  const dataProvider = useAssetData();
  const { symbol, exchange } = useBoundTicker();

  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider) throw new Error("Market data unavailable");
    return dataProvider.getTickerFinancials(
      nextSymbol,
      nextExchange,
      forceRefresh ? { cacheMode: "refresh" } : undefined,
    );
  }, [dataProvider]);

  const { data, loading, error, reload } = useTickerRequest<TickerFinancials>(loader, symbol, exchange);

  const [sortPreference, setSortPreference] = useState<AumSortPreference>(DEFAULT_AUM_SORT);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const metrics = useMemo(
    () => (data ? buildAumMetrics(data.quote, data.fundamentals, data.annualStatements) : null),
    [data],
  );
  const rows = useMemo(() => (metrics ? buildAumRows(metrics) : []), [metrics]);
  const sortedRows = useMemo(() => sortAumRows(rows, sortPreference), [rows, sortPreference]);
  const columns = useMemo(() => buildAumColumns(), []);

  const refresh = useCallback(() => reload(), [reload]);

  const hints = useMemo<PaneHint[]>(() => [
    { id: "refresh", key: "r", label: "efresh", onPress: refresh, disabled: loading },
  ], [loading, refresh]);

  usePaneFooter("assets-under-management", () => ({
    info: loadingErrorFooterInfo(loading, symbol ? error : null),
    hints,
  }), [error, hints, loading, symbol]);
  usePaneFooterHintBindings(focused, hints);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextAumSort(current, columnId));
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    return handleRefreshKey(event, refresh, { stopPropagation: true });
  }, [refresh]);

  const renderCell = useCallback((
    row: AumRow,
    column: AumColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    if (column.id === "metric") {
      return { text: row.label, color: selectedColor ?? colors.textDim };
    }

    let color: string | undefined;
    if (selectedColor) {
      color = selectedColor;
    } else if (row.key === "marketCap") {
      // Market cap is green whenever it is present; N/A renders dim.
      color = row.sortValue != null ? colors.positive : colors.textDim;
    } else if (row.key === "navPremiumDiscount") {
      color = row.sortValue != null ? priceColor(row.sortValue) : colors.textDim;
    } else if (row.plain) {
      color = colors.text;
    } else {
      color = row.sortValue != null ? colors.text : colors.textDim;
    }
    return {
      text: row.value,
      color,
      attributes: row.bold ? TextAttributes.BOLD : undefined,
    };
  }, []);

  if (!symbol) {
    return <EmptyState title="No ticker selected." message="Select a ticker to view AUM and fund size metrics." />;
  }
  if (loading && !data) {
    return <Spinner label="Loading AUM data..." />;
  }
  if (error && !data) {
    return <EmptyState title={unavailableText("AUM data")} message={error} />;
  }
  if (!metrics || rows.length === 0) {
    return (
      <EmptyState
        title="No AUM data"
        message={`No market cap or balance-sheet data found for ${symbol}.`}
      />
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box flexGrow={1}>
        <DataTableView<AumRow, AumColumn>
          focused={focused}
          rootWidth={width}
          rootHeight={height}
          selection={{
            kind: "index",
            selectedIndex: Math.min(selectedIdx, sortedRows.length - 1),
            onChange: (index) => setSelectedIdx(index),
          }}
          onRootKeyDown={handleKeyDown}
          resetScrollKey={symbol}
          columns={columns}
          items={sortedRows}
          sortColumnId={sortPreference.columnId}
          sortDirection={sortPreference.direction}
          onHeaderClick={handleHeaderClick}
          getItemKey={(row) => row.key}
          renderCell={renderCell}
          emptyStateTitle="No AUM data"
          emptyStateMessage={`No market cap or balance-sheet data found for ${symbol}.`}
        />
      </Box>
    </Box>
  );
}
