import { useMemo } from "react";
import {
  ChartTableHeader,
  CompositeChart,
  formatBpAxis,
  formatPercentAxis,
  MarketBoardStack,
  PaneStatusBody,
  usePaneFooter,
  usePaneNoticeFooter,
  type MarketBoardRow,
  type PaneFooterSegment,
  type StatItem,
} from "../../../components";
import { staticSeries } from "../../../components/chart/static/series";
import { loadingErrorFooterInfo, usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { StatChartDetail } from "../../../components/market-board";
import { useAsyncResource } from "../../../react/async-resource";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { formatPercentileRank } from "../../../utils/format";
import { usePluginPaneState } from "../../runtime";
import type { PluginModule } from "../plugin-module";
import { useAutoRefresh } from "../../../react/auto-refresh";
import { getCachedCreditBoard, loadCreditBoard, type CreditYieldBoardRow } from "./client";
import { creditConditionsHeadless } from "./headless";
import { CREDIT_SERIES, type CreditConditionRow, type CreditYieldRow } from "./model";


const EMPTY_ROWS: CreditConditionRow[] = [];
const PANELS = [{ id: "main" }];

function formatBp(value: number | null, signed = false): string {
  if (value == null) return "--";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}bp`;
}

function formatYield(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}%`;
}

type CreditBoardRow = MarketBoardRow & (
  | { kind: "oas"; spread: CreditConditionRow }
  | { kind: "yield"; yieldRow: CreditYieldRow | null }
);

function boardRow(row: CreditConditionRow): CreditBoardRow {
  return {
    kind: "oas",
    id: row.seriesId, label: row.label, value: row.oasBp, valueText: formatBp(row.oasBp),
    change: row.dailyChangeBp, changeText: formatBp(row.dailyChangeBp, true),
    percentile: row.percentile1Y, asOf: row.date, status: row.stale ? "stale" : "available",
    history: row.history.map((point) => ({ date: new Date(point.date), close: point.valueBp })),
    spread: row,
  };
}

function yieldBoardRow(row: CreditYieldBoardRow): CreditBoardRow {
  if (row.status !== "available") {
    return {
      kind: "yield", id: row.seriesId, label: row.label, value: null, valueText: "unavailable",
      change: null, changeText: "--", percentile: null, asOf: null, history: [],
      status: "unavailable", yieldRow: null,
    };
  }
  return {
    kind: "yield",
    id: row.seriesId, label: row.label, value: row.yieldPct, valueText: formatYield(row.yieldPct),
    change: row.dailyChangeBp, changeText: formatBp(row.dailyChangeBp, true),
    percentile: row.percentile1Y, asOf: row.date, status: row.stale ? "stale" : "available",
    history: row.history.map((point) => ({ date: new Date(point.date), close: point.yieldPct })),
    yieldRow: row,
  };
}

function spreadHistorySeries(row: CreditConditionRow) {
  return [staticSeries(row.history.map((point) => ({
    date: new Date(point.date), observedAt: new Date(point.date), value: point.valueBp,
  })), { id: row.seriesId, label: `${row.label} OAS`, color: colors.positive, calendarSpaced: true })];
}

function spreadChart(row: CreditConditionRow) {
  return {
    series: spreadHistorySeries(row), formatValue: (value: number) => formatBp(value),
    formatAxisValue: formatBpAxis, remoteKind: "credit-spread-history",
    // An index without a history keeps the band, so the board does not jump under the cursor.
    empty: `No history for ${row.label}`,
  };
}

function yieldHistorySeries(row: CreditYieldRow) {
  return [staticSeries(row.history.map((point) => ({
    date: new Date(point.date), observedAt: new Date(point.date), value: point.yieldPct,
  })), { id: row.seriesId, label: row.label, color: colors.positive, calendarSpaced: true })];
}

function yieldChart(row: CreditYieldRow) {
  return {
    series: yieldHistorySeries(row), formatValue: (value: number) => formatYield(value),
    formatAxisValue: formatPercentAxis, remoteKind: "credit-yield-history",
    empty: `No history for ${row.label}`,
  };
}

function boardChart(row: CreditBoardRow) {
  if (row.kind === "oas") return spreadChart(row.spread);
  return row.yieldRow ? yieldChart(row.yieldRow) : {
    series: [], formatValue: (value: number) => formatYield(value), formatAxisValue: formatPercentAxis,
    remoteKind: "credit-yield-history", empty: `No history for ${row.label}`,
  };
}

function SpreadChart({ row, width, height, focused }: { row: CreditConditionRow; width: number; height: number; focused: boolean }) {
  const series = useMemo(() => spreadHistorySeries(row), [row]);
  return <CompositeChart series={series} panels={PANELS} width={width} height={height} focused={focused} showLegend={false}
    navigable={false} showTimeAxis formatAxisValue={formatBpAxis} remoteKind="credit-spread-history" />;
}

function SpreadDetail({ row, width, height, focused }: { row: CreditConditionRow; width: number; height: number; focused: boolean }) {
  // The chart shows the year the rank and range come from.
  const items: StatItem[] = [
    { id: "oas", label: "OAS", value: formatBp(row.oasBp),
      detail: `${formatPercentileRank(row.percentile1Y, "1Y")} · ${row.date}` },
    { id: "change", label: "1D", value: formatBp(row.dailyChangeBp, true) },
    { id: "range", label: "1Y range", value: `${formatBp(row.rangeLowBp)} to ${formatBp(row.rangeHighBp)}` },
    { id: "series", label: "Series", value: row.seriesId, detail: row.frequency },
  ];
  return (
    <StatChartDetail items={items} width={width} height={height} empty={row.history.length < 2}
      emptySubject="spread history" emptyTitle="No spread history available."
      renderChart={(chartHeight) => <SpreadChart row={row} width={width} height={chartHeight} focused={focused} />} />
  );
}

function YieldDetail({ row, width, height, focused }: { row: CreditYieldRow; width: number; height: number; focused: boolean }) {
  const items: StatItem[] = [
    { id: "yield", label: "Yield", value: formatYield(row.yieldPct),
      detail: `${formatPercentileRank(row.percentile1Y, "1Y")} · ${row.date}` },
    { id: "change", label: "1D", value: formatBp(row.dailyChangeBp, true) },
    { id: "spread", label: "Vs 10Y", value: formatBp(row.spreadVs10YBp) },
    { id: "series", label: "Series", value: row.seriesId, detail: row.frequency },
  ];
  return (
    <StatChartDetail items={items} width={width} height={height} empty={row.history.length < 2}
      emptySubject="yield history" emptyTitle="No yield history available."
      renderChart={(chartHeight) => <CompositeChart series={yieldHistorySeries(row)} panels={PANELS} width={width} height={chartHeight}
        focused={focused} showLegend={false} navigable={false} showTimeAxis formatAxisValue={formatPercentAxis} remoteKind="credit-yield-history" />} />
  );
}

export function CreditConditionsPane({ paneId, focused, width, height }: PaneProps) {
  const resource = useAsyncResource(loadCreditBoard, { initialData: getCachedCreditBoard });
  const { loading, load: refresh, reload } = resource;
  const stale = resource.data?.stale ?? false;
  const error = resource.error ?? resource.data?.errors[0] ?? null;
  const lastUpdated = stale ? null : resource.updatedAt;
  const rows = resource.data?.rows ?? EMPTY_ROWS;
  const yields = resource.data?.yields ?? [];
  const boardRows = useMemo(() => [...rows.map(boardRow), ...yields.map(yieldBoardRow)], [rows, yields]);
  const mixedDates = new Set([
    ...rows.map((row) => row.date),
    ...yields.flatMap((row) => row.status === "available" ? [row.date] : []),
  ]).size > 1;
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", null);
  const [openId, setOpenId] = usePluginPaneState<string | null>("open", null);
  // The shared FRED cache decides whether a tick actually hits the network, so
  // the pane can follow the global cadence without refetching daily data.
  useAutoRefresh(lastUpdated, refresh);

  usePaneRefreshKey(reload, { focused, enabled: !loading });
  const partial = rows.length > 0 && rows.length < CREDIT_SERIES.length;
  // Each row carries its own date in the AS OF column; a spread between
  // indexes from different sessions is a limitation behind the warning.
  usePaneNoticeFooter({
    registrationId: "credit-conditions:notices",
    focused,
    notices: mixedDates ? ["The indexes carry different observation dates, so the spreads are not one session."] : [],
  });
  const footerInfo = useMemo<PaneFooterSegment[]>(() => [
    ...(rows.length > 0 ? [{ id: "delayed", parts: [{ text: "delayed", tone: "muted" as const }] }] : []),
    ...(partial ? [{ id: "partial", parts: [{ text: `PARTIAL ${rows.length}/${CREDIT_SERIES.length}`, tone: "warning" as const, bold: true }] }] : []),
    ...loadingErrorFooterInfo(loading, error),
  ], [error, loading, partial, rows.length, stale]);
  usePaneFooter(paneId, () => ({ info: footerInfo }), [footerInfo, paneId]);

  if (boardRows.length === 0) {
    return (
      <PaneStatusBody loading={loading} error={error} empty={!loading && !error}
        subject="Credit spreads" align="center" width={width} height={height} />
    );
  }

  // Like the funding boards, the selected index's year sits above the board;
  // the legend names the index, so the chart reads without the highlighted row.
  const selected = boardRows.find((row) => row.id === selectedId) ?? boardRows[0];
  return (
    <MarketBoardStack rows={boardRows} width={width} height={height} focused={focused}
      rootBefore={({ columns }) => <ChartTableHeader width={width} height={height} tableRows={boardRows.length}
        tableColumns={columns} chart={selected ? boardChart(selected) : null} />}
      selectedId={selectedId} onSelectedIdChange={setSelectedId} openId={openId} onOpenIdChange={setOpenId}
      labelHeader="INDEX" labelWidth={12} valueLabel="LEVEL" valueWidth={10}
      extraColumns={[{
        column: { id: "vs10y", label: "Vs 10Y", width: 9, align: "right" },
        sortValue: (row) => row.kind === "yield" ? row.yieldRow?.spreadVs10YBp ?? null : null,
        renderCell: (row) => ({ text: row.kind === "yield" && row.yieldRow ? formatBp(row.yieldRow.spreadVs10YBp) : "--" }),
      }]}
      renderDetail={(row) => row.kind === "oas"
        ? <SpreadDetail row={row.spread} width={width} height={Math.max(5, height - 2)} focused={focused} />
        : row.yieldRow
          ? <YieldDetail row={row.yieldRow} width={width} height={Math.max(5, height - 2)} focused={focused} />
          : <PaneStatusBody empty emptyTitle={`${row.label} is unavailable.`} subject="yield" width={width} height={Math.max(5, height - 2)} />} />
  );
}

export const creditConditionsModule: PluginModule = {
  panes: [{
    id: "credit-conditions",
    name: "Credit Spreads",
    icon: "C",
    component: CreditConditionsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 86, height: 20 },
  }],
  paneTemplates: [{
    id: "credit-conditions-pane",
    paneId: "credit-conditions",
    label: "Credit Spreads",
    description: "ICE BofA US corporate option-adjusted spreads and effective yields.",
    keywords: ["credit", "spread", "oas", "corporate", "high yield", "investment grade", "yield", "macro"],
    shortcut: { prefix: "CRD" },
    headless: creditConditionsHeadless,
  }],
};
