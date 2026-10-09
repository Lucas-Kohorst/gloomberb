import { useEffect, useMemo, useState } from "react";
import type { DoeBoardPayload, DoeSeriesRow, DoeTab } from "../../../api-client/doe";
import {
  ChartTableHeader,
  CompositeChart,
  DataTableView,
  NestedPaneTabs,
  PaneFooterScope,
  PaneStatusBody,
  QueryBar,
  usePaneNoticeFooter,
  usePaneStatusFooter,
  usePaneTabs,
  type ChartTableChart,
  type DataTableColumn,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, useAutoRefresh, usePaneSettingValue, usePluginPaneState } from "../../../public/react";
import { usePaneInstance } from "../../../state/app/context";
import { useThemeColors } from "../../../theme/theme-context";
import type { ResolvedSeries } from "../../../time-series/types";
import type { PaneProps } from "../../../types/plugin";
import { Box, Text } from "../../../ui";
import { truncateToDisplayWidth } from "../../../utils/format";
import { JodiPane } from "../jodi/pane";
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
} from "./model";
import { DoeRangeBar } from "./range-bar";

const REPORT_TABS = [...DOE_TABS, { value: "world", label: "World" }];
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

function DoeBoard({ payload, tab, initialSeries, width, height, focused }: {
  payload: DoeBoardPayload; tab: DoeTab; initialSeries: string | null; width: number; height: number; focused: boolean;
}) {
  const colors = useThemeColors();
  const rows = useMemo(() => doeRows(payload, tab), [payload, tab]);
  // One selection across tabs: a row from another tab falls back to this tab's first.
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", initialSeries);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const series = useMemo(() => selected ? doeSeasonalSeries(selected, colors) : [], [selected, colors]);
  const meta = doeHeaderLine(doeReport(payload, tab));
  const chart: ChartTableChart | null = selected && series.length ? {
    render: (size) => <SeasonalChart row={selected} series={series} width={size.width} height={size.height} />,
    minRows: CHART_MIN_ROWS,
    strip: doeSeasonalStrip(selected, colors.positive),
  } : null;
  return (
    <DataTableView<DoeSeriesRow> columns={COLUMNS} items={rows} focused={focused} rootWidth={width} rootHeight={height}
      rootBefore={<ChartTableHeader width={width} height={height} tableRows={rows.length} tableColumns={COLUMNS}
        query={meta ? <QueryBar width={width} meta={meta} /> : undefined} chart={chart} />}
      selection={{ kind: "id", selectedId: selected?.id ?? null, getId: (row) => row.id, onChange: setSelectedId }}
      onActivate={(row) => setSelectedId(row.id)} getItemKey={(row) => row.id} sortColumnId={null} sortDirection="asc"
      selectedTextOverridesCellColor
      renderCell={(row, column) => {
        if (column.id === "name") return { text: row.label };
        if (column.id === "level") return { text: formatDoeLevel(row.unit, row.value), color: colors.textBright };
        if (column.id === "unit") return { text: DOE_UNIT_LABEL[row.unit], color: colors.textMuted };
        if (column.id === "change") return { text: formatDoeChange(row.unit, row.weekChange) };
        if (column.id === "year") return { text: formatDoeVsYear(row) };
        if (column.id === "five") return { text: formatDoeVsFive(row) };
        return { text: formatDoePosition(row), content: <DoeRangeBar position={row.fiveYear?.position ?? null} width={column.width} /> };
      }}
      emptyStateTitle="No series in this report yet." />
  );
}

export function DoePane({ width, height, focused }: PaneProps) {
  // The template, `--tab` and the settings menu choose the first tab; the strip moves it after.
  const [openingTab] = usePaneSettingValue<string>("tab", "crude");
  const [storedTab, setTab] = usePluginPaneState<string>("tab", openingTab);
  const world = storedTab === "world";
  const tab = doeTab(world ? "crude" : storedTab);
  const [mounted, setMounted] = useState(() => new Set([storedTab]));
  useEffect(() => { setMounted((current) => current.has(storedTab) ? current : new Set([...current, storedTab])); }, [storedTab]);
  const initialSeries = usePaneInstance()?.params?.series ?? null;
  const resource = useAsyncResource(loadDoeBoard, { initialData: getCachedDoeBoard });
  const data = resource.data?.payload ?? null;
  // The server not serving the board yet is a state of the data, not a failure.
  const notAvailable = !data && resource.error === DOE_NOT_AVAILABLE;
  const { strip, rows: tabRows } = usePaneTabs({ tabs: REPORT_TABS, activeValue: world ? "world" : tab, onSelect: setTab, focused, dense: true });
  const bodyHeight = Math.max(1, height - tabRows);
  useAutoRefresh(resource.updatedAt, resource.load);
  usePaneRefreshKey(() => void resource.reload(), { focused, enabled: !world });
  usePaneNoticeFooter({ registrationId: "doe:notices", focused,
    notices: world ? [] : [...(data?.gaps ?? []), ...(resource.data?.refreshError ? [resource.data.refreshError] : [])] });
  usePaneStatusFooter({ registrationId: "doe", loading: world ? false : resource.loading, error: world || notAvailable ? null : resource.error,
    stale: world ? false : !!data && resource.data?.stale });
  return (
    <Box width={width} height={height} flexDirection="column">
      {strip}
      {mounted.has("world") ? <Box visible={world} width={width} height={bodyHeight} flexGrow={1} flexBasis={0} overflow="hidden">
        <NestedPaneTabs>
          <PaneFooterScope active={world}>
            <JodiPane nested width={width} height={bodyHeight} focused={focused && world} />
          </PaneFooterScope>
        </NestedPaneTabs>
      </Box> : null}
      {world ? null : <PaneStatusBody loading={resource.loading && !data} error={!data && !notAvailable ? resource.error : null}
        empty={notAvailable} emptyTitle={DOE_NOT_AVAILABLE} subject="oil and gas inventories">
        {data ? <DoeBoard payload={data} tab={tab} initialSeries={initialSeries} width={width} height={bodyHeight} focused={focused} /> : null}
      </PaneStatusBody>}
    </Box>
  );
}

