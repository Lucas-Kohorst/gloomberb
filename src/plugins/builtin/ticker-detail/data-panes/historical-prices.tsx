import { useCallback, useMemo, useState } from "react";
import { TextAttributes } from "../../../../ui";
import {
  DataTableView,
  loadingText,
  unavailableText,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../../components";
import { TIME_RANGES, type TimeRange } from "../../../../time-series/range";
import type { PaneProps } from "../../../../types/plugin";
import type { PricePoint } from "../../../../types/financials";
import { colors, priceColor } from "../../../../theme/colors";
import { formatCompact, formatNumber, formatPercent } from "../../../../utils/format";
import {
  applySortPreference,
  nextSortPreference,
  type SortPreference,
} from "../../../../utils/sort-values";
import {
  useAssetData,
  useDebouncedPluginPaneState,
  usePluginPaneState,
} from "../../../runtime";
import { loadingErrorFooterInfo, useClampSelectedIndex } from "../../shared/table-pane";
import { formatDateTime, useBoundTicker, useTickerRequest } from "../../shared/ticker-request";

type HistoryColumnId = "date" | "open" | "high" | "low" | "close" | "change" | "changePercent" | "volume";
type HistoryColumn = DataTableColumn & { id: HistoryColumnId };

export type HistoricalPriceRow = {
  key: string;
  point: PricePoint;
  date: string;
  change: number | null;
  changePercent: number | null;
};

function pricePointDate(point: PricePoint): Date | null {
  const value = point.date as Date | string | number;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatMaybePrice(value: number | undefined): string {
  return value == null ? "—" : formatNumber(value, 2);
}

function formatMaybePercent(value: number | null): string {
  return value == null ? "—" : formatPercent(value);
}

function formatMaybeCompact(value: number | undefined): string {
  return value == null ? "—" : formatCompact(value);
}

export function buildHistoricalPriceRows(points: PricePoint[]): HistoricalPriceRow[] {
  const sorted = points
    .flatMap((point, sourceIndex) => {
      const date = pricePointDate(point);
      return date ? [{ point, date, sourceIndex }] : [];
    })
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  return sorted.map((entry, index) => {
    const previous = sorted[index - 1]?.point;
    const { point, date, sourceIndex } = entry;
    const change = previous ? point.close - previous.close : null;
    return {
      key: `${date.toISOString()}:${sourceIndex}`,
      point,
      date: formatDateTime(date),
      change,
      changePercent: previous?.close ? change! / previous.close : null,
    };
  }).reverse();
}

function buildHistoryColumns(): HistoryColumn[] {
  return [
    { id: "date", label: "DATE/TIME", width: 16, align: "left" },
    { id: "open", label: "OPEN", width: 10, align: "right" },
    { id: "high", label: "HIGH", width: 10, align: "right" },
    { id: "low", label: "LOW", width: 10, align: "right" },
    { id: "close", label: "CLOSE", width: 10, align: "right" },
    { id: "change", label: "CHG", width: 10, align: "right" },
    { id: "changePercent", label: "CHG %", width: 9, align: "right" },
    { id: "volume", label: "VOLUME", width: 9, align: "right", flexGrow: 1 },
  ];
}

function nextHistoryRange(current: TimeRange): TimeRange {
  const index = TIME_RANGES.indexOf(current);
  return TIME_RANGES[(index + 1) % TIME_RANGES.length] ?? "1Y";
}

export function HistoricalPricesPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { symbol, exchange } = useBoundTicker();
  const [range, setRange] = usePluginPaneState<TimeRange>("range", "1Y");
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider) throw new Error("Market data unavailable");
    return dataProvider.getPriceHistory(
      nextSymbol,
      nextExchange,
      range,
      forceRefresh ? { cacheMode: "refresh" } : undefined,
    );
  }, [dataProvider, range]);
  const { data, loading, error, reload } = useTickerRequest<PricePoint[]>(loader, symbol, exchange);
  const [sortPreference, setSortPreference] = useState<SortPreference<HistoryColumnId>>({
    columnId: "date",
    direction: "desc",
  });
  const rows = useMemo(() => applySortPreference(
    buildHistoricalPriceRows(data ?? []),
    sortPreference,
    (row, columnId) => {
      switch (columnId) {
        case "date": return pricePointDate(row.point)?.getTime() ?? null;
        case "open": return row.point.open ?? null;
        case "high": return row.point.high ?? null;
        case "low": return row.point.low ?? null;
        case "close": return row.point.close;
        case "change": return row.change;
        case "changePercent": return row.changePercent;
        case "volume": return row.point.volume ?? null;
      }
    },
  ), [data, sortPreference]);
  const columns = useMemo(() => buildHistoryColumns(), []);
  const boundedSelectedIdx = rows.length > 0 ? Math.min(selectedIdx, rows.length - 1) : -1;
  const cycleRange = useCallback(() => setRange((current) => nextHistoryRange(current)), [setRange]);

  useClampSelectedIndex(rows.length, selectedIdx, setSelectedIdx);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      reload();
      return true;
    }
    if (event.name === "t") {
      event.preventDefault?.();
      cycleRange();
      return true;
    }
    return false;
  }, [cycleRange, reload]);

  const renderCell = useCallback((
    row: HistoricalPriceRow,
    column: HistoryColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "date":
        return { text: row.date, color: selectedColor ?? colors.textDim };
      case "open":
        return { text: formatMaybePrice(row.point.open), color: selectedColor ?? colors.text };
      case "high":
        return { text: formatMaybePrice(row.point.high), color: selectedColor ?? colors.text };
      case "low":
        return { text: formatMaybePrice(row.point.low), color: selectedColor ?? colors.text };
      case "close":
        return { text: formatNumber(row.point.close, 2), color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "change":
        return { text: row.change == null ? "—" : formatNumber(row.change, 2), color: selectedColor ?? priceColor(row.change ?? 0) };
      case "changePercent":
        return { text: formatMaybePercent(row.changePercent), color: selectedColor ?? priceColor(row.changePercent ?? 0) };
      case "volume":
        return { text: formatMaybeCompact(row.point.volume), color: selectedColor ?? colors.textDim };
    }
  }, []);

  usePaneFooter("historical-prices", () => ({
    info: [
      { id: "range", parts: [{ text: range, tone: "muted" as const }] },
      ...loadingErrorFooterInfo(loading, error),
    ],
    hints: [
      { id: "range", key: "t", label: "oggle range", onPress: cycleRange },
    ],
  }), [cycleRange, error, loading, range]);

  return (
    <DataTableView<HistoricalPriceRow, HistoryColumn>
      focused={focused}
      selection={{
        kind: "index",
        selectedIndex: boundedSelectedIdx,
        onChange: (index) => setSelectedIdx(index),
      }}
      onRootKeyDown={handleKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(
        current,
        columnId as HistoryColumnId,
        { defaultDirection: "desc" },
      ))}
      getItemKey={(row) => row.key}
      getRowRevision={(row) => `${row.key}:${row.point.close}:${row.point.volume ?? ""}:${row.change ?? ""}`}
      renderCell={renderCell}
      emptyStateTitle={error
        ? unavailableText("Historical prices")
        : loading
          ? loadingText("historical prices")
          : "No historical prices"}
      emptyStateHint={error ?? undefined}
    />
  );
}
