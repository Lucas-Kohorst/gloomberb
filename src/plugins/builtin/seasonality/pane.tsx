import { useCallback, useMemo, useRef, useState } from "react";
import {
  DataTableView,
  EmptyState,
  PaneStatusBody,
  SegmentedControl,
  Tabs,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import { CompositeChart } from "../../../components/chart/composite";
import { resolveChartPalette } from "../../../components/chart/core/palette";
import { staticSeries } from "../../../components/chart/static/series";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { resolveCorrelationHeatmapCellColors } from "../correlation/colors";
import { usePaneStatusFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/auto-refresh";
import { usePaneSettingValue, usePaneTicker, usePluginPaneState } from "../../../public/react";
import { useAsyncResource } from "../../../react/async-resource";
import { useShortcut } from "../../../react/input";
import { blendHex } from "../../../theme/color-utils";
import { useThemeColors } from "../../../theme/theme-context";
import type { ResolvedSeries } from "../../../time-series/types";
import type { PaneProps } from "../../../types/plugin";
import { Box, Text } from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
import { loadSeasonalityHistory } from "./client";
import { MONTH_LABELS, OVERLAY_YEAR, projectSeasonality, type SeasonalityModel } from "./model";

const TABS = [{ value: "returns", label: "Returns" }, { value: "overlay", label: "Overlay" }];
export const LOOKBACK_OPTIONS = [
  { value: "5", label: "5Y" },
  { value: "10", label: "10Y" },
  { value: "20", label: "20Y" },
];
/** The move that tints a cell at full strength: a month of ±10%, a year of ±30%. */
const MONTH_SCALE = 0.1;
const YEAR_SCALE = 0.3;
const OVERLAY_START = Date.UTC(OVERLAY_YEAR, 0, 1);
const OVERLAY_SPAN_MS = 365 * 86_400_000;

function pct(value: number | null | undefined): string {
  if (value == null) return "--";
  const fixed = (value * 100).toFixed(1);
  // A return that rounds to zero reads 0.0%, never -0.0%.
  return /[1-9]/.test(fixed) ? `${value > 0 ? "+" : ""}${fixed}%` : "0.0%";
}

function toneColor(colors: ReturnType<typeof useThemeColors>, value: number | null): string | undefined {
  if (value == null) return undefined;
  return value >= 0 ? colors.positive : colors.negative;
}

/** Running month is a return to date: shown, but not tinted as a finished month. */
function heatCell(signed: number | null, quiet = false): { background: string; foreground: string } {
  if (quiet || signed == null || !Number.isFinite(signed)) return resolveCorrelationHeatmapCellColors(null);
  return resolveCorrelationHeatmapCellColors(Math.max(-1, Math.min(1, signed)));
}

interface Row {
  id: string;
  label: string;
  cells: (number | null)[];
  total: number | null;
  kind: "stat" | "hit" | "year";
  partial?: boolean;
}

const COLUMNS: DataTableColumn[] = [
  { id: "label", label: "Year", width: 7, align: "left" },
  ...MONTH_LABELS.map((label, month) => ({ id: `m${month}`, label, width: 7, align: "right" as const })),
  { id: "total", label: "Year %", width: 8, align: "right" },
];

function tableRows(model: SeasonalityModel): Row[] {
  return [
    { id: "mean", label: "Avg", kind: "stat", cells: model.months.map((stat) => stat.mean), total: null },
    { id: "median", label: "Median", kind: "stat", cells: model.months.map((stat) => stat.median), total: null },
    { id: "hit", label: "Up %", kind: "hit", cells: model.months.map((stat) => stat.hitRate), total: null },
    ...model.years.map((year): Row => ({
      id: String(year.year),
      label: `${year.year}${year.partial ? "*" : ""}`,
      kind: "year",
      cells: year.months,
      total: year.total,
      partial: year.partial,
    })),
  ];
}

function columnNumber(row: Row, columnId: string): number | null {
  if (columnId === "label") {
    const year = Number(row.id);
    return Number.isFinite(year) ? year : null;
  }
  if (columnId === "total") return row.total;
  return row.cells[Number(columnId.slice(1))] ?? null;
}

function compareYearRows(left: Row, right: Row, columnId: string, direction: "asc" | "desc"): number {
  const a = columnNumber(left, columnId);
  const b = columnNumber(right, columnId);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const delta = a - b;
  return direction === "asc" ? delta : -delta;
}

function renderCell(row: Row, column: DataTableColumn, runningMonth: number | null): DataTableCell {
  if (column.id === "label") return { text: row.label };
  const value = column.id === "total" ? row.total : row.cells[Number(column.id.slice(1))] ?? null;
  if (row.kind === "hit") {
    const heat = heatCell(value == null ? null : (value - 0.5) * 2);
    return {
      text: value == null ? "--" : `${Math.round(value * 100)}%`,
      backgroundColor: heat.background,
      color: heat.foreground,
    };
  }
  const scale = column.id === "total" ? YEAR_SCALE : MONTH_SCALE;
  const quiet = value == null || (row.partial && column.id === `m${runningMonth}`);
  const heat = heatCell(value == null ? null : value / scale, quiet);
  return {
    text: pct(value),
    backgroundColor: heat.background,
    color: heat.foreground,
  };
}

function overlaySeries(model: SeasonalityModel, colors: ReturnType<typeof useThemeColors>): ResolvedSeries[] {
  const toSeries = (id: string, label: string, color: string, points: { date: Date; value: number }[]): ResolvedSeries => ({
    ...staticSeries(points.map((point) => ({ date: point.date, observedAt: point.date, value: point.value * 100 })), {
      id,
      label,
      color,
      calendarSpaced: true,
    }),
    unit: "%",
    unitGroup: "return",
  });
  const [latest, ...past] = model.paths;
  return [
    // Older years fade toward the background so the latest and the average stay on top.
    ...past.reverse().map((path, index) => toSeries(
      `y${path.year}`,
      String(path.year),
      blendHex(colors.bg, colors.textDim, 0.35 + 0.65 * ((index + 1) / past.length)),
      path.points,
    )),
    ...(model.averagePath.length ? [toSeries("average", "Average", colors.warning, model.averagePath)] : []),
    ...(latest ? [toSeries(`y${latest.year}`, String(latest.year), colors.positive, latest.points)] : []),
  ];
}

export function SeasonalityPane({ width, height, focused }: PaneProps) {
  const colors = useThemeColors();
  const { symbol, ticker } = usePaneTicker();
  const [view, setView] = usePluginPaneState("activeTabId", "returns");
  const [lookback, setLookback] = usePaneSettingValue("lookbackYears", "10");
  const [selectedRow, setSelectedRow] = usePluginPaneState<string | null>("selectedRow", null);
  const [sort, setSort] = useState<{ columnId: string; direction: "asc" | "desc" } | null>(null);
  const instrument = instrumentFromTicker(ticker, symbol);
  const instrumentKey = JSON.stringify(instrument);
  const instrumentRef = useRef(instrument);
  instrumentRef.current = instrument;
  const loader = useCallback(async (force: boolean, signal: AbortSignal) => {
    const current = instrumentRef.current;
    if (!current) throw new Error("No ticker selected");
    const snapshot = await loadSeasonalityHistory({ instrument: current, forceRefresh: force, signal });
    if (!snapshot.history.length && snapshot.error) throw new Error(snapshot.error);
    return snapshot;
  }, [instrumentKey]);
  const history = useAsyncResource(instrument ? loader : null);
  useAutoRefresh(history.updatedAt, () => { void history.reload(); });

  const model = useMemo(() => (
    history.data
      ? projectSeasonality(history.data.history, { symbol: symbol ?? "", lookbackYears: Number(lookback) || 10 })
      : null
  ), [history.data, lookback, symbol]);
  const rows = useMemo(() => model ? tableRows(model) : [], [model]);
  const displayRows = useMemo(() => {
    if (!sort) return rows;
    const stats = rows.filter((row) => row.kind !== "year");
    const years = rows.filter((row) => row.kind === "year")
      .sort((left, right) => compareYearRows(left, right, sort.columnId, sort.direction));
    return [...stats, ...years];
  }, [rows, sort]);
  const series = useMemo(() => model ? overlaySeries(model, colors) : [], [model, colors]);
  const runningMonth = model?.years[0]?.partial && model.asOf ? model.asOf.getUTCMonth() : null;
  const onHeaderClick = useCallback((columnId: string) => {
    setSort((current) => (
      current?.columnId === columnId
        ? { columnId, direction: current.direction === "desc" ? "asc" : "desc" }
        : { columnId, direction: "desc" }
    ));
  }, []);

  useShortcut((event) => {
    if (!focused || event.targetEditable) return;
    if (!isPlainKey(event, "r")) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    void history.reload();
  });

  const statusError = history.error ?? history.data?.error ?? null;
  usePaneStatusFooter({
    registrationId: "seasonality",
    focused,
    loading: history.loading,
    error: statusError,
    info: history.data?.stale
      ? [{ id: "stale", parts: [{ text: "stale", tone: "warning" as const }] }]
      : [],
  });

  const stats = useMemo(() => {
    if (!model?.asOf || !model.years.length) return null;
    const month = model.asOf.getUTCMonth();
    const stat = model.months[month]!;
    const current = model.years[0]!;
    const hitDetail = stat.count
      ? `${Math.round((stat.hitRate ?? 0) * stat.count)} of ${stat.count} yrs`
      : null;
    return {
      monthLabel: MONTH_LABELS[month],
      mean: stat.mean,
      hit: stat.count ? `${Math.round((stat.hitRate ?? 0) * 100)}%` : "--",
      hitDetail,
      ytd: current.partial ? current.total : undefined,
      year: current.year,
      asOf: model.asOf.toISOString().slice(0, 7),
    };
  }, [model]);

  const showStats = stats != null;
  const bodyHeight = Math.max(4, height - 1);
  const plotHeight = Math.max(4, bodyHeight - (showStats ? 1 : 0));
  const palette = resolveChartPalette(colors);

  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      <Box height={1} flexDirection="row" overflow="hidden">
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Tabs
            tabs={TABS}
            activeValue={view}
            onSelect={setView}
            focused={focused}
            compact
            variant="underline"
          />
        </Box>
        <SegmentedControl
          options={LOOKBACK_OPTIONS}
          value={String(lookback)}
          onChange={setLookback}
          focused={false}
          shortcutScope="seasonality:lookback"
        />
      </Box>
      {!symbol ? <EmptyState title="Choose a ticker." /> : (
        <PaneStatusBody
          subject="seasonality"
          loading={history.loading && !model}
          error={!model ? statusError : null}
          empty={!!model && !model.years.length}
          emptyTitle="No monthly returns."
        >
          {model ? (
            <Box flexDirection="column" width={width} height={bodyHeight} overflow="hidden">
              {stats ? (
                <Box height={1} paddingX={1} flexDirection="row" gap={1} overflow="hidden">
                  <Text fg={colors.textDim}>{stats.monthLabel} avg</Text>
                  <Text fg={toneColor(colors, stats.mean)}>{pct(stats.mean)}</Text>
                  <Text fg={colors.textDim}>{stats.monthLabel} up {stats.hit}{stats.hitDetail ? ` ${stats.hitDetail}` : ""}</Text>
                  {stats.ytd !== undefined ? (
                    <>
                      <Text fg={colors.textDim}>{stats.year} YTD</Text>
                      <Text fg={toneColor(colors, stats.ytd)}>{pct(stats.ytd)}</Text>
                    </>
                  ) : null}
                  <Text fg={colors.textMuted}>through {stats.asOf}</Text>
                </Box>
              ) : null}
              {view === "overlay" ? (
                <CompositeChart
                  series={series}
                  panels={[{ id: "main" }]}
                  width={width}
                  height={plotHeight}
                  focused={focused}
                  navigable={false}
                  showLegend
                  showTimeAxis
                  remoteKind="seasonality"
                  viewport={{
                    start: new Date(Date.UTC(OVERLAY_YEAR, 0, 1)),
                    end: new Date(Date.UTC(OVERLAY_YEAR, 11, 31)),
                  }}
                  viewportResetKey={symbol ?? ""}
                  xAxis={{
                    labels: MONTH_LABELS,
                    formatCursor: (ratio) => new Date(OVERLAY_START + ratio * OVERLAY_SPAN_MS).toISOString().slice(5, 10),
                  }}
                  colors={{
                    background: palette.bgColor,
                    grid: palette.gridColor,
                    crosshair: palette.crosshairColor,
                    text: colors.text,
                    textDim: palette.axisColor,
                    negative: colors.negative,
                  }}
                />
              ) : (
                <DataTableView<Row>
                  focused={focused}
                  columns={COLUMNS}
                  items={displayRows}
                  rootWidth={width}
                  rootHeight={plotHeight}
                  getItemKey={(row) => row.id}
                  emptyStateTitle="No monthly returns."
                  sortColumnId={sort?.columnId ?? null}
                  sortDirection={sort?.direction ?? "desc"}
                  onHeaderClick={onHeaderClick}
                  selection={{
                    kind: "id",
                    selectedId: selectedRow,
                    getId: (row) => row.id,
                    onChange: (id) => setSelectedRow(id),
                  }}
                  renderCell={(row, column) => renderCell(row, column, runningMonth)}
                />
              )}
            </Box>
          ) : null}
        </PaneStatusBody>
      )}
    </Box>
  );
}
