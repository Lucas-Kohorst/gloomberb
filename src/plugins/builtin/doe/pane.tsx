import { useMemo } from "react";
import type { DoeBoardPayload, DoeSeriesRow, DoeTab } from "../../../api-client/doe";
import {
  buildSectionedRows,
  ChartTableHeader,
  CompositeChart,
  DataTableView,
  EMPTY_TABLE_CELL,
  isSectionedItemRow,
  PaneStatusBody,
  QueryBar,
  renderSectionedRowHeader,
  usePaneNoticeFooter,
  usePaneStatusFooter,
  usePaneTabs,
  type ChartTableChart,
  type DataTableCell,
  type DataTableColumn,
  type SectionedRow,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, useAutoRefresh, usePaneSettingValue, usePluginPaneState } from "../../../public/react";
import { usePaneInstance } from "../../../state/app/context";
import { useThemeColors } from "../../../theme/theme-context";
import type { ResolvedSeries } from "../../../time-series/types";
import type { PaneProps } from "../../../types/plugin";
import { Box, Text } from "../../../ui";
import { truncateToDisplayWidth } from "../../../utils/format";
import { DOE_NOT_AVAILABLE, getCachedDoeBoard, loadDoeBoard } from "./client";
import {
  DOE_TABS,
  DOE_UNIT_LABEL,
  doeAxisFormatter,
  doeHeaderLine,
  doeReport,
  doeRows,
  doeSeasonalSeries,
  doeSeasonalStrip,
  doeTab,
  doeWeekDate,
  doeWeekTicks,
  formatDoeChange,
  formatDoeLevel,
  formatDoePosition,
  formatDoeVsFive,
  formatDoeVsYear,
  formatDoeWeeklyChange,
  formatDoeWeeklyLevel,
  type DoeWeeklyRow,
} from "./model";
import { DoeRangeBar } from "./range-bar";
import { getCachedDoeWeekly, loadDoeWeeklySeries } from "./weekly";

const COLUMNS: DataTableColumn[] = [
  { id: "name", label: "Series", width: 20, align: "left", flexGrow: 1 },
  { id: "level", label: "Level", width: 9, align: "right" },
  { id: "unit", label: "Unit", width: 6, align: "left" },
  { id: "change", label: "1W Δ", width: 8, align: "right" },
  { id: "year", label: "Vs 1Y", width: 8, align: "right" },
  { id: "five", label: "Vs 5Y", width: 8, align: "right" },
  { id: "range", label: "5Y Range", width: 12, align: "left" },
];
const PANELS = [{ id: "main" }];
/** Legend, four plot rows, the week axis and the read under it. */
const CHART_MIN_ROWS = 7;

function legendValue(row: DoeSeriesRow) {
  return (value: number) => `${value.toLocaleString("en-US", { minimumFractionDigits: row.unit === "kb" || row.unit === "pct" ? 1 : 0,
    maximumFractionDigits: row.unit === "kb" || row.unit === "pct" ? 1 : 0 })}${row.unit === "pct" ? "%" : ""}`;
}

/**
 * The selected series over its year: this year's line, last year's, and the
 * five-year average inside the shaded five-year range, on weeks of the year.
 * The cursor rests on the latest week, so the legend reads that week across
 * the years; the plain read sits under the axis.
 */
function SeasonalChart({ row, series, width, height }: { row: DoeSeriesRow; series: ResolvedSeries[]; width: number; height: number }) {
  const colors = useThemeColors();
  const weeks = row.seasonal?.weeks ?? 52;
  const latestWeek = row.seasonal?.current.at(-1)?.[0] ?? null;
  const viewport = useMemo(() => ({ start: doeWeekDate(1), end: doeWeekDate(weeks) }), [weeks]);
  const xAxis = useMemo(() => ({ ticks: doeWeekTicks(weeks), formatCursor: (ratio: number) => `W${Math.round(ratio * (weeks - 1)) + 1}` }), [weeks]);
  const read = row.read ? truncateToDisplayWidth(row.read, Math.max(0, width - 2)) : "";
  return (
    <Box width={width} height={height} flexDirection="column">
      <CompositeChart series={series} panels={PANELS} width={width} height={Math.max(3, height - (read ? 1 : 0))}
        focused={false} navigable={false} showLegend showTimeAxis viewport={viewport} clipToViewport xAxis={xAxis}
        cursorDate={latestWeek ? doeWeekDate(latestWeek) : null} formatValue={legendValue(row)} formatAxisValue={doeAxisFormatter(row.unit)}
        remoteKind="doe-seasonal" />
      {read ? <Box height={1} paddingX={1}><Text fg={colors.textMuted}>{read}</Text></Box> : null}
    </Box>
  );
}

type Listed = { kind: "inventory"; row: DoeSeriesRow } | { kind: "weekly"; row: DoeWeeklyRow };

const AS_OF_COLUMN: DataTableColumn = { id: "asof", label: "As of", width: 10, align: "left" };

function renderListed(item: Listed, column: DataTableColumn, colors: ReturnType<typeof useThemeColors>): DataTableCell {
  if (item.kind === "weekly") {
    const row = item.row;
    const failed = row.value == null && row.error != null;
    if (column.id === "name") return { text: row.label };
    if (column.id === "level") return { text: failed ? "unavailable" : formatDoeWeeklyLevel(row), color: failed ? colors.warning : colors.textBright };
    if (column.id === "unit") return { text: row.unitLabel, color: colors.textMuted };
    if (column.id === "change") return { text: formatDoeWeeklyChange(row) };
    if (column.id === "asof") return { text: row.weekEnding ?? "--", ...(row.weekEnding ? { value: row.weekEnding } : {}) };
    return { text: "--" };
  }
  const row = item.row;
  if (column.id === "name") return { text: row.label };
  if (column.id === "level") return { text: formatDoeLevel(row.unit, row.value), color: colors.textBright };
  if (column.id === "unit") return { text: DOE_UNIT_LABEL[row.unit], color: colors.textMuted };
  if (column.id === "change") return { text: formatDoeChange(row.unit, row.weekChange) };
  if (column.id === "year") return { text: formatDoeVsYear(row) };
  if (column.id === "five") return { text: formatDoeVsFive(row) };
  if (column.id === "asof") return { text: row.weekEnding ?? "--", ...(row.weekEnding ? { value: row.weekEnding } : {}) };
  return { text: formatDoePosition(row), content: <DoeRangeBar position={row.fiveYear?.position ?? null} width={column.width} /> };
}

function DoeBoard({ payload, tab, weekly, initialSeries, width, height, focused }: {
  payload: DoeBoardPayload; tab: DoeTab; weekly: readonly DoeWeeklyRow[]; initialSeries: string | null; width: number; height: number; focused: boolean;
}) {
  const colors = useThemeColors();
  const inventory = useMemo(() => doeRows(payload, tab).map((row): Listed => ({ kind: "inventory", row })), [payload, tab]);
  const items = useMemo((): Array<SectionedRow<Listed>> => {
    if (tab !== "products" || weekly.length === 0) return inventory.map((item) => ({ kind: "item", key: item.row.id, item }));
    return buildSectionedRows([
      { label: "Stocks and flows", items: inventory },
      { label: "Prices and production", items: weekly.map((row): Listed => ({ kind: "weekly", row })) },
    ], (item) => item.row.id);
  }, [inventory, tab, weekly]);
  // One selection across tabs: a row from another tab falls back to this tab's first.
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", initialSeries);
  const matched = items.find((row) => isSectionedItemRow(row) && row.item.row.id === selectedId);
  const selected = (matched && isSectionedItemRow(matched) ? matched.item : undefined)
    ?? items.find(isSectionedItemRow)?.item
    ?? null;
  const chartRow = selected?.kind === "inventory" ? selected.row : null;
  const series = useMemo(() => chartRow ? doeSeasonalSeries(chartRow, colors) : [], [chartRow, colors]);
  const meta = doeHeaderLine(doeReport(payload, tab));
  const columns = tab === "products" ? [...COLUMNS, AS_OF_COLUMN] : COLUMNS;
  const chart: ChartTableChart | null = chartRow && series.length ? {
    render: (size) => <SeasonalChart row={chartRow} series={series} width={size.width} height={size.height} />,
    minRows: CHART_MIN_ROWS,
    strip: doeSeasonalStrip(chartRow, colors.positive),
  } : null;
  return (
    <DataTableView<SectionedRow<Listed>> columns={columns} items={items} focused={focused} rootWidth={width} rootHeight={height}
      rootBefore={<ChartTableHeader width={width} height={height} tableRows={items.length} tableColumns={columns}
        query={meta ? <QueryBar width={width} meta={meta} /> : undefined} chart={chart} />}
      selection={{ kind: "id", selectedId: selected?.row.id ?? null, getId: (item) => item.key, onChange: setSelectedId }}
      isNavigable={isSectionedItemRow} renderSectionHeader={renderSectionedRowHeader}
      onActivate={(item) => { if (isSectionedItemRow(item)) setSelectedId(item.item.row.id); }}
      getItemKey={(item) => item.key} sortColumnId={null} sortDirection="asc"
      selectedTextOverridesCellColor
      renderCell={(item, column) => isSectionedItemRow(item) ? renderListed(item.item, column, colors) : EMPTY_TABLE_CELL}
      emptyStateTitle="No series in this report yet." />
  );
}

export function DoePane({ width, height, focused }: PaneProps) {
  // The template, `--tab` and the settings menu choose the first tab; the strip moves it after.
  const [openingTab] = usePaneSettingValue<string>("tab", "crude");
  const [storedTab, setTab] = usePluginPaneState<string>("tab", openingTab);
  const tab = doeTab(storedTab);
  const initialSeries = usePaneInstance()?.params?.series ?? null;
  const resource = useAsyncResource(loadDoeBoard, { initialData: getCachedDoeBoard });
  const weeklyResource = useAsyncResource(loadDoeWeeklySeries, { initialData: getCachedDoeWeekly });
  const data = resource.data?.payload ?? null;
  const weeklyRows = weeklyResource.data?.rows ?? [];
  const weeklyErrors = tab === "products" ? weeklyResource.data?.errors ?? [] : [];
  // The server not serving the board yet is a state of the data, not a failure.
  const notAvailable = !data && resource.error === DOE_NOT_AVAILABLE;
  const { strip, rows: tabRows } = usePaneTabs(data ? { tabs: [...DOE_TABS], activeValue: tab, onSelect: setTab, focused, dense: true } : null);
  useAutoRefresh(resource.updatedAt, () => {
    void resource.load();
    void weeklyResource.load();
  });
  usePaneRefreshKey(() => {
    void resource.reload();
    void weeklyResource.reload();
  }, { focused });
  usePaneNoticeFooter({ registrationId: "doe:notices", focused,
    notices: [...(data?.gaps ?? []), ...(resource.data?.refreshError ? [resource.data.refreshError] : [])] });
  const footerError = [resource.error, ...weeklyErrors].filter((entry): entry is string => !!entry).join(" · ");
  usePaneStatusFooter({ registrationId: "doe", loading: resource.loading || (tab === "products" && weeklyResource.loading),
    error: notAvailable ? null : footerError || null,
    stale: !!data && (resource.data?.stale || (tab === "products" && !!weeklyResource.data?.stale)) });
  return (
    <Box width={width} height={height} flexDirection="column">
      {strip}
      <PaneStatusBody loading={resource.loading && !data} error={!data && !notAvailable ? resource.error : null}
        empty={notAvailable} emptyTitle={DOE_NOT_AVAILABLE} subject="oil and gas inventories">
        {data ? <DoeBoard payload={data} tab={tab} weekly={weeklyRows} initialSeries={initialSeries} width={width} height={Math.max(3, height - tabRows)} focused={focused} /> : null}
      </PaneStatusBody>
    </Box>
  );
}

