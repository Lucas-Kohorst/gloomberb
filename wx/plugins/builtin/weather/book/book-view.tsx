import { useMemo, useState } from "react";
import { Box, Text } from "../../../../../src/ui";
import {
  DataTableView,
  type DataTableCell,
  type DataTableColumn,
} from "../../../../../src/components";
import {
  CompositeChart,
  pricePointsToResolvedSeries,
} from "../../../../../src/components/chart/composite";
import { colors } from "../../../../../src/theme/colors";
import {
  applySortPreference,
  nextSortPreference,
  type SortComparableValue,
  type SortPreference,
} from "../../../../../src/utils/sort-values";
import { formatClock, type WxBookDayView, type WxBookRangeView } from "./types";

function formatTemp(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

function formatYes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}¢`;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function localClock(timestampMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(timestampMs));
  } catch {
    return new Date(timestampMs).toISOString().slice(11, 16);
  }
}

interface PrintRow {
  id: string;
  clock: string;
  tempF: number;
  runningMaxF: number;
  timestampMs: number;
}

type PrintColumnId = "clock" | "temp" | "max";

interface PrintColumn extends DataTableColumn {
  id: PrintColumnId;
}

function printSortValue(row: PrintRow, columnId: PrintColumnId): SortComparableValue {
  switch (columnId) {
    case "clock": return row.timestampMs;
    case "temp": return row.tempF;
    case "max": return row.runningMaxF;
  }
}

export function BookDayView({
  view,
  width,
  height,
}: {
  view: WxBookDayView;
  width: number;
  height?: number;
}) {
  const baseRows = useMemo(() => {
    const items: PrintRow[] = [];
    let running: number | null = null;
    for (const point of view.asos.points) {
      running = running == null || point.tempF > running ? point.tempF : running;
      items.push({
        id: String(point.t),
        clock: localClock(point.t, view.timeZone),
        tempF: point.tempF,
        runningMaxF: running,
        timestampMs: point.t,
      });
    }
    return items.reverse();
  }, [view.asos.points, view.timeZone]);

  const [selectedPrintId, setSelectedPrintId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortPreference<PrintColumnId>>({
    columnId: "clock",
    direction: "desc",
  });
  const sortedRows = useMemo(
    () => applySortPreference(baseRows, sort, printSortValue),
    [baseRows, sort],
  );
  const columns: PrintColumn[] = [
    { id: "clock", label: "TIME", width: 6, align: "left" },
    { id: "temp", label: "TEMP", width: 6, align: "right" },
    { id: "max", label: "MAX", width: 6, align: "right" },
  ];

  const hitLabel = view.hit == null ? "pending" : view.hit ? "HIT" : "MISS";
  const hitColor = view.hit == null ? colors.warning : view.hit ? colors.positive : colors.negative;
  const chartHeight = view.asos.points.length > 1 ? 8 : 0;
  const nwsSeries = useMemo(() => {
    if (view.asos.points.length < 2) return null;
    return pricePointsToResolvedSeries(
      view.asos.points.map((point) => ({ date: new Date(point.t), close: point.tempF })),
      {
        id: "nws-print",
        label: "NWS",
        color: colors.text,
        unit: "°F",
        unitGroup: "weather-temp",
        style: "line",
        panelId: "temp",
        nativeFrequency: "auto",
      },
    );
  }, [view.asos.points]);
  const favoriteSeries = useMemo(() => {
    if (!view.book || !view.favorite) return null;
    const index = view.book.strikes.findIndex((strike) => strike.ticker === view.favorite!.bucket.ticker);
    const path = index >= 0 ? view.book.paths[index] : null;
    if (!path || path.length < 2) return null;
    return pricePointsToResolvedSeries(
      path.map((point) => ({ date: new Date(point.t * 1000), close: point.yes * 100 })),
      {
        id: "fav-yes",
        label: view.favorite.bucket.label,
        color: colors.positive,
        unit: "¢",
        unitGroup: "kalshi-yes",
        style: "line",
        panelId: "yes",
        nativeFrequency: "auto",
        axis: "right",
      },
    );
  }, [view.book, view.favorite]);
  const chartSeries = [nwsSeries, favoriteSeries].filter((series) => series != null);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} paddingBottom={1} flexDirection="column">
        <Text fg={colors.text}>
          {formatClock(view.cutoff)}
          {` ${view.favorite?.bucket.label ?? "—"} ${formatYes(view.favorite?.yesPrice)} vs print ${formatTemp(view.settlementF, 0)}`}
        </Text>
        <Text fg={hitColor}>
          {hitLabel}
          {view.runningHighAtCutoffF != null ? ` · NWS max ${formatTemp(view.runningHighAtCutoffF, 1)} at cutoff` : ""}
          {view.asos.coverage === "empty" ? " · no ASOS window" : ""}
        </Text>
      </Box>
      {chartSeries.length > 0 && (
        <CompositeChart
          width={Math.max(20, width - 2)}
          height={chartHeight}
          focused={false}
          interactive={false}
          series={chartSeries}
          panels={chartSeries.length > 1 ? [{ id: "temp" }, { id: "yes" }] : [{ id: "temp" }]}
          axisWidth={6}
          showLegend
        />
      )}
      <DataTableView<PrintRow, PrintColumn>
        focused={false}
        rootWidth={width}
        rootHeight={Math.max(4, (height ?? 16) - 4 - chartHeight)}
        selection={{
          kind: "id",
          selectedId: selectedPrintId ?? sortedRows[0]?.id ?? "",
          getId: (row) => row.id,
          onChange: (id) => setSelectedPrintId(id),
        }}
        columns={columns}
        items={sortedRows}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(columnId) => setSort((current) => nextSortPreference(current, columnId as PrintColumnId))}
        getItemKey={(row) => row.id}
        renderCell={(row, column): DataTableCell => {
          if (column.id === "clock") return { text: row.clock };
          if (column.id === "temp") return { text: formatTemp(row.tempF, 1), align: "right" };
          return { text: formatTemp(row.runningMaxF, 1), align: "right" };
        }}
        emptyStateTitle="No NWS prints in this local day."
        emptyStateHint="weather.gov keeps about a week of 5-minute ASOS."
      />
    </Box>
  );
}

interface HistoryRow {
  id: string;
  date: string;
  dateRaw: string;
  favorite: string;
  yes: number | null;
  print: number | null;
  hit: boolean | null;
}

type HistoryColumnId = "date" | "favorite" | "yes" | "print" | "hit";

interface HistoryColumn extends DataTableColumn {
  id: HistoryColumnId;
}

function historySortValue(row: HistoryRow, columnId: HistoryColumnId): SortComparableValue {
  switch (columnId) {
    case "date": return row.dateRaw;
    case "favorite": return row.favorite;
    case "yes": return row.yes;
    case "print": return row.print;
    case "hit": return row.hit == null ? null : row.hit ? 1 : 0;
  }
}

export function BookRangeView({
  view,
  width,
  height,
}: {
  view: WxBookRangeView;
  width: number;
  height?: number;
}) {
  const baseRows: HistoryRow[] = view.rows.map((row) => ({
    id: row.date,
    date: row.date.slice(5),
    dateRaw: row.date,
    favorite: row.favoriteLabel ?? "—",
    yes: row.favoriteYes,
    print: row.settlementF,
    hit: row.hit,
  }));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sort, setSort] = useState<SortPreference<HistoryColumnId>>({
    columnId: "date",
    direction: "desc",
  });
  const sortedRows = useMemo(
    () => applySortPreference(baseRows, sort, historySortValue),
    [baseRows, sort],
  );
  const columns: HistoryColumn[] = [
    { id: "date", label: "DATE", width: 6, align: "left" },
    { id: "favorite", label: "FAV", width: Math.max(6, width - 28), align: "left" },
    { id: "yes", label: "YES", width: 5, align: "right" },
    { id: "print", label: "PRT", width: 4, align: "right" },
    { id: "hit", label: "HIT", width: 4, align: "right" },
  ];
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} paddingBottom={1}>
        <Text fg={colors.text}>
          {formatClock(view.cutoff)}
          {` hit ${formatPct(view.hitRate)} · r ${view.pearson == null ? "—" : view.pearson.toFixed(2)} · n ${view.samples}`}
        </Text>
      </Box>
      <DataTableView<HistoryRow, HistoryColumn>
        focused={false}
        rootWidth={width}
        rootHeight={Math.max(4, (height ?? 16) - 3)}
        selection={{
          kind: "id",
          selectedId: selectedDate ?? sortedRows[0]?.id ?? "",
          getId: (row) => row.id,
          onChange: (id) => setSelectedDate(id),
        }}
        columns={columns}
        items={sortedRows}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(columnId) => setSort((current) => nextSortPreference(current, columnId as HistoryColumnId))}
        getItemKey={(row) => row.id}
        renderCell={(row, column): DataTableCell => {
          if (column.id === "hit") {
            const hitText = row.hit == null ? "—" : row.hit ? "Y" : "n";
            return {
              text: hitText,
              align: "right",
              fg: row.hit === true ? colors.positive : row.hit === false ? colors.negative : colors.textMuted,
            };
          }
          if (column.id === "yes") return { text: formatYes(row.yes), align: "right" };
          if (column.id === "print") return { text: formatTemp(row.print, 0), align: "right" };
          return { text: row[column.id], align: column.align };
        }}
        emptyStateTitle="No settled Kalshi highs in this window."
      />
    </Box>
  );
}
