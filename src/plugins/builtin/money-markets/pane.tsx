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
import type { MoneyMarketRow } from "../../../api-client/money-markets";
import { useAsyncResource, usePluginPaneState } from "../../../public/react";
import { usePaneSettingValue } from "../../../state/app/context";
import { blendHex, colors } from "../../../theme/colors";
import type { ResolvedSeries } from "../../../time-series/types";
import type { PaneProps } from "../../../types/plugin";
import { Box, Text } from "../../../ui";
import { nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { useAutoRefresh } from "../shared/auto-refresh";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { getCachedMoneyMarkets, loadMoneyMarkets } from "./client";
import {
  moneyMarketAxis,
  moneyMarketChange,
  moneyMarketCurves,
  moneyMarketObservations,
  moneyMarketRateChange,
  moneyMarketRows,
  moneyMarketValue,
  type MoneyMarketCurve,
} from "./model";

const TABS = [
  { value: "rates", label: "Rates" },
  { value: "bills", label: "Bills" },
  { value: "liquidity", label: "Liquidity" },
];

const COLUMNS: DataTableColumn[] = [
  { id: "label", label: "INSTRUMENT", width: 16, align: "left", flexGrow: 1 },
  { id: "value", label: "LEVEL", width: 12, align: "right" },
  { id: "change", label: "Δ OBS", width: 10, align: "right" },
  { id: "percentile", label: "PCTL 1Y", width: 10, align: "right" },
  { id: "asOf", label: "AS OF", width: 12, align: "left" },
];

const PANELS = [{ id: "main" }];
const YEAR_MS = 365.25 * 86_400_000;

function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
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

/** One continuous line: holiday nulls are already dropped, and dates stay on the calendar. */
function historySeries(row: MoneyMarketRow): ResolvedSeries[] {
  const points = moneyMarketObservations(row).map((point) => {
    const date = new Date(`${point.date}T00:00:00Z`);
    return { date, observedAt: date, value: point.value };
  });
  return [staticSeries(points, {
    id: row.id,
    label: row.label,
    color: colors.positive,
    style: "line",
    calendarSpaced: true,
  })];
}

function billSeries(curves: readonly MoneyMarketCurve[]): ResolvedSeries[] {
  return curves.filter((curve) => curve.chartVisible).map((curve) => staticSeries(
    curve.points.map((point) => {
      const date = new Date(point.x * YEAR_MS);
      return { date, observedAt: date, value: point.value };
    }),
    {
      id: curve.id,
      label: curve.id === "today" ? "Discount yield" : `${curve.label} ago`,
      color: curve.color ?? (curve.id === "today" ? colors.positive : colors.textDim),
      style: "line",
      calendarSpaced: true,
    },
  ));
}

function cell(row: MoneyMarketRow, column: DataTableColumn): DataTableCell {
  if (column.id === "label") return { text: row.label };
  if (column.id === "value") return { text: moneyMarketValue(row.value, row.unit) };
  if (column.id === "change") {
    const text = moneyMarketChange(row.change, row.changeUnit);
    const color = row.change == null || row.change === 0
      ? colors.textDim
      : row.change > 0 ? colors.positive : colors.negative;
    return { text, color };
  }
  if (column.id === "percentile") return { text: row.percentile.value == null ? "--" : row.percentile.value.toFixed(0) };
  return { text: row.asOf ?? "--", color: row.status === "stale" ? colors.warning : colors.textDim };
}

export function MoneyMarketsPane({ width, height, focused }: PaneProps) {
  const loader = useCallback((force: boolean) => loadMoneyMarkets(force), []);
  const resource = useAsyncResource(loader, { initialData: getCachedMoneyMarkets, clearOnError: isAccessDenied });
  const [tabSetting, setTab] = usePaneSettingValue("tab", "rates");
  const tab = TABS.some((entry) => entry.value === tabSetting) ? tabSetting : "rates";
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", null);
  const [sort, setSort] = useState<SortPreference>({ columnId: null, direction: "asc" });
  const data = resource.data?.payload ?? null;
  const stale = !!resource.data?.stale;
  const rows = useMemo(() => data ? moneyMarketRows(data, tab) : [], [data, tab]);
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const value = (row: MoneyMarketRow): string | number | null => {
      switch (sort.columnId) {
        case "label": return row.label;
        case "value": return row.value;
        case "change": return row.change;
        case "percentile": return row.percentile.value;
        case "asOf": return row.asOf;
        default: return null;
      }
    };
    if (sort.columnId == null) return 0;
    return compareNullable(value(a), value(b), sort.direction);
  }), [rows, sort]);
  const selected = sorted.find((row) => row.id === selectedId) ?? sorted[0] ?? null;
  const curves = useMemo(() => data ? moneyMarketCurves(data, {
    current: colors.positive,
    ghosts: {
      "1W": colors.textDim,
      "1M": blendHex(colors.textDim, colors.warning, 0.45),
      "1Y": colors.textMuted,
    },
  }) : [], [data]);
  const bills = tab === "bills";
  const series = useMemo(() => {
    if (bills) return billSeries(curves);
    return selected ? historySeries(selected) : [];
  }, [bills, curves, selected]);
  const chartRows = series.some((entry) => entry.points.length >= 2) && height >= 16
    ? Math.min(12, height - 10)
    : 0;
  const tableHeight = Math.max(3, height - 1 - 2 - chartRows);
  const slope = data?.billsCurve.slope;
  const todayCurve = curves.find((curve) => curve.id === "today");
  const selectedTenor = selected?.seriesId
    ? todayCurve?.points.find((point) => point.seriesId === selected.seriesId) ?? null
    : null;
  const lookbacks = bills && selectedTenor
    ? curves.filter((curve) => curve.id !== "today").flatMap((curve) => {
      const point = curve.points.find((entry) => entry.seriesId === selectedTenor.seriesId);
      if (!point) return [];
      return [`${curve.label} ago ${moneyMarketRateChange(selectedTenor.value - point.value)}`];
    })
    : [];
  const summary = selected
    ? `${selected.label} ${moneyMarketValue(selected.value, selected.unit)}  ${moneyMarketChange(selected.change, selected.changeUnit)}  ${selected.percentile.value == null ? "pctl --" : `${selected.percentile.value.toFixed(0)} pctl 1Y`}`
    : "";
  const detail = bills
    ? [
      slope?.valueBps == null ? "1Y-4W --" : `1Y-4W ${slope.valueBps > 0 ? "+" : ""}${slope.valueBps.toFixed(1)}bp`,
      selectedTenor ? `${selectedTenor.label} ${moneyMarketValue(selectedTenor.value, "percent")}` : null,
      ...lookbacks,
    ].filter(Boolean).join("   ")
    : "Rate history runs across bank holidays";

  useAutoRefresh(resource.updatedAt, () => { void resource.load(); });
  usePaneStatusLinkFooter({
    registrationId: "money-markets",
    focused,
    url: selected?.sourceUrl ?? null,
    showOpenHint: !!selected?.sourceUrl,
    loading: resource.loading,
    error: data ? null : resource.error,
    info: !resource.loading && stale
      ? [{ id: "stale", parts: [{ text: "stale", tone: "warning" as const }] }]
      : [],
  });

  const formatAxis = selected && !bills
    ? moneyMarketAxis(selected.unit)
    : (value: number) => moneyMarketValue(value, "percent");

  return (
    <Box width={width} height={height} flexDirection="column">
      <PaneTabHeader width={width} focused={focused} tabs={TABS} activeValue={tab} onSelect={setTab} />
      {!data ? (
        <PaneStatusBody
          loading={resource.loading}
          error={resource.error}
          empty={!resource.loading && !resource.error}
          subject="money markets"
        />
      ) : (
        <Box width={width} flexDirection="column" flexGrow={1}>
          <Box height={1} paddingX={1} flexShrink={0}>
            <Text fg={colors.textBright}>{clip(summary, width)}</Text>
          </Box>
          <Box height={1} paddingX={1} flexShrink={0}>
            <Text fg={colors.textDim}>{clip(detail, width)}</Text>
          </Box>
          {chartRows > 0 ? (
            <Box height={chartRows} flexShrink={0}>
              <CompositeChart
                series={series}
                panels={PANELS}
                width={width}
                height={chartRows}
                focused={focused}
                navigable={false}
                showLegend
                showTimeAxis={!bills}
                formatAxisValue={formatAxis}
                formatValue={(value) => bills ? moneyMarketValue(value, "percent") : moneyMarketValue(value, selected?.unit ?? "percent")}
                remoteKind={bills ? "money-market-bills" : "money-market-history"}
                emptyMessage={selected ? `No history for ${selected.label}` : "No history"}
                onCursorDateChange={bills ? (date) => {
                  if (!date) return;
                  const today = curves.find((curve) => curve.id === "today");
                  if (!today) return;
                  let best: { seriesId: string; dist: number } | null = null;
                  for (const point of today.points) {
                    const dist = Math.abs(point.x * YEAR_MS - date.getTime());
                    if (!best || dist < best.dist) best = { seriesId: point.seriesId, dist };
                  }
                  const match = best;
                  const row = match ? rows.find((entry) => entry.seriesId === match.seriesId) : null;
                  if (row) setSelectedId(row.id);
                } : undefined}
              />
            </Box>
          ) : null}
          <DataTableView
            columns={COLUMNS}
            items={sorted}
            selection={{
              kind: "id",
              selectedId: selected?.id ?? null,
              getId: (row) => row.id,
              onChange: (id) => setSelectedId(id),
            }}
            focused={focused}
            sortColumnId={sort.columnId}
            sortDirection={sort.direction}
            onHeaderClick={(columnId) => setSort((current) => nextSortPreference(current, columnId, {
              defaultDirection: columnId === "label" || columnId === "asOf" ? "asc" : "desc",
            }))}
            getItemKey={(row) => row.id}
            renderCell={cell}
            rootWidth={width}
            rootHeight={tableHeight}
            emptyStateTitle="No money-market observations"
          />
        </Box>
      )}
    </Box>
  );
}
