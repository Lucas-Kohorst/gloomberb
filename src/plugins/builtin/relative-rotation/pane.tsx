import { useCallback, useMemo, useState } from "react";
import {
  DataTableView,
  PaneStatusBody,
  footerErrorChip,
  usePaneFooter,
  type DataTableColumn,
  type PaneFooterSegment,
} from "../../../components";
import { CompositeChart } from "../../../components/chart/composite/composite-chart";
import { scalarPoint, staticSeries } from "../../../components/chart/static/series";
import { useAsyncResource } from "../../../react/async-resource";
import { useShortcut } from "../../../react/input";
import { usePaneCollection, usePaneSettingValue, usePluginPaneState, useTickers } from "../../../public/react";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box } from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
import { compareSortValues, nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { useAutoRefresh } from "../shared/auto-refresh";
import { cachedRotation, loadRotation } from "./client";
import {
  ROTATION_LIMIT,
  rotationId,
  rotationInstruments,
  rotationTrailWeeks,
  sectorRotationInstruments,
  type RotationInstrument,
  type RotationRow,
} from "./model";

const PALETTE = [
  "#4da3ff", "#ff9933", "#a78bfa", "#4ade80", "#ff5c5c", "#facc15",
  "#22d3ee", "#f472b6", "#a3e635", "#b5835a", "#94a3b8",
];
const COLUMNS: DataTableColumn[] = [
  { id: "symbol", label: "ETF", width: 7, align: "left" },
  { id: "label", label: "NAME", width: 16, flexGrow: 1, align: "left" },
  { id: "quadrant", label: "QUADRANT", width: 10, align: "left" },
  { id: "strength", label: "STRENGTH", width: 10, align: "right" },
  { id: "strengthRank", label: "STR PCTL", width: 8, align: "right" },
  { id: "momentum", label: "MOMENTUM", width: 10, align: "right" },
  { id: "momentumRank", label: "MOM PCTL", width: 8, align: "right" },
];
const PANELS = [{ id: "main" }];
const X_TO_TIME = 1_000_000;
const number = (value: number | null | undefined) => value == null ? "--" : value.toFixed(2);
const rank = (value: number | null) => value == null ? "--" : value.toFixed(0);

function fadeColor(hex: string): string {
  const parsed = Number.parseInt(hex.slice(1), 16);
  const mix = (channel: number) => Math.round(channel * 0.28 + 48);
  const red = (parsed >> 16) & 255;
  const green = (parsed >> 8) & 255;
  const blue = parsed & 255;
  return `#${[mix(red), mix(green), mix(blue)].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function RotationChart({
  rows,
  colorsById,
  pickedId,
  width,
  height,
  focused,
}: {
  rows: RotationRow[];
  colorsById: Map<string, string>;
  pickedId: string | null;
  width: number;
  height: number;
  focused: boolean;
}) {
  const colors = useThemeColors();
  const fadeOthers = rows.some((row) => row.id === pickedId);
  const series = useMemo(() => rows.flatMap((row) => {
    const points = row.trail.filter((point) => point.strength != null && point.momentum != null);
    if (!points.length) return [];
    const own = colorsById.get(row.id) ?? colors.text;
    const color = fadeOthers && row.id !== pickedId ? fadeColor(own) : own;
    return [staticSeries(
      points.map((point) => scalarPoint(new Date(Math.round(point.strength! * X_TO_TIME)), point.momentum)),
      { id: row.id, label: row.symbol, color, style: "points", calendarSpaced: true },
    )];
  }), [colors.text, colorsById, fadeOthers, pickedId, rows]);
  if (!series.length || height < 4) return null;
  return (
    <CompositeChart
      series={series}
      panels={PANELS}
      width={width}
      height={height}
      focused={focused}
      navigable={false}
      showLegend
      showTimeAxis={false}
      colors={{
        background: colors.bg,
        grid: colors.border,
        crosshair: colors.textDim,
        text: colors.text,
        textDim: colors.textDim,
        negative: colors.negative,
      }}
    />
  );
}

export function RelativeRotationPane(props: PaneProps) {
  const [scope] = usePaneSettingValue("scope", "sectors");
  const [symbols] = usePaneSettingValue("symbols", "");
  const [benchmarkText] = usePaneSettingValue("benchmark", "SPY:NYSEARCA");
  const [trailText] = usePaneSettingValue("trail", "6");
  const { collectionId } = usePaneCollection();
  const tickers = useTickers();
  const context = useMemo(() => {
    try {
      const references = rotationInstruments(benchmarkText || "SPY:NYSEARCA");
      if (references.length !== 1) throw new Error("Choose one benchmark in pane settings.");
      const instruments = scope === "custom"
        ? rotationInstruments(symbols)
        : scope === "collection"
          ? [...tickers.values()]
            .filter((ticker) => collectionId && [...ticker.metadata.watchlists, ...ticker.metadata.portfolios].includes(collectionId))
            .map((ticker) => ({
              symbol: ticker.metadata.ticker,
              exchange: ticker.metadata.exchange,
              label: ticker.metadata.ticker,
            }))
          : sectorRotationInstruments();
      if (!instruments.length) throw new Error("Choose symbols or link a populated watchlist in pane settings.");
      if (instruments.length > ROTATION_LIMIT) throw new Error(`Choose a watchlist with at most ${ROTATION_LIMIT} instruments.`);
      return { benchmark: references[0]!, instruments, error: null as string | null };
    } catch (error) {
      return {
        benchmark: null as RotationInstrument | null,
        instruments: [] as RotationInstrument[],
        error: error instanceof Error ? error.message : "Invalid rotation scope.",
      };
    }
  }, [scope, symbols, benchmarkText, collectionId, tickers]);
  const trail = rotationTrailWeeks(trailText);
  return context.benchmark
    ? (
      <RotationView
        key={`${rotationId(context.benchmark)}:${context.instruments.map(rotationId).join(",")}:${trail}`}
        {...props}
        benchmark={context.benchmark}
        instruments={context.instruments}
        trail={trail}
      />
    )
    : <PaneStatusBody error={context.error} subject="relative rotation" />;
}

function RotationView({
  width,
  height,
  focused,
  benchmark,
  instruments,
  trail,
}: PaneProps & { benchmark: RotationInstrument; instruments: RotationInstrument[]; trail: number }) {
  const colors = useThemeColors();
  const identity = `${rotationId(benchmark)}:${instruments.map(rotationId).join(",")}:${trail}`;
  const loader = useCallback(
    (force: boolean) => loadRotation(benchmark, instruments, trail, force),
    [identity],
  );
  const resource = useAsyncResource(loader, {
    initialData: () => cachedRotation(benchmark, instruments, trail),
  });
  const [pickedId, setPickedId] = usePluginPaneState<string | null>("selected", null);
  const [sort, setSort] = useState<SortPreference>({ columnId: "symbol", direction: "asc" });
  const data = resource.data?.payload;
  const colorsById = useMemo(
    () => new Map(instruments.map((row, index) => [rotationId(row), PALETTE[index % PALETTE.length]!])),
    [identity],
  );
  const rows = useMemo(() => [...(data?.rows ?? [])].sort((left, right) => {
    const columnId = sort.columnId ?? "symbol";
    const value = (row: RotationRow) => columnId === "strengthRank"
      ? row.strengthRank.percentile
      : columnId === "momentumRank"
        ? row.momentumRank.percentile
        : row[columnId as "symbol"];
    return compareSortValues(value(left), value(right), sort.direction);
  }), [data, sort]);
  const chartHeight = Math.max(8, Math.floor(height * 0.45));
  useAutoRefresh(resource.updatedAt, resource.load);
  useShortcut((event) => {
    if (!focused || event.targetEditable || !isPlainKey(event, "r") || resource.loading) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    void resource.reload();
  }, { enabled: focused });
  const footerInfo = useMemo<PaneFooterSegment[]>(() => {
    const errorChip = footerErrorChip(resource.error ?? resource.data?.refreshError);
    return [
      ...(resource.data?.stale ? [{ id: "stale", parts: [{ text: "stale", tone: "warning" as const }] }] : []),
      ...(resource.loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(errorChip ? [{ id: "error", parts: [errorChip] }] : []),
    ];
  }, [resource.data?.refreshError, resource.data?.stale, resource.error, resource.loading]);
  usePaneFooter("relative-rotation", () => (footerInfo.length ? { info: footerInfo } : null), [footerInfo]);
  return (
    <Box width={width} height={height} flexDirection="column">
      <PaneStatusBody loading={resource.loading && !data} error={!data ? resource.error : null} subject="relative rotation">
        {data ? (
          <>
            <RotationChart rows={rows} colorsById={colorsById} pickedId={pickedId} width={width} height={chartHeight} focused={focused} />
            <DataTableView
              columns={COLUMNS}
              items={rows}
              focused={focused}
              rootWidth={width}
              rootHeight={Math.max(3, height - chartHeight)}
              getItemKey={(row) => row.id}
              selection={{
                kind: "id",
                selectedId: rows.some((row) => row.id === pickedId) ? pickedId : rows[0]?.id ?? null,
                getId: (row) => row.id,
                onChange: (id) => setPickedId(id),
              }}
              sortColumnId={sort.columnId}
              sortDirection={sort.direction}
              onHeaderClick={(id) => setSort((current) => nextSortPreference(current, id, { defaultDirection: "asc" }))}
              renderCell={(row, column) => ({
                text: column.id === "strengthRank"
                  ? rank(row.strengthRank.percentile)
                  : column.id === "momentumRank"
                    ? rank(row.momentumRank.percentile)
                    : column.id === "strength" || column.id === "momentum"
                      ? number(row[column.id])
                      : String(row[column.id as "symbol"] ?? "--"),
                color: column.id === "symbol" ? colorsById.get(row.id) : colors.text,
              })}
              emptyStateTitle="No aligned weekly observations."
            />
          </>
        ) : null}
      </PaneStatusBody>
    </Box>
  );
}
