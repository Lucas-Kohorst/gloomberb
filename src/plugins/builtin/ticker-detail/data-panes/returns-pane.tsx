import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, TextAttributes } from "../../../../ui";
import {
  Button,
  DataTableView,
  QueryBar,
  loadingText,
  unavailableText,
  usePaneStatusFooter,
  useQueryBarSearch,
  type DataTableCell,
  type DataTableColumn,
  type PaneHint,
} from "../../../../components";
import { CHART_RESOLUTIONS, type TimeRange } from "../../../../time-series/range";
import {
  CHART_RESOLUTION_STEP_MS,
  DEFAULT_CHART_RESOLUTION_SUPPORT,
  getChartResolutionLabel,
  getSupportedChartResolutionsForViewport,
  type ManualChartResolution,
} from "../../../../time-series/resolution";
import type { PaneProps } from "../../../../types/plugin";
import type { PricePoint } from "../../../../types/financials";
import { colors, priceColor } from "../../../../theme/colors";
import { formatNumber, formatPercent } from "../../../../utils/format";
import { compareSortValues, nextHeaderSort, type SortDirection } from "../../../../utils/sort-values";
import { useAssetData, usePluginPaneState } from "../../../runtime";
import { useBoundTicker, useTickerRequest } from "../../shared/ticker-request";
import { buildReturnRows, filterPricePointsByWindow, type ReturnRow } from "./returns-model";

type ReturnColumnId = "time" | "price" | "intervalChange" | "intervalPercent" | "cumulativeChange" | "cumulativePercent";
type ReturnColumn = DataTableColumn & { id: ReturnColumnId };
type ReturnRange = "6H" | "1D" | "5D" | TimeRange;

const RETURN_RANGES: readonly ReturnRange[] = ["6H", "1D", "5D", "1W", "1M", "3M", "6M", "1Y", "5Y", "ALL"];
const INTERVAL_OPTIONS = CHART_RESOLUTIONS.filter((value): value is ManualChartResolution => value !== "auto");
const SEARCH_MIN_ROWS = 8;
const REFRESH_WIDTH = 7;

const COLUMNS: ReturnColumn[] = [
  { id: "time", label: "TIME", width: 16, align: "left" },
  { id: "price", label: "PRICE", width: 10, align: "right", flexGrow: 1 },
  { id: "intervalChange", label: "INT $", width: 10, align: "right", flexGrow: 1 },
  { id: "intervalPercent", label: "INT %", width: 9, align: "right", flexGrow: 1 },
  { id: "cumulativeChange", label: "TOTAL $", width: 10, align: "right", flexGrow: 1 },
  { id: "cumulativePercent", label: "TOTAL %", width: 9, align: "right", flexGrow: 1 },
];

interface ReturnSeries {
  points: PricePoint[];
  visibleFrom: number;
  visibleTo: number;
}

function supportRange(range: ReturnRange): TimeRange {
  switch (range) {
    case "6H":
    case "1D":
      return "1D";
    case "5D":
      return "1W";
    default:
      return range;
  }
}

function startForRange(range: ReturnRange, now: Date): Date {
  const start = new Date(now);
  switch (range) {
    case "6H":
      start.setHours(start.getHours() - 6);
      break;
    case "1D":
      start.setDate(start.getDate() - 1);
      break;
    case "5D":
      start.setDate(start.getDate() - 5);
      break;
    case "1W":
      start.setDate(start.getDate() - 7);
      break;
    case "1M":
      start.setMonth(start.getMonth() - 1);
      break;
    case "3M":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6M":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1Y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "5Y":
      start.setFullYear(start.getFullYear() - 5);
      break;
    case "ALL":
      start.setFullYear(start.getFullYear() - 50);
      break;
  }
  return start;
}

function precedingIntervalStart(start: Date, resolution: ManualChartResolution): Date {
  const duration = resolution === "1mo" ? 31 * 24 * 60 * 60_000 : CHART_RESOLUTION_STEP_MS[resolution];
  return new Date(start.getTime() - duration);
}

function formatDateTime(date: Date): string {
  const iso = date.toISOString();
  const hasTime = date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0;
  return hasTime ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10);
}

function formatMaybeNumber(value: number | null): string {
  return value == null ? "—" : formatNumber(value, 2);
}

function formatMaybePercent(value: number | null): string {
  return value == null ? "—" : formatPercent(value);
}

function sortValue(row: ReturnRow, id: ReturnColumnId): number | null {
  switch (id) {
    case "time":
      return row.timestamp;
    case "price":
      return row.price;
    case "intervalChange":
      return row.intervalChange;
    case "intervalPercent":
      return row.intervalPercent;
    case "cumulativeChange":
      return row.cumulativeChange;
    case "cumulativePercent":
      return row.cumulativePercent;
  }
}

function renderReturnCell(row: ReturnRow, column: ReturnColumn): DataTableCell {
  switch (column.id) {
    case "time":
      return { text: formatDateTime(new Date(row.timestamp)), value: new Date(row.timestamp).toISOString(), color: colors.textDim };
    case "price":
      return { text: formatMaybeNumber(row.price), value: row.price, color: colors.textBright, attributes: TextAttributes.BOLD };
    case "intervalChange":
      return { text: formatMaybeNumber(row.intervalChange), value: row.intervalChange, color: priceColor(row.intervalChange ?? 0) };
    case "intervalPercent":
      return { text: formatMaybePercent(row.intervalPercent), value: row.intervalPercent == null ? null : row.intervalPercent * 100, color: priceColor(row.intervalPercent ?? 0) };
    case "cumulativeChange":
      return { text: formatMaybeNumber(row.cumulativeChange), value: row.cumulativeChange, color: priceColor(row.cumulativeChange) };
    case "cumulativePercent":
      return { text: formatMaybePercent(row.cumulativePercent), value: row.cumulativePercent == null ? null : row.cumulativePercent * 100, color: priceColor(row.cumulativePercent ?? 0) };
  }
}

export function ReturnsPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { symbol, exchange } = useBoundTicker();
  const [range, setRange] = usePluginPaneState<ReturnRange>("range", "5D");
  const [resolution, setResolution] = usePluginPaneState<ManualChartResolution>("interval", "1h");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ columnId: ReturnColumnId; direction: SortDirection }>({ columnId: "time", direction: "desc" });
  const [availableResolutions, setAvailableResolutions] = useState<ReadonlySet<ManualChartResolution>>(() => new Set(INTERVAL_OPTIONS));
  const { active: searchActive, focus: focusSearch, blur: blurSearch, searchProps } = useQueryBarSearch();

  const loader = useCallback(async (nextSymbol: string, nextExchange: string, forceRefresh: boolean): Promise<ReturnSeries> => {
    if (!dataProvider) throw new Error("Market data unavailable");
    const end = new Date();
    const start = startForRange(range, end);
    const from = precedingIntervalStart(start, resolution);
    const context = forceRefresh ? { cacheMode: "refresh" as const } : undefined;
    const points = dataProvider.getDetailedPriceHistory
      ? await dataProvider.getDetailedPriceHistory(nextSymbol, nextExchange, from, end, resolution, context)
      : dataProvider.getPriceHistoryForResolution
        ? await dataProvider.getPriceHistoryForResolution(nextSymbol, nextExchange, supportRange(range), resolution, context)
        : await dataProvider.getPriceHistory(nextSymbol, nextExchange, supportRange(range), context);
    return {
      points: filterPricePointsByWindow(points, from.getTime(), end.getTime()),
      visibleFrom: start.getTime(),
      visibleTo: end.getTime(),
    };
  }, [dataProvider, range, resolution]);
  const { data, loading, error, reload } = useTickerRequest(loader, symbol, exchange);

  const resolutionSupport = useMemo(() => {
    if (!dataProvider?.getChartResolutionSupport) return [];
    try {
      return dataProvider.getChartResolutionSupport(symbol ?? "", exchange);
    } catch {
      return [];
    }
  }, [dataProvider, exchange, symbol]);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(resolutionSupport).then((support) => {
      if (cancelled) return;
      const available = getSupportedChartResolutionsForViewport(
        supportRange(range),
        support.length > 0 ? support : DEFAULT_CHART_RESOLUTION_SUPPORT,
      );
      setAvailableResolutions(new Set(available));
      if (!available.includes(resolution)) setResolution(available.at(-1) ?? "1d");
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [range, resolution, resolutionSupport, setResolution]);

  const table = useMemo(() => {
    const built = buildReturnRows(data?.points ?? [], data?.visibleFrom)
      .filter((row) => !data || row.timestamp <= data.visibleTo);
    const searchable = built.length >= SEARCH_MIN_ROWS;
    const needle = searchable ? query.trim().toLowerCase() : "";
    const rows = (needle
      ? built.filter((row) => formatDateTime(new Date(row.timestamp)).toLowerCase().includes(needle))
      : built.slice()
    ).sort((left, right) => compareSortValues(sortValue(left, sort.columnId), sortValue(right, sort.columnId), sort.direction));
    return { rows, searchable };
  }, [data, query, sort]);

  useEffect(() => {
    if (table.searchable) return;
    if (query) setQuery("");
    if (searchActive) blurSearch();
  }, [blurSearch, query, searchActive, table.searchable]);

  const hints = useMemo<PaneHint[]>(() => (
    table.searchable ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : []
  ), [focusSearch, table.searchable]);
  usePaneStatusFooter({ registrationId: "returns", loading, error, hints });

  const chooseSort = useCallback((id: string) => {
    setSort((current) => nextHeaderSort(current, id as ReturnColumnId, { firstDirection: "desc" }));
  }, []);

  return (
    <DataTableView<ReturnRow, ReturnColumn>
      focused={focused && !searchActive}
      selection={{ kind: "none" }}
      rootWidth={width}
      rootHeight={height}
      columns={COLUMNS}
      items={table.rows}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={chooseSort}
      getItemKey={(row) => row.key}
      renderCell={renderReturnCell}
      selectedTextOverridesCellColor
      rootBefore={(
        <Box flexDirection="row" width={width} height={1} flexShrink={0}>
          <QueryBar
            width={Math.max(1, width - REFRESH_WIDTH - 1)}
            search={table.searchable ? {
              value: query,
              onChange: setQuery,
              placeholder: "date or time",
              focused,
              ...searchProps,
            } : undefined}
            filters={[{
              id: "range",
              label: "Range",
              value: range,
              options: RETURN_RANGES.map((value) => ({ value, label: value })),
              onChange: setRange,
            }, {
              id: "interval",
              label: "Interval",
              value: resolution,
              options: INTERVAL_OPTIONS.map((value) => ({
                value,
                label: getChartResolutionLabel(value),
                disabled: !availableResolutions.has(value),
              })),
              onChange: setResolution,
            }]}
          />
          <Button label="Refresh" variant="plain" compact width={REFRESH_WIDTH} onPress={reload} />
        </Box>
      )}
      emptyStateTitle={error
        ? unavailableText("Returns")
        : loading
          ? loadingText("returns")
          : query.trim()
            ? "No matching times"
            : "No return observations in this window"}
      emptyStateHint={error ?? undefined}
    />
  );
}
