import { useCallback, useMemo, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import {
  DataTableView,
  EmptyState,
  Spinner,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import type { PricePoint } from "../../../types/financials";
import { colors } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import { useShortcut } from "../../../react/input";
import { useAssetData } from "../../runtime";
import { handleRefreshKey, loadingErrorFooterInfo, useClampSelectedIndex } from "../shared/table-pane";
import { useBoundTicker, useTickerRequest } from "../shared/ticker-request";
import { detectPatterns } from "../shared/indicators";
import {
  buildPatternRows,
  DEFAULT_PATTERN_SORT,
  nextPatternSortPreference,
  sortPatternRows,
  type PatternRecognitionRow,
  type PatternSortPreference,
} from "./model";

type PatternColumnId = PatternSortPreference["columnId"];
type PatternColumn = DataTableColumn & { id: PatternColumnId };

const PATTERN_COLUMNS: PatternColumn[] = [
  { id: "type", label: "PATTERN", width: 24, align: "left" },
  { id: "confidence", label: "CONFIDENCE", width: 13, align: "right" },
  { id: "dateRange", label: "DATE RANGE", width: 24, align: "left" },
  { id: "description", label: "DESCRIPTION", width: 36, align: "left", flexGrow: 1 },
];

export function PatternRecognitionPane({ focused, width, height }: Pick<PaneProps, "focused" | "width" | "height">) {
  const dataProvider = useAssetData();
  const { symbol, exchange } = useBoundTicker();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortPreference, setSortPreference] = useState<PatternSortPreference>(DEFAULT_PATTERN_SORT);

  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider) throw new Error("Market data unavailable");
    return dataProvider.getPriceHistory(
      nextSymbol,
      nextExchange,
      "1Y",
      forceRefresh ? { cacheMode: "refresh" } : undefined,
    );
  }, [dataProvider]);
  const { data, loading, error, reload } = useTickerRequest<PricePoint[]>(loader, symbol, exchange);
  const rows = useMemo(
    () => (data && data.length > 0 ? buildPatternRows(data, detectPatterns(data)) : []),
    [data],
  );
  const sortedRows = useMemo(
    () => sortPatternRows(rows, sortPreference),
    [rows, sortPreference],
  );
  const boundedSelectedIdx = sortedRows.length > 0 ? Math.min(selectedIdx, sortedRows.length - 1) : -1;

  useClampSelectedIndex(sortedRows.length, selectedIdx, setSelectedIdx);

  useShortcut((event) => {
    if (!focused) return;
    handleRefreshKey(event, reload, { stopPropagation: true });
  });

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => (
    handleRefreshKey(event, reload, { stopPropagation: true })
  ), [reload]);

  const renderCell = useCallback((
    row: PatternRecognitionRow,
    column: PatternColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "type":
        return {
          text: row.typeLabel,
          color: selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "confidence":
        return {
          text: formatPercentRaw(row.confidence * 100),
          color: selectedColor ?? colors.positive,
        };
      case "dateRange":
        return { text: row.dateRange, color: selectedColor ?? colors.textDim };
      case "description":
        return { text: row.description, color: selectedColor ?? colors.text };
    }
  }, []);

  usePaneFooter("pattern-recognition", () => ({
    info: loadingErrorFooterInfo(loading, error),
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: reload },
    ],
  }), [error, loading, reload]);

  if (!symbol) {
    return <EmptyState title="No ticker selected." message="Select a ticker to detect chart patterns." />;
  }

  if (loading && !data) {
    return <Spinner label="Loading price history..." />;
  }

  if (error && !data) {
    return <EmptyState title="Pattern recognition unavailable." message={error} />;
  }

  if (data && rows.length === 0) {
    return <EmptyState title="No chart patterns detected in the current lookback window." />;
  }

  return (
    <DataTableView<PatternRecognitionRow, PatternColumn>
      focused={focused}
      selection={{
        kind: "index",
        selectedIndex: boundedSelectedIdx,
        onChange: setSelectedIdx,
      }}
      onRootKeyDown={handleKeyDown}
      resetScrollKey={symbol}
      rootWidth={width}
      rootHeight={height}
      columns={PATTERN_COLUMNS}
      items={sortedRows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextPatternSortPreference(current, columnId))}
      getItemKey={(row) => row.key}
      renderCell={renderCell}
      emptyStateTitle="No chart patterns detected in the current lookback window."
    />
  );
}
