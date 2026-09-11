import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import {
  DataTableView,
  StaticChartSurface,
  usePaneFooter,
  usePaneTicker,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../components";
import type { ProjectedChartPoint } from "../../../components/chart/core/data";
import { resolveChartPalette } from "../../../components/chart/core/palette";
import { colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatNumber, formatPercentRaw } from "../../../utils/format";
import { handleRefreshKey, loadingErrorFooterInfo } from "../shared/table-pane";
import { fetchDividendData, type DividendData } from "./client";
import {
  buildDividendColumns,
  buildYieldChartPoints,
  DEFAULT_SORT_PREFERENCE,
  nextSortPreference,
  sortRows,
  toDividendRows,
  type DividendColumn,
  type DividendRow,
  type DividendSortPreference,
} from "./model";
import type { DividendMetrics } from "./types";

function formatYield(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function formatRate(value: number | null, currency: string): string {
  if (value == null) return "—";
  return formatCurrency(value, currency);
}

function formatGrowth(value: number | null): string {
  if (value == null) return "—";
  return formatPercentRaw(value * 100);
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function formatFrequency(freq: DividendMetrics["paymentFrequency"]): string {
  if (!freq) return "—";
  switch (freq) {
    case "monthly": return "Monthly";
    case "quarterly": return "Quarterly";
    case "semi-annual": return "Semi-Annual";
    case "annual": return "Annual";
    case "irregular": return "Irregular";
  }
}

interface MetricRow {
  label: string;
  value: string;
  color?: string;
  bold?: boolean;
}

function buildMetricRows(metrics: DividendMetrics, currency: string): MetricRow[] {
  return [
    { label: "Trailing Yield", value: formatYield(metrics.trailingYield), color: priceColor(metrics.trailingYield ?? 0), bold: true },
    { label: "Forward Yield", value: formatYield(metrics.forwardYield), color: priceColor(metrics.forwardYield ?? 0) },
    { label: "Trailing Rate", value: formatRate(metrics.trailingRate, currency) },
    { label: "Forward Rate", value: formatRate(metrics.forwardRate, currency) },
    { label: "1Y Growth", value: formatGrowth(metrics.growth1Y), color: priceColor(metrics.growth1Y ?? 0) },
    { label: "3Y Growth", value: formatGrowth(metrics.growth3Y), color: priceColor(metrics.growth3Y ?? 0) },
    { label: "Payout Ratio", value: metrics.payoutRatio != null ? `${(metrics.payoutRatio * 100).toFixed(1)}%` : "—" },
    { label: "Frequency", value: formatFrequency(metrics.paymentFrequency) },
    { label: "Ex-Dividend", value: formatDate(metrics.exDividendDate) },
    { label: "Next Pay", value: formatDate(metrics.nextPayDate) },
  ];
}

function renderMetricCell(row: MetricRow, width: number) {
  const valueWidth = Math.min(row.value.length, Math.max(6, width - 8));
  const labelWidth = Math.max(8, width - valueWidth - 1);
  return (
    <Box height={1} flexDirection="row">
      <Text fg={colors.textDim}>{row.label.slice(0, labelWidth).padEnd(labelWidth)}</Text>
      <Text
        fg={row.color ?? colors.text}
        attributes={row.bold ? TextAttributes.BOLD : undefined}
      >
        {row.value}
      </Text>
    </Box>
  );
}

const MIN_METRIC_COLUMN_WIDTH = 18;

function DividendSummary({
  metrics,
  currency,
  width,
  chartHeight,
  chartPoints,
}: {
  metrics: DividendMetrics;
  currency: string;
  width: number;
  chartHeight: number;
  chartPoints: ProjectedChartPoint[];
}) {
  const metricRows = buildMetricRows(metrics, currency);
  // Two 18-cell blocks overflow anything narrower than 38 cells, so collapse.
  const columnCount = width - 2 >= MIN_METRIC_COLUMN_WIDTH * 2 ? 2 : 1;
  const colWidth = Math.max(MIN_METRIC_COLUMN_WIDTH, Math.floor((width - 2) / columnCount));
  const rowCount = Math.ceil(metricRows.length / columnCount);
  const palette = resolveChartPalette(colors, "positive");
  const last = chartPoints[chartPoints.length - 1];
  const first = chartPoints[0];
  const delta = last && first && first.close ? ((last.close - first.close) / first.close) * 100 : null;

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="column" paddingX={1} height={rowCount}>
        {Array.from({ length: rowCount }, (_, i) => {
          const left = metricRows[i * columnCount]!;
          const right = columnCount > 1 ? metricRows[i * columnCount + 1] : undefined;
          return (
            <Box key={left.label} height={1} flexDirection="row">
              <Box width={colWidth}>{renderMetricCell(left, colWidth)}</Box>
              {right ? <Box width={colWidth}>{renderMetricCell(right, colWidth)}</Box> : null}
            </Box>
          );
        })}
      </Box>
      {chartPoints.length >= 2 && chartHeight > 0 && (
        <Box flexDirection="column" paddingX={1} height={chartHeight} marginTop={1}>
          {last ? (
            <Box height={1} flexDirection="row">
              <Text fg={colors.textDim}>TTM yield</Text>
              <Box width={1} />
              <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
                {last.close.toFixed(2)}%
              </Text>
              {delta != null && (
                <>
                  <Box width={1} />
                  <Text fg={priceColor(delta)}>{formatPercentRaw(delta)}</Text>
                </>
              )}
            </Box>
          ) : null}
          <StaticChartSurface
            points={chartPoints}
            width={Math.max(24, width - 2)}
            height={Math.max(4, chartHeight - (last ? 1 : 0))}
            mode="area"
            colors={palette}
            showTimeAxis
            timeAxisColor={colors.textDim}
            yAxisColor={colors.textDim}
            formatYAxisValue={(value) => `${value.toFixed(2)}%`}
          />
        </Box>
      )}
    </Box>
  );
}

function renderCell(
  row: DividendRow,
  column: DividendColumn,
  _index: number,
  rowState: { selected: boolean },
): DataTableCell {
  const selectedColor = rowState.selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "exDate":
      return { text: row.exDate, color: selectedColor ?? colors.textDim };
    case "amount":
      return {
        text: formatNumber(row.amount, 4),
        color: selectedColor ?? colors.textBright,
        attributes: TextAttributes.BOLD,
      };
    case "currency":
      return { text: row.currency, color: selectedColor ?? colors.textDim };
  }
}

export function DividendYieldPane({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const { symbol, ticker, financials } = usePaneTicker();
  const currency = ticker?.metadata.currency ?? "USD";
  const exchange = ticker?.metadata.exchange ?? "";
  const quotePrice = financials?.quote?.price ?? null;

  const [data, setData] = useState<DividendData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<DividendSortPreference>(DEFAULT_SORT_PREFERENCE);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const fetchGenRef = useRef(0);

  const load = useCallback(async (sym: string, price: number | null, listingExchange = "") => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDividendData(sym, price, listingExchange);
      if (fetchGenRef.current !== gen) return;
      setData(result);
      setSelectedIdx(0);
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, []);

  // Ten years of history must not be refetched on every live price tick, so the
  // quote is read through a ref instead of being an effect dependency.
  const quotePriceRef = useRef(quotePrice);
  quotePriceRef.current = quotePrice;

  useEffect(() => {
    if (!symbol) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    void load(symbol, quotePriceRef.current, exchange);
  }, [exchange, load, symbol]);

  const refresh = useCallback(() => {
    if (symbol) void load(symbol, quotePriceRef.current, exchange);
  }, [exchange, load, symbol]);

  usePaneFooter("dividend-yield", () => ({
    info: loadingErrorFooterInfo(loading, error),
  }), [error, loading]);

  const payments = data?.payments ?? [];
  const eps = financials?.fundamentals?.eps;
  const metrics = data?.metrics && data.metrics.payoutRatio == null
    && eps != null && eps > 0 && data.metrics.trailingRate != null
    ? { ...data.metrics, payoutRatio: data.metrics.trailingRate / eps }
    : data?.metrics;
  const rows = useMemo(() => toDividendRows(payments), [payments]);
  const sortedRows = useMemo(() => sortRows(rows, sortPreference), [rows, sortPreference]);
  const columns = useMemo(() => buildDividendColumns(), []);
  const chartPoints = useMemo(
    () => buildYieldChartPoints(payments, data?.price ?? quotePrice, data?.history ?? []),
    [data?.history, data?.price, payments, quotePrice],
  );
  const metricRowCount = width - 2 >= MIN_METRIC_COLUMN_WIDTH * 2 ? 5 : 10;
  const showChart = chartPoints.length >= 2;
  const chartHeight = showChart
    ? Math.max(12, Math.min(22, Math.floor((height - metricRowCount) * 0.45)))
    : 0;
  const tableHeight = Math.max(8, height - metricRowCount - (showChart ? chartHeight + 1 : 0));

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    return handleRefreshKey(event, refresh, { stopPropagation: true });
  }, [refresh]);

  const emptyTitle = !symbol
    ? "No ticker selected."
    : loading
      ? "Loading dividends..."
      : error ?? "No dividend history";

  return (
    <Box flexDirection="column" width={width} height={height}>
      {metrics ? (
        <DividendSummary
          metrics={metrics}
          currency={payments[0]?.currency ?? currency}
          width={width}
          chartHeight={chartHeight}
          chartPoints={chartPoints}
        />
      ) : null}
      <Box flexGrow={1} minHeight={8}>
        <DataTableView<DividendRow, DividendColumn>
          focused={focused}
          selection={{
            kind: "index",
            selectedIndex: sortedRows.length === 0 ? null : Math.min(selectedIdx, sortedRows.length - 1),
            onChange: (index) => setSelectedIdx(index),
          }}
          onRootKeyDown={handleKeyDown}
          resetScrollKey={symbol}
          rootWidth={width}
          rootHeight={metrics ? tableHeight : height}
          columns={columns}
          items={sortedRows}
          sortColumnId={sortPreference.columnId}
          sortDirection={sortPreference.direction}
          onHeaderClick={handleHeaderClick}
          getItemKey={(row) => row.key}
          renderCell={renderCell}
          emptyStateTitle={emptyTitle}
        />
      </Box>
    </Box>
  );
}
