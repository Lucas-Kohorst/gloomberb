import { useCallback, useMemo, useState } from "react";
import { CompositeChart } from "../../../components/chart/composite";
import { staticSeries } from "../../../components/chart/static/series";
import {
  DataTableView,
  PaneStatusBody,
  PaneTabHeader,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import { ApiRequestError } from "../../../api-client/errors";
import type { RateContract, RateMeeting, RatePathPayload } from "../../../api-client/rates";
import { useAsyncResource, usePluginPaneState } from "../../../public/react";
import { usePaneSettingValue } from "../../../state/app/context";
import { blendHex, colors, priceColor } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import type { ResolvedSeries } from "../../../time-series/types";
import { Box, Text } from "../../../ui";
import { nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { useAutoRefresh } from "../shared/auto-refresh";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { getCachedRatePath, loadRatePath } from "./client";
import {
  meetingLabel,
  meetingMoves,
  meetingProbability,
  moveOddsText,
  movesPriced,
  movesText,
  percentileText,
  probabilityTargets,
  rateChangeText,
  ratePathCurves,
  rateText,
  type RatePathCurve,
} from "./model";

const TABS = [
  { value: "path", label: "Path" },
  { value: "probabilities", label: "Probabilities" },
  { value: "contracts", label: "Contracts" },
  { value: "projections", label: "Projections" },
];

const MEETING_COLUMNS: DataTableColumn[] = [
  { id: "date", label: "MEETING", width: 12, align: "left" },
  { id: "moves", label: "MOVES", width: 7, align: "right" },
  { id: "odds", label: "P(MOVE)", width: 10, align: "right" },
  { id: "change", label: "VS NOW", width: 9, align: "right" },
  { id: "rate", label: "EFFR", width: 9, align: "right" },
  { id: "percentile", label: "PCTL 1Y", width: 10, align: "right" },
  { id: "asOf", label: "AS OF UTC", width: 20, align: "left" },
];

const PROJECTION_COLUMNS: DataTableColumn[] = [
  { id: "year", label: "YEAR END", width: 14, align: "left" },
  { id: "rate", label: "SEP MEDIAN", width: 14, align: "right" },
  { id: "asOf", label: "AS OF", width: 12, align: "left" },
];

const CONTRACT_COLUMNS: DataTableColumn[] = [
  { id: "symbol", label: "CONTRACT", width: 16, align: "left" },
  { id: "price", label: "PRICE", width: 10, align: "right" },
  { id: "rate", label: "IMPLIED", width: 10, align: "right" },
  { id: "percentile", label: "PCTL 1Y", width: 10, align: "right" },
  { id: "asOf", label: "AS OF UTC", width: 20, align: "left" },
];

const PANELS = [{ id: "main" }];
const DAY_MS = 86_400_000;

function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

function timestamp(value: string | null): string {
  return value?.replace("T", " ").slice(0, 16) ?? "--";
}

function percentile(value: number | null): string {
  return value == null ? "--" : value.toFixed(0);
}

function signColor(value: number | null, digits: number): string {
  return value == null || !Number.isFinite(value) ? colors.textDim : priceColor(Number(value.toFixed(digits)));
}

function bpText(value: number | null): string {
  return value == null ? "--" : rateChangeText(value / 100);
}

function formatMeetingDay(date: string): string {
  return `${meetingLabel(date).slice(0, 3)} ${Number(date.slice(8, 10))}`;
}

function daysUntil(date: string, today = new Date().toISOString().slice(0, 10)): string {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / DAY_MS);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

function clip(text: string, width: number): string {
  const max = Math.max(0, width - 2);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
}

function compareNullable(left: string | number | null, right: string | number | null, direction: "asc" | "desc"): number {
  if (left == null) return right == null ? 0 : 1;
  if (right == null) return -1;
  const result = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right));
  return direction === "asc" ? result : -result;
}

function curvesToSeries(curves: readonly RatePathCurve[]): ResolvedSeries[] {
  return curves.map((curve) => staticSeries(
    curve.points.map((point) => ({
      date: new Date(point.x),
      observedAt: new Date(point.asOf ?? point.x),
      value: point.value,
    })),
    {
      id: curve.id,
      label: curve.role === "ghost" ? `${curve.label} ago` : curve.label,
      color: curve.color ?? colors.text,
      style: curve.style === "step" ? "step" : curve.role === "marker" ? "points" : "line",
      calendarSpaced: true,
    },
  ));
}

function meetingCell(
  row: RateMeeting,
  column: DataTableColumn,
  moves: ReadonlyMap<string, number | null>,
): DataTableCell {
  if (column.id === "date") return { text: row.date };
  if (column.id === "moves") {
    const priced = movesPriced(row);
    return { text: movesText(priced), color: signColor(priced, 2) };
  }
  if (column.id === "odds") return { text: moveOddsText(moves.get(row.date) ?? null) };
  if (column.id === "rate") return { text: rateText(row.impliedRate) };
  if (column.id === "change") return { text: bpText(row.changeBps), color: signColor(row.changeBps, 1) };
  if (column.id === "percentile") return { text: percentile(row.percentile) };
  return { text: timestamp(row.asOf), color: colors.textDim };
}

function contractCell(row: RateContract, column: DataTableColumn): DataTableCell {
  if (column.id === "symbol") return { text: row.symbol };
  if (column.id === "price") return { text: row.price?.toFixed(3) ?? "--" };
  if (column.id === "rate") return { text: rateText(row.impliedRate) };
  if (column.id === "percentile") return { text: percentile(row.percentile) };
  return { text: timestamp(row.asOf), color: row.stale ? colors.warning : colors.textDim };
}

export function RatePathPane({ width, height, focused }: PaneProps) {
  const loader = useCallback((force: boolean) => loadRatePath(force), []);
  const resource = useAsyncResource(loader, { initialData: getCachedRatePath, clearOnError: isAccessDenied });
  const [tabSetting, setTab] = usePaneSettingValue("tab", "path");
  const tab = TABS.some((entry) => entry.value === tabSetting) ? tabSetting : "path";
  const [selected, setSelected] = usePluginPaneState<string | null>("meeting", null);
  const [sort, setSort] = useState<SortPreference>({ columnId: "date", direction: "asc" });
  const [contractSort, setContractSort] = useState<SortPreference>({ columnId: "symbol", direction: "asc" });
  const [projectionSort, setProjectionSort] = useState<SortPreference>({ columnId: "year", direction: "asc" });
  const [contractId, setContractId] = usePluginPaneState<string | null>("contract", null);
  const data = resource.data;
  const moves = useMemo(() => meetingMoves(data?.meetings ?? []), [data]);
  const curves = useMemo(() => data ? ratePathCurves(data, {
    path: colors.positive,
    ghosts: { "1W": colors.textDim, "1M": blendHex(colors.textDim, colors.warning, 0.45) },
    band: colors.borderFocused,
    projection: colors.negative,
  }) : [], [data]);
  const series = useMemo(() => curvesToSeries(curves), [curves]);
  const legendSeries = useMemo(() => series.filter((entry) => entry.id !== "targetUpper"), [series]);

  const meetings = useMemo(() => [...(data?.meetings ?? [])].sort((a, b) => {
    const value = (row: RateMeeting): string | number | null => {
      switch (sort.columnId) {
        case "date": return row.date;
        case "moves":
        case "change": return row.changeBps;
        case "odds": return moves.get(row.date) ?? null;
        case "rate": return row.impliedRate;
        case "percentile": return row.percentile;
        case "asOf": return row.asOf;
        default: return null;
      }
    };
    return compareNullable(value(a), value(b), sort.direction);
  }), [data, moves, sort]);

  const contracts = useMemo(() => {
    const rows = data ? [...data.fedFunds, ...data.sofr] : [];
    return rows.sort((a, b) => {
      const value = (row: RateContract): string | number | null => {
        switch (contractSort.columnId) {
          case "symbol": return row.symbol;
          case "price": return row.price;
          case "rate": return row.impliedRate;
          case "percentile": return row.percentile;
          case "asOf": return row.asOf;
          default: return null;
        }
      };
      return compareNullable(value(a), value(b), contractSort.direction);
    });
  }, [contractSort, data]);

  const projections = useMemo(() => [...(data?.dotPlot.points ?? [])].sort((a, b) => {
    const value = (row: RatePathPayload["dotPlot"]["points"][number]): string | number | null => {
      if (projectionSort.columnId === "rate") return row.rate;
      if (projectionSort.columnId === "asOf") return data?.dotPlot.asOf ?? null;
      return String(row.year);
    };
    return compareNullable(value(a), value(b), projectionSort.direction);
  }), [data, projectionSort]);

  const selectedId = meetings.some((meeting) => meeting.date === selected) ? selected : meetings[0]?.date ?? null;
  const byDate = useMemo(() => [...(data?.meetings ?? [])].sort((a, b) => a.date.localeCompare(b.date)), [data]);
  const next = byDate[0];
  const last = byDate.at(-1);
  const nextMove = next ? moves.get(next.date) ?? null : null;
  const priced = last ? movesPriced(last) : null;
  const varies = (text: (row: RateMeeting) => string) => new Set(meetings.map(text)).size > 1;
  const meetingColumns = MEETING_COLUMNS.filter((column) => (
    column.id === "percentile" ? varies((row) => percentile(row.percentile))
      : column.id === "asOf" ? varies((row) => timestamp(row.asOf))
        : true
  ));
  const targets = useMemo(() => probabilityTargets(data?.meetings ?? []), [data]);
  const halfWidth = data?.current.targetLower.value != null && data.current.targetUpper.value != null
    ? (data.current.targetUpper.value - data.current.targetLower.value) / 2
    : null;
  const probabilityColumns: DataTableColumn[] = [
    MEETING_COLUMNS[0]!,
    ...targets.map((target) => ({
      id: String(target),
      label: halfWidth == null ? `${target.toFixed(3)}%` : `${(target - halfWidth).toFixed(2)}-${(target + halfWidth).toFixed(2)}%`,
      width: 13,
      align: "right" as const,
    })),
  ];
  const sortedProbabilities = useMemo(() => [...(data?.meetings ?? [])].sort((a, b) => {
    const value = (row: RateMeeting): string | number | null => {
      if (sort.columnId === "date" || sort.columnId == null) return row.date;
      const probability = meetingProbability(row, Number(sort.columnId));
      return probability;
    };
    return compareNullable(value(a), value(b), sort.columnId == null ? "asc" : sort.direction);
  }), [data, sort]);

  const leadRows = data ? 2 : 0;
  const chartRows = tab === "path" && series.length > 0 && height >= leadRows + 14
    ? Math.min(12, height - leadRows - 8)
    : 0;
  const tableHeight = Math.max(3, height - 1 - leadRows - (data?.gaps.length ? 1 : 0) - chartRows);
  const openUrl = data?.schedule.sourceUrl || data?.dotPlot.sourceUrl || null;

  useAutoRefresh(resource.updatedAt, () => { void resource.load(); });
  usePaneStatusLinkFooter({
    registrationId: "rate-path",
    focused,
    url: openUrl,
    showOpenHint: !!openUrl,
    loading: resource.loading,
    error: data ? null : resource.error,
    info: !resource.loading && data?.stale
      ? [{ id: "stale", parts: [{ text: "stale", tone: "warning" as const }] }]
      : [],
  });

  const onMeetingSort = (columnId: string) => setSort((current) => nextSortPreference(current, columnId, {
    defaultDirection: columnId === "date" || columnId === "asOf" ? "asc" : "desc",
  }));
  const cursorDate = selectedId ? new Date(`${selectedId}T00:00:00Z`) : null;

  const lead = data ? (() => {
    const odds = byDate.map((meeting) => `${formatMeetingDay(meeting.date)} ${moveOddsText(moves.get(meeting.date) ?? null)}`).join("  ·  ");
    const summary = [
      `Moves priced ${movesText(priced)}`,
      next ? `Next FOMC ${moveOddsText(nextMove)} · ${formatMeetingDay(next.date)} · ${daysUntil(next.date)}` : null,
      `EFFR ${rateText(data.current.effr.value)} ${percentileText(data.current.effr.percentile)}`,
      `Target ${rateText(data.current.targetLower.value)} to ${rateText(data.current.targetUpper.value)}`,
      tab === "path" && next && last && next !== last
        ? `${meetingLabel(next.date)} to ${meetingLabel(last.date)} ${bpText(data.slope.valueBps)} ${percentileText(data.slope.percentile)}`
        : null,
    ].filter(Boolean).join("   ");
    return { summary, odds };
  })() : null;

  return (
    <Box width={width} height={height} flexDirection="column">
      <PaneTabHeader width={width} focused={focused} tabs={TABS} activeValue={tab} onSelect={setTab} />
      {!data ? (
        <PaneStatusBody
          loading={resource.loading}
          error={resource.error}
          empty={!resource.loading && !resource.error}
          subject="rate path"
        />
      ) : (
        <Box width={width} flexDirection="column" flexGrow={1}>
          <Box height={1} paddingX={1} flexShrink={0}>
            <Text fg={colors.textBright}>{clip(lead?.summary ?? "", width)}</Text>
          </Box>
          <Box height={1} paddingX={1} flexShrink={0}>
            <Text fg={colors.text}>{clip(lead?.odds ?? "", width)}</Text>
          </Box>
          {data.gaps.length > 0 ? (
            <Box height={1} paddingX={1} flexShrink={0}>
              <Text fg={colors.warning}>{clip(data.gaps.join(" · "), width)}</Text>
            </Box>
          ) : null}
          {chartRows > 0 ? (
            <Box height={chartRows} flexShrink={0}>
              <CompositeChart
                series={series}
                legendSeries={legendSeries}
                panels={PANELS}
                width={width}
                height={chartRows}
                focused={focused}
                navigable={false}
                showLegend
                showTimeAxis
                cursorDate={cursorDate}
                formatAxisValue={(value) => rateText(value)}
                formatValue={(value) => rateText(value)}
                remoteKind="rate-path"
                onCursorDateChange={(date) => {
                  if (!date) return;
                  const iso = date.toISOString().slice(0, 10);
                  const match = byDate.find((meeting) => meeting.date === iso) ?? byDate.reduce<RateMeeting | null>((best, meeting) => {
                    if (!best) return meeting;
                    return Math.abs(Date.parse(meeting.date) - date.getTime()) < Math.abs(Date.parse(best.date) - date.getTime())
                      ? meeting
                      : best;
                  }, null);
                  if (match) setSelected(match.date);
                }}
              />
            </Box>
          ) : null}
          {tab === "path" ? (
            <DataTableView
              columns={meetingColumns}
              items={meetings}
              selection={{ kind: "id", selectedId, getId: (row) => row.date, onChange: (id) => setSelected(id) }}
              focused={focused}
              sortColumnId={sort.columnId}
              sortDirection={sort.direction}
              onHeaderClick={onMeetingSort}
              getItemKey={(row) => row.date}
              renderCell={(row, column) => meetingCell(row, column, moves)}
              rootWidth={width}
              rootHeight={tableHeight}
              emptyStateTitle="No scheduled FOMC meetings"
            />
          ) : tab === "probabilities" ? (
            <DataTableView
              columns={probabilityColumns}
              items={sortedProbabilities}
              selection={{ kind: "id", selectedId, getId: (row) => row.date, onChange: (id) => setSelected(id) }}
              focused={focused}
              sortColumnId={sort.columnId}
              sortDirection={sort.direction}
              onHeaderClick={onMeetingSort}
              getItemKey={(row) => row.date}
              rootWidth={width}
              rootHeight={tableHeight}
              emptyStateTitle="Meeting probabilities unavailable"
              renderCell={(row, column) => {
                if (column.id === "date") return { text: row.date };
                const probability = meetingProbability(row, Number(column.id));
                return {
                  text: probability == null ? "--" : `${(probability * 100).toFixed(1)}%`,
                  backgroundColor: probability == null ? undefined : blendHex(colors.bg, colors.positive, probability * 0.7),
                  color: probability != null && probability > 0.65 ? colors.bg : colors.text,
                };
              }}
            />
          ) : tab === "contracts" ? (
            <DataTableView
              columns={CONTRACT_COLUMNS}
              items={contracts}
              selection={{
                kind: "id",
                selectedId: contractId,
                getId: (row) => row.symbol,
                onChange: (id) => setContractId(id),
              }}
              focused={focused}
              sortColumnId={contractSort.columnId}
              sortDirection={contractSort.direction}
              onHeaderClick={(columnId) => setContractSort((current) => nextSortPreference(current, columnId, {
                defaultDirection: columnId === "symbol" || columnId === "asOf" ? "asc" : "desc",
              }))}
              getItemKey={(row) => row.symbol}
              renderCell={contractCell}
              rootWidth={width}
              rootHeight={tableHeight}
              emptyStateTitle="Futures strip unavailable"
            />
          ) : (
            <DataTableView
              columns={PROJECTION_COLUMNS}
              items={projections}
              selection={{ kind: "none" }}
              focused={focused}
              sortColumnId={projectionSort.columnId}
              sortDirection={projectionSort.direction}
              onHeaderClick={(columnId) => setProjectionSort((current) => nextSortPreference(current, columnId, {
                defaultDirection: columnId === "year" || columnId === "asOf" ? "asc" : "desc",
              }))}
              getItemKey={(row) => String(row.year)}
              rootWidth={width}
              rootHeight={tableHeight}
              emptyStateTitle="Fed projections unavailable"
              renderCell={(row, column) => ({
                text: column.id === "year" ? String(row.year) : column.id === "rate" ? rateText(row.rate) : data.dotPlot.asOf,
              })}
            />
          )}
        </Box>
      )}
    </Box>
  );
}
