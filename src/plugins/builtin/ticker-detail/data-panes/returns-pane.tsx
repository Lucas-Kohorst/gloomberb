import { useCallback, useMemo, useState } from "react";
import { useShortcut } from "../../../../react/input";
import { Box, Text, TextAttributes } from "../../../../ui";
import {
  DataTableView,
  EmptyState,
  PaneListChrome,
  SelectButton,
  Button,
  Spinner,
  usePaneFooter,
  usePaneListSearch,
  type DataTableCell,
  type DataTableColumn,
} from "../../../../components";
import type { PaneProps } from "../../../../types/plugin";
import type { PricePoint } from "../../../../types/financials";
import { colors, priceColor } from "../../../../theme/colors";
import { formatDateTime } from "../../shared/ticker-request";
import { formatNumber, formatSignedPercentValue } from "../../../../utils/format";
import { useAssetData, usePluginPaneState } from "../../../runtime";
import { useBoundTicker } from "../../shared/ticker-request";
import { CHART_RESOLUTIONS, type ChartResolution, type TimeRange } from "../../../../time-series/range";
import { DEFAULT_CHART_RESOLUTION_SUPPORT, getSupportedChartResolutionsForViewport } from "../../../../time-series/resolution";
import { useEffect, useRef } from "react";
import { buildReturnRows, filterPricePointsByWindow, type ReturnRow } from "./returns-model";

type ReturnColumnId = "time" | "price" | "intervalChange" | "intervalPercent" | "cumulativeChange" | "cumulativePercent";
type ReturnRange = "6H" | "1D" | "5D" | TimeRange;
const RETURN_RANGES: ReturnRange[] = ["6H", "1D", "5D", "1W", "1M", "3M", "6M", "1Y", "5Y", "ALL"];
const RANGE_OPTIONS = RETURN_RANGES.map((value) => ({ value, label: value }));
type ReturnColumn = DataTableColumn & { id: ReturnColumnId };

const INTERVAL_OPTIONS = CHART_RESOLUTIONS.filter((value): value is Exclude<ChartResolution, "auto"> => value !== "auto")
  .map((value) => ({ value, label: value.toUpperCase() }));

function startForRange(range: ReturnRange, now: Date): Date {
  const start = new Date(now);
  switch (range) {
    case "6H": start.setHours(start.getHours() - 6); break;
    case "1D": start.setDate(start.getDate() - 1); break;
    case "5D": start.setDate(start.getDate() - 5); break;
    case "1W": start.setDate(start.getDate() - 7); break;
    case "1M": start.setMonth(start.getMonth() - 1); break;
    case "3M": start.setMonth(start.getMonth() - 3); break;
    case "6M": start.setMonth(start.getMonth() - 6); break;
    case "1Y": start.setFullYear(start.getFullYear() - 1); break;
    case "5Y": start.setFullYear(start.getFullYear() - 5); break;
    case "ALL": start.setFullYear(start.getFullYear() - 50); break;
  }
  return start;
}

function resolutionSupportRange(range: ReturnRange): TimeRange {
  if (range === "6H" || range === "1D") return "1D";
  if (range === "5D") return "1W";
  return range;
}

function historyBufferRange(range: ReturnRange): TimeRange {
  if (range === "6H" || range === "1D") return "1D";
  if (range === "5D") return "1W";
  return range;
}

function precedingIntervalStart(start: Date, interval: Exclude<ChartResolution, "auto">): Date {
  const duration = interval === "1mo" ? 31 * 24 * 60 * 60_000
    : interval === "1wk" ? 7 * 24 * 60 * 60_000
    : interval === "1d" ? 24 * 60 * 60_000
    : interval === "4h" ? 4 * 60 * 60_000
    : interval === "1h" ? 60 * 60_000
    : interval === "45m" ? 45 * 60_000
    : interval === "30m" ? 30 * 60_000
    : interval === "15m" ? 15 * 60_000
    : interval === "5m" ? 5 * 60_000
    : 60_000;
  return new Date(start.getTime() - duration);
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : formatSignedPercentValue(value * 100);
}

export function ReturnsPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { symbol, exchange } = useBoundTicker();
  const [range, setRange] = usePluginPaneState<ReturnRange>("range", "5D");
  const [interval, setInterval] = usePluginPaneState<Exclude<ChartResolution, "auto">>("interval", "4h");
  const [sourceRows, setSourceRows] = useState<PricePoint[]>([]);
  const [endTime, setEndTime] = useState(() => Date.now());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: ReturnColumnId; direction: "asc" | "desc" }>({ id: "time", direction: "desc" });
  const generation = useRef(0);
  const end = useMemo(() => new Date(endTime), [endTime]);
  const start = useMemo(() => startForRange(range, end), [end, range]);

  const load = useCallback(async () => {
    if (!symbol || !dataProvider) {
      setSourceRows([]);
      setStatus("error");
      setError(symbol ? "Market data unavailable" : "Select an instrument");
      return;
    }
    const currentGeneration = ++generation.current;
    setStatus("loading");
    setError(null);
    setSourceRows([]);
    try {
      let points: PricePoint[];
      if (dataProvider.getDetailedPriceHistory) {
        points = await dataProvider.getDetailedPriceHistory(symbol, exchange, precedingIntervalStart(start, interval), end, interval,
          { cacheMode: "refresh" });
      } else {
        if (!dataProvider.getPriceHistoryForResolution) throw new Error("This provider does not support interval history");
        points = await dataProvider.getPriceHistoryForResolution(symbol, exchange, historyBufferRange(range), interval,
          { cacheMode: "refresh" });
      }
      if (generation.current !== currentGeneration) return;
      setSourceRows(filterPricePointsByWindow(points, precedingIntervalStart(start, interval).getTime(), end.getTime()));
      setStatus("ready");
    } catch (cause) {
      if (generation.current !== currentGeneration) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    }
  }, [dataProvider, end, exchange, interval, range, start, symbol]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const rows = useMemo(() => {
    const result = buildReturnRows(sourceRows, start.getTime())
      .filter((row) => row.timestamp <= end.getTime())
      .filter((row) => !query || formatDateTime(new Date(row.timestamp)).toLowerCase().includes(query.toLowerCase()));
    const value = (row: ReturnRow): number | string | null => {
      switch (sort.id) {
        case "time": return row.timestamp;
        case "price": return row.price;
        case "intervalChange": return row.intervalChange;
        case "intervalPercent": return row.intervalPercent;
        case "cumulativeChange": return row.cumulativeChange;
        case "cumulativePercent": return row.cumulativePercent;
      }
    };
    return result.sort((left, right) => {
      const a = value(left);
      const b = value(right);
      const order = a === null ? (b === null ? 0 : -1) : b === null ? 1
        : typeof a === "string" ? a.localeCompare(String(b)) : Number(a) - Number(b);
      return sort.direction === "asc" ? order : -order;
    });
  }, [end, query, sort, sourceRows, start]);
  const listSearch = usePaneListSearch({ focused, value: query, onQueryChange: setQuery, placeholder: "Search time" });
  const supportRange = resolutionSupportRange(range);
  const supportedIntervals = useMemo(() => dataProvider?.getChartResolutionSupport
    ? dataProvider.getChartResolutionSupport(symbol ?? "", exchange)
    : [], [dataProvider, exchange, symbol]);
  const [availableIntervals, setAvailableIntervals] = useState<Set<string>>(() => new Set(INTERVAL_OPTIONS.map((option) => option.value)));
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(supportedIntervals).then((support) => {
      if (cancelled) return;
      const windowSupported = getSupportedChartResolutionsForViewport(
        supportRange,
        support?.length ? support : DEFAULT_CHART_RESOLUTION_SUPPORT,
      );
      setAvailableIntervals(new Set(windowSupported));
      if (!windowSupported.includes(interval)) setInterval(windowSupported.at(-1) ?? "1d");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [interval, setInterval, supportRange, supportedIntervals]);

  const columns = useMemo<ReturnColumn[]>(() => [
    { id: "time", label: "TIME", width: 16, align: "left" },
    { id: "price", label: "PRICE", width: 11, align: "right" },
    { id: "intervalChange", label: "INT $", width: 11, align: "right" },
    { id: "intervalPercent", label: "INT %", width: 10, align: "right" },
    { id: "cumulativeChange", label: "TOTAL $", width: 12, align: "right" },
    { id: "cumulativePercent", label: "TOTAL %", width: 11, align: "right", flexGrow: 1 },
  ], []);
  const renderCell = useCallback((row: ReturnRow, column: ReturnColumn, _index: number, state: { selected: boolean }): DataTableCell => {
    const normal = state.selected ? colors.selectedText : colors.text;
    switch (column.id) {
      case "time": return { text: formatDateTime(new Date(row.timestamp)), color: state.selected ? normal : colors.textDim };
      case "price": return { text: formatNumber(row.price, 2), color: normal, attributes: TextAttributes.BOLD };
      case "intervalChange": return { text: row.intervalChange === null ? "—" : formatNumber(row.intervalChange, 2), color: state.selected ? normal : priceColor(row.intervalChange ?? 0) };
      case "intervalPercent": return { text: formatPercent(row.intervalPercent), color: state.selected ? normal : priceColor(row.intervalPercent ?? 0) };
      case "cumulativeChange": return { text: formatNumber(row.cumulativeChange, 2), color: state.selected ? normal : priceColor(row.cumulativeChange) };
      case "cumulativePercent": return { text: formatPercent(row.cumulativePercent), color: state.selected ? normal : priceColor(row.cumulativePercent ?? 0) };
    }
  }, []);
  const chooseRange = useCallback((next: string) => setRange(next as ReturnRange), [setRange]);
  const chooseInterval = useCallback((next: string) => setInterval(next as Exclude<ChartResolution, "auto">), [setInterval]);
  const refresh = useCallback(() => setEndTime(Date.now()), []);
  useShortcut((event) => {
    if (!focused || event.targetEditable || event.name !== "r") return;
    event.preventDefault();
    refresh();
  }, { enabled: focused });
  usePaneFooter("returns", () => ({
    info: status === "loading" ? [{ id: "loading", parts: [{ text: "Loading returns", tone: "muted" as const }] }]
      : status === "error" ? [{ id: "error", parts: [{ text: error ?? "Returns unavailable", tone: "negative" as const }] }] : [],
  }), [error, status]);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box flexDirection="row" gap={2} paddingX={1} height={1} flexShrink={0}>
        <SelectButton label="Range" value={range} options={RANGE_OPTIONS} onChange={chooseRange} />
        <SelectButton label="Interval" value={interval} options={INTERVAL_OPTIONS.map((option) => ({ ...option, disabled: !availableIntervals.has(option.value) }))} onChange={chooseInterval} />
        <Box flexGrow={1} />
        <Button label="Refresh" variant="ghost" onPress={refresh} />
      </Box>
      <PaneListChrome width={width} focused={focused} search={listSearch.search} />
      {status === "loading" && sourceRows.length === 0 ? <Spinner label="Loading returns…" />
        : status === "error" && sourceRows.length === 0 ? <EmptyState title="Returns unavailable" hint={error ?? undefined} />
          : <DataTableView<ReturnRow, ReturnColumn>
            focused={focused && !listSearch.searchFocused}
            rootWidth={width}
            rootHeight={Math.max(1, height - 2)}
            selection={{ kind: "none" }}
            columns={columns}
            items={rows}
            sortColumnId={sort.id}
            sortDirection={sort.direction}
            onHeaderClick={(id) => setSort((current) => current.id === id
              ? { id, direction: current.direction === "asc" ? "desc" : "asc" }
              : { id: id as ReturnColumnId, direction: "desc" })}
            getItemKey={(row) => row.key}
            renderCell={renderCell}
            emptyStateTitle="No return observations in this window"
            emptyStateHint={status === "error" ? error ?? undefined : undefined}
          />}
    </Box>
  );
}
