import { useCallback, useMemo, useState } from "react";
import type { FuturesContract } from "../../../api-client/futures-curve";
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
import { usePaneSettingValue, usePluginPaneState } from "../../../public/react";
import { usePaneInstance } from "../../../state/app/context";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box, Input, Text, TextAttributes } from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
import { nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { useAutoRefresh } from "../shared/auto-refresh";
import { getCachedFuturesCurve, loadFuturesCurve, loadFuturesCurveAsOf } from "./client";
import {
  curveAsOfDate,
  curveAxisPrice,
  curveChangeText,
  curveContractChanges,
  curveContractMonth,
  curvePrice,
  curveRank,
  DEFAULT_CURVE_HORIZON,
  futuresCurveSeries,
  normalizeCurveRoot,
  sortCurveContracts,
} from "./model";

const TABS = [{ value: "curve", label: "Curve" }, { value: "contracts", label: "Contracts" }];
const CONTRACT_COLUMNS: DataTableColumn[] = [
  { id: "symbol", label: "CONTRACT", width: 12, align: "left" },
  { id: "expiry", label: "MONTH", width: 8, align: "left" },
  { id: "price", label: "PRICE", width: 12, align: "right" },
  { id: "change", label: "CHG", width: 12, align: "right" },
  { id: "percentile", label: "PCTL", width: 8, align: "right" },
  { id: "oi", label: "OPEN INT", width: 10, align: "right" },
  { id: "volume", label: "VOLUME", width: 10, align: "right" },
];
const CURVE_COLUMNS: DataTableColumn[] = [
  ...CONTRACT_COLUMNS.slice(0, 3),
  { id: "change1w", label: "VS 1W", width: 10, align: "right" },
  { id: "change1m", label: "VS 1M", width: 10, align: "right" },
  ...CONTRACT_COLUMNS.slice(4),
];
const integer = (value: number | null) => value == null ? "--" : value.toLocaleString("en-US");

export function FuturesCurvePane(props: PaneProps) {
  const pane = usePaneInstance();
  const requested = pane?.settings?.root ?? pane?.params?.root ?? "ES";
  const root = normalizeCurveRoot(requested);
  return root
    ? <FuturesCurveView key={root} {...props} root={root} />
    : <PaneStatusBody error={`Unsupported futures root: ${String(requested)}`} subject="futures curve" />;
}

function FuturesCurveView({ width, height, focused, root }: PaneProps & { root: string }) {
  const colors = useThemeColors();
  const [requestedDate, setRequestedDate] = usePaneSettingValue<string>("asOfDate", "");
  const [draftDate, setDraftDate] = useState(requestedDate);
  const [dateError, setDateError] = useState<string | null>(null);
  const [dateFocused, setDateFocused] = useState(false);
  const [tab, setTab] = usePluginPaneState("tab", "curve");
  const [selected, setSelected] = usePluginPaneState<string | null>("contract", null);
  const [sort, setSort] = useState<SortPreference>({ columnId: "expiry", direction: "asc" });
  const [horizon] = usePaneSettingValue("horizon", DEFAULT_CURVE_HORIZON);
  const loader = useCallback(async (force: boolean) => (
    requestedDate ? loadFuturesCurveAsOf(root, requestedDate) : loadFuturesCurve(root, force)
  ), [root, requestedDate]);
  const resource = useAsyncResource(loader, {
    initialData: () => requestedDate ? null : getCachedFuturesCurve(root),
  });
  const data = resource.data;
  const curveTab = tab !== "contracts";
  const changes = useMemo(() => data ? curveContractChanges(data) : new Map(), [data]);
  const rows = useMemo(
    () => sortCurveContracts(data?.contracts ?? [], sort.columnId ?? "expiry", sort.direction, changes),
    [changes, data, sort],
  );
  const curves = useMemo(() => data
    ? futuresCurveSeries(
      data,
      { current: colors.positive, ghosts: { "1W": colors.warning, "1M": colors.textDim, "1Y": colors.textMuted } },
      horizon,
      requestedDate ? Date.parse(`${requestedDate}T00:00:00Z`) : Date.now(),
      requestedDate ? data.asOf ?? requestedDate : undefined,
    )
    : [], [colors, data, horizon, requestedDate]);
  const charted = useMemo(() => new Set(curves[0]?.points.map((point) => point.id)), [curves]);
  const tableRows = curveTab ? rows.filter((row) => charted.has(row.symbol)) : rows;
  const columns = curveTab ? CURVE_COLUMNS : CONTRACT_COLUMNS;
  const chartHeight = curveTab ? Math.max(7, Math.floor((height - 2) * 0.42)) : 0;
  const series = useMemo(() => curves.filter((entry) => entry.chartVisible !== false).map((entry) => staticSeries(
    entry.points.map((point) => scalarPoint(new Date(point.x), point.value)),
    { id: entry.id, label: entry.label, color: entry.color ?? colors.text, calendarSpaced: true },
  )), [colors.text, curves]);
  useAutoRefresh(requestedDate ? null : resource.updatedAt, resource.load);
  useShortcut((event) => {
    if (!focused || event.targetEditable || !isPlainKey(event, "r") || resource.loading) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    void resource.reload();
  }, { enabled: focused });
  const commitDate = () => {
    try {
      const next = curveAsOfDate(draftDate);
      setDateError(null);
      setRequestedDate(next);
    } catch (error) {
      setDateError(error instanceof Error ? error.message : String(error));
    }
  };
  const footerInfo = useMemo<PaneFooterSegment[]>(() => {
    const errorChip = footerErrorChip(resource.error);
    return [
      ...(data?.stale ? [{ id: "stale", parts: [{ text: "stale", tone: "warning" as const }] }] : []),
      ...(resource.loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(errorChip ? [{ id: "error", parts: [errorChip] }] : []),
    ];
  }, [data?.stale, resource.error, resource.loading]);
  usePaneFooter("futures-curve", () => (footerInfo.length ? { info: footerInfo } : null), [footerInfo]);
  const cell = (row: FuturesContract, id: string): { text: string; color?: string } => {
    if (id === "symbol") return { text: row.symbol, color: colors.textBright };
    if (id === "expiry") return { text: curveContractMonth(row.symbol, row.expiration), color: colors.text };
    if (id === "price") return { text: curvePrice(row.price, root), color: colors.textBright };
    if (id === "change") {
      const change = row.change ?? null;
      return {
        text: curveChangeText(change, root),
        color: change == null || change === 0 ? colors.textDim : change > 0 ? colors.positive : colors.negative,
      };
    }
    if (id === "change1w" || id === "change1m") {
      const change = changes.get(row.symbol)?.[id === "change1w" ? "1W" : "1M"] ?? null;
      return { text: curveChangeText(change, root), color: colors.text };
    }
    if (id === "percentile") return { text: curveRank(row.percentile, row.samples), color: colors.textDim };
    if (id === "oi") return { text: integer(row.openInterest), color: colors.textDim };
    if (id === "volume") return { text: integer(row.volume), color: colors.textDim };
    return { text: "" };
  };
  return (
    <Box width={width} height={height} flexDirection="column">
      <Box height={1} flexDirection="row" gap={2} paddingX={1}>
        {TABS.map((item) => (
          <Text
            key={item.value}
            fg={item.value === (curveTab ? "curve" : "contracts") ? colors.textBright : colors.textDim}
            attributes={item.value === (curveTab ? "curve" : "contracts") ? TextAttributes.BOLD : undefined}
            onMouseDown={() => setTab(item.value)}
          >
            {item.label}
          </Text>
        ))}
        <Box onMouseDown={() => setDateFocused(true)}>
          <Input
            value={draftDate}
            placeholder="YYYY-MM-DD"
            width={12}
            focused={focused && dateFocused}
            onChange={setDraftDate}
            onSubmit={() => { commitDate(); setDateFocused(false); }}
          />
        </Box>
      </Box>
      {dateError ? <Text fg={colors.warning}>{dateError}</Text> : null}
      <PaneStatusBody
        loading={resource.loading && !data}
        error={!data ? resource.error : null}
        subject="futures curve"
        empty={!!data && tableRows.length === 0}
        emptyTitle="No listed contracts."
      >
        {data ? (
          <>
            {curveTab ? (
              <CompositeChart
                series={series}
                panels={[{ id: "main" }]}
                width={width}
                height={chartHeight}
                focused={focused}
                navigable={false}
                showLegend
                formatAxisValue={(value, domain) => curveAxisPrice(value, domain, root)}
                colors={{
                  background: colors.bg,
                  grid: colors.border,
                  crosshair: colors.textDim,
                  text: colors.text,
                  textDim: colors.textDim,
                  negative: colors.negative,
                }}
              />
            ) : null}
            <DataTableView
              columns={columns}
              items={tableRows}
              focused={focused}
              rootWidth={width}
              rootHeight={Math.max(3, height - 1 - (dateError ? 1 : 0) - chartHeight)}
              getItemKey={(row) => row.symbol}
              selection={{
                kind: "id",
                selectedId: tableRows.some((row) => row.symbol === selected) ? selected : tableRows[0]?.symbol ?? null,
                getId: (row) => row.symbol,
                onChange: (id) => setSelected(id),
              }}
              sortColumnId={sort.columnId}
              sortDirection={sort.direction}
              onHeaderClick={(id) => setSort((current) => nextSortPreference(current, id, {
                defaultDirection: (columnId) => columnId === "symbol" || columnId === "expiry" ? "asc" : "desc",
              }))}
              renderCell={(row, column) => cell(row, column.id)}
              emptyStateTitle="No listed contracts."
            />
          </>
        ) : null}
      </PaneStatusBody>
    </Box>
  );
}
