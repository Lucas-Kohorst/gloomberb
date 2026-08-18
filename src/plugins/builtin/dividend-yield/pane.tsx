import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShortcut } from "../../../react/input";
import {
  DataTableView,
  EmptyState,
  Spinner,
  StaticChartSurface,
  usePaneFooter,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatNumber, formatPercentRaw } from "../../../utils/format";
import { resolveChartPalette } from "../../../components/chart/core/renderer";
import type { ProjectedChartPoint } from "../../../components/chart/core/data";
import { usePaneTicker } from "../../../state/app/context";
import { fetchDividendData } from "./client";
import type { DividendMetrics, DividendPayment } from "./types";
import type { DividendData } from "./client";
import {
  buildDividendColumns,
  nextSortPreference,
  sortRows,
  toDividendRows,
  DEFAULT_SORT_PREFERENCE,
  type DividendColumn,
  type DividendRow,
  type DividendSortPreference,
} from "./model";

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

function buildYieldChartPoints(payments: DividendPayment[], currentPrice: number | null): ProjectedChartPoint[] {
  if (payments.length === 0 || currentPrice == null || currentPrice <= 0) return [];
  const sorted = [...payments].sort((a, b) => a.exDate.getTime() - b.exDate.getTime());
  const DAY = 24 * 60 * 60 * 1000;
  const points: ProjectedChartPoint[] = [];

  for (const payment of sorted) {
    const trailingCutoff = new Date(payment.exDate.getTime() - 365 * DAY);
    const trailingSum = sorted
      .filter((p) => p.exDate >= trailingCutoff && p.exDate <= payment.exDate)
      .reduce((sum, p) => sum + p.amount, 0);
    const yieldPct = (trailingSum / currentPrice) * 100;
    points.push({
      date: payment.exDate,
      open: yieldPct,
      high: yieldPct,
      low: yieldPct,
      close: yieldPct,
      volume: 0,
    });
  }

  return points;
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
    case "paymentDate":
      return { text: row.paymentDate, color: selectedColor ?? colors.textDim };
    case "amount":
      return {
        text: formatNumber(row.amount, 4),
        color: selectedColor ?? colors.textBright,
        attributes: TextAttributes.BOLD,
      };
    case "type":
      return { text: row.type, color: selectedColor ?? colors.textDim };
    case "currency":
      return { text: row.currency, color: selectedColor ?? colors.textDim };
  }
}

export function DividendYieldPane({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const { ticker } = usePaneTicker();
  const symbol = ticker?.metadata.ticker ?? null;
  const currency = ticker?.metadata.currency ?? "USD";
  const currentPrice = ticker?.metadata ? null : null;

  const [data, setData] = useState<DividendData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<DividendSortPreference>(DEFAULT_SORT_PREFERENCE);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const fetchGenRef = useRef(0);

  const load = useCallback(async (sym: string) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDividendData(sym, null);
      if (fetchGenRef.current !== gen) return;
      setData(result);
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (symbol) load(symbol);
  }, [symbol, load]);

  useShortcut((ev) => {
    if (!focused || !symbol) return;
    if (ev.name === "r") {
      ev.preventDefault?.();
      load(symbol);
    }
  });

  const refresh = useCallback(() => {
    if (symbol) load(symbol);
  }, [load, symbol]);

  usePaneFooter("dividend-yield", () => ({
    info: [
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: refresh }],
  }), [error, loading, refresh]);

  const payments = data?.payments ?? [];
  const metrics = data?.metrics;
  const rows = useMemo(() => toDividendRows(payments), [payments]);
  const sortedRows = useMemo(() => sortRows(rows, sortPreference), [rows, sortPreference]);
  const columns = useMemo(() => buildDividendColumns(width), [width]);
  const metricRows = useMemo(() => (metrics ? buildMetricRows(metrics, currency) : []), [metrics, currency]);
  const chartPoints = useMemo(() => buildYieldChartPoints(payments, null), [payments]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      refresh();
      return true;
    }
    return false;
  }, [refresh]);

  if (!symbol) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Text fg={colors.textDim}>Select a ticker to view dividend data.</Text>
      </Box>
    );
  }

  if (loading && !data) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Loading dividend data..." />
      </Box>
    );
  }

  if (error && !data) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Text fg={colors.negative}>{error}</Text>
      </Box>
    );
  }

  if (payments.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <EmptyState title="No dividend history" message={`${symbol} does not appear to pay dividends.`} />
      </Box>
    );
  }

  const chartWidth = Math.max(10, width - 2);
  const chartHeight = Math.min(12, Math.max(6, Math.floor(height * 0.3)));
  const palette = resolveChartPalette(colors, "positive");
  const metricColWidth = Math.max(16, Math.floor((width - 2) / 2));

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ScrollBox flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column">
          {/* Metrics section */}
          {metricRows.length > 0 && (
            <Box flexDirection="column" paddingX={1} marginTop={1}>
              {metricRows.map((row, i) => (
                <Box key={i} height={1} flexDirection="row" justifyContent="space-between">
                  <Text fg={colors.textDim}>{row.label.padEnd(metricColWidth - 12)}</Text>
                  <Text
                    fg={row.color ?? colors.text}
                    attributes={row.bold ? TextAttributes.BOLD : undefined}
                  >
                    {row.value}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {/* Yield chart */}
          {chartPoints.length >= 2 && (
            <Box flexDirection="column" paddingX={1} marginTop={1}>
              <StaticChartSurface
                points={chartPoints}
                width={chartWidth}
                height={chartHeight}
                mode="line"
                colors={palette}
                yAxisLabel="Yield %"
                yAxisColor={colors.textDim}
                formatYAxisValue={(value) => `${value.toFixed(2)}%`}
              />
            </Box>
          )}

          {/* Payment history table */}
          <Box flexDirection="column" marginTop={1}>
            <DataTableView<DividendRow, DividendColumn>
              focused={focused}
              selection={{
                kind: "index",
                selectedIndex: Math.min(selectedIdx, sortedRows.length - 1),
                onChange: (index) => setSelectedIdx(index),
              }}
              onRootKeyDown={handleKeyDown}
              rootWidth={width}
              rootHeight={Math.max(6, height - chartHeight - metricRows.length - 4)}
              columns={columns}
              items={sortedRows}
              sortColumnId={sortPreference.columnId}
              sortDirection={sortPreference.direction}
              onHeaderClick={handleHeaderClick}
              getItemKey={(row) => row.key}
              renderCell={renderCell}
              emptyStateTitle="No dividend payments"
            />
          </Box>
        </Box>
      </ScrollBox>
    </Box>
  );
}
