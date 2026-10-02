import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { CompositeChart } from "../../../components/chart/composite";
import { scalarPoint, staticSeries } from "../../../components/chart/static/series";
import {
  DataTableView,
  EmptyState,
  PaneStatusBody,
  PaneTabHeader,
  SelectButton,
  usePaneNoticeFooter,
  type DataTableColumn,
} from "../../../components";
import { useAsyncResource, useAutoRefresh, usePaneSettingValue, usePaneTicker, usePluginPaneState, useShortcut } from "../../../public/react";
import { useThemeColors } from "../../../theme/theme-context";
import type { ResolvedSeries } from "../../../time-series/types";
import type { PaneProps } from "../../../types/plugin";
import { Box, Text } from "../../../ui";
import { formatCompact } from "../../../utils/format";
import { isPlainKey } from "../../../utils/keyboard";
import { usePaneStatusFooter } from "../shared/pane-footer";
import {
  loadGamma,
  loadOpenInterest,
  positioningSymbol,
  type ExpiryOpenInterest,
  type GammaPayload,
  type GammaStrike,
  type OpenInterestPayload,
  type StrikeOpenInterest,
} from "./client";
import {
  ALL_EXPIRIES,
  chartWindow,
  expiryAxis,
  expiryLabel,
  formatCount,
  formatCountChange,
  formatDistance,
  formatGamma,
  formatLevel,
  formatPayout,
  formatRatio,
  formatStrike,
  isPositioningTab,
  POSITIONING_TABS,
  strikeAxis,
  type PositioningTab,
} from "./model";

const PANELS = [{ id: "main" }];
const CHART_ROWS = 8;

type Sort = { columnId: string; direction: "asc" | "desc" };

const strikeKey = (row: { strike: number }) => String(row.strike);
const total = (row: { callOI: number | null; putOI: number | null }) => (row.callOI ?? 0) + (row.putOI ?? 0);
const shortDate = (date: string) => expiryLabel(date).replace(/ '\d\d$/, "");

function nextHeaderSort(current: Sort, columnId: string): Sort {
  if (current.columnId !== columnId) return { columnId, direction: "asc" };
  return { columnId, direction: current.direction === "asc" ? "desc" : "asc" };
}

function sortRows<T>(rows: readonly T[], sort: Sort, value: (row: T, columnId: string) => number | string | null): T[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return rows.toSorted((left, right) => {
    const a = value(left, sort.columnId);
    const b = value(right, sort.columnId);
    if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
    return (a < b ? -1 : a > b ? 1 : 0) * direction;
  });
}

function nearestStrike(rows: readonly { strike: number }[], value: number): number {
  return rows.reduce((best, row) => Math.abs(row.strike - value) < Math.abs(best - value) ? row.strike : best, rows[0]?.strike ?? value);
}

function useKept<T>(value: T | null): T | null {
  const ref = useRef<T | null>(null);
  if (value) ref.current = value;
  return value ?? ref.current;
}

function strikeColumns(changes: boolean): DataTableColumn[] {
  return [
    { id: "strike", label: "Strike", width: 9, align: "left" },
    { id: "callOI", label: "Call OI", width: 10, align: "right" },
    ...(changes ? [{ id: "callChange", label: "Call chg", width: 9, align: "right" as const }] : []),
    { id: "putOI", label: "Put OI", width: 10, align: "right" },
    ...(changes ? [{ id: "putChange", label: "Put chg", width: 9, align: "right" as const }] : []),
    { id: "payout", label: "Payout $", width: 10, align: "right" },
  ];
}

function expiryColumns(changes: boolean): DataTableColumn[] {
  return [
    { id: "date", label: "Expiry", width: 11, align: "left" },
    { id: "days", label: "Days", width: 5, align: "right" },
    { id: "callOI", label: "Call OI", width: 11, align: "right" },
    { id: "putOI", label: "Put OI", width: 11, align: "right" },
    { id: "putCallRatio", label: "P/C", width: 6, align: "right" },
    ...(changes ? [{ id: "change", label: "OI chg", width: 10, align: "right" as const }] : []),
    { id: "maxPain", label: "Max pain", width: 9, align: "right" },
    { id: "distance", label: "Vs spot", width: 8, align: "right" },
  ];
}

const GAMMA_COLUMNS: DataTableColumn[] = [
  { id: "strike", label: "Strike", width: 9, align: "left" },
  { id: "calls", label: "Call GEX $", width: 11, align: "right" },
  { id: "puts", label: "Put GEX $", width: 11, align: "right" },
  { id: "net", label: "Net GEX $", width: 11, align: "right" },
  { id: "distance", label: "Vs spot", width: 8, align: "right" },
];

function PositioningChart({ width, height, series, ticks, guides, formatCursor, formatValue, remoteKind, legend }: {
  width: number;
  height: number;
  series: ResolvedSeries[];
  ticks: Array<{ label: string; ratio: number }>;
  guides: Array<{ id: string; ratio: number | null; label: string; color: string }>;
  formatCursor: (ratio: number) => string;
  formatValue: (value: number) => string;
  remoteKind: string;
  legend?: string;
}) {
  const colors = useThemeColors();
  const xAxis = useMemo(() => ({
    markers: [
      ...ticks.map((tick) => ({ id: `tick-${tick.label}`, xRatio: tick.ratio, label: tick.label, color: colors.textDim, lineChar: " " })),
      ...guides.flatMap((guide) => guide.ratio != null && guide.ratio >= 0 && guide.ratio <= 1
        ? [{ id: guide.id, xRatio: guide.ratio, label: guide.label, color: guide.color, lineChar: "│" }]
        : []),
    ],
    formatCursor,
  }), [colors.textDim, formatCursor, guides, ticks]);
  return (
    <CompositeChart series={series} panels={PANELS} width={width} height={height} focused={false} navigable={false}
      showLegend showTimeAxis xAxis={xAxis} formatValue={(value) => formatValue(value)}
      formatAxisValue={(value) => formatCompact(Math.abs(value))} remoteKind={remoteKind}
      legendAccessory={legend ? <Text fg={colors.textMuted}>{legend}</Text> : undefined}
      legendAccessoryWidth={legend?.length} />
  );
}

export function OptionsPositioningPane(props: PaneProps) {
  const { symbol } = usePaneTicker();
  return symbol ? <OptionsPositioningView key={symbol} {...props} symbol={symbol} />
    : <EmptyState title="Choose an option underlying." />;
}

function OptionsPositioningView({ width, height, focused, symbol }: PaneProps & { symbol: string }) {
  const colors = useThemeColors();
  const own = (key: string) => `${key}:${symbol}`;
  const [initialTab] = usePaneSettingValue("tab", "strikes");
  const [savedTab, setTab] = usePluginPaneState<string>("opx:tab", initialTab);
  const [initialExpiry] = usePaneSettingValue("expiry", "");
  const [requestedExpiry, setRequestedExpiry] = usePluginPaneState<string | null>(own("opx:expiry"), initialExpiry || null);
  const [gammaExpiry, setGammaExpiry] = usePluginPaneState<string>(own("opx:gammaExpiry"), initialExpiry || ALL_EXPIRIES);
  const [selectedStrike, setSelectedStrike] = usePluginPaneState<string | null>(own("opx:strike"), null);
  const [selectedExpiry, setSelectedExpiry] = usePluginPaneState<string | null>(own("opx:expiryRow"), null);
  const [selectedGammaStrike, setSelectedGammaStrike] = usePluginPaneState<string | null>(own("opx:gammaStrike"), null);
  const [strikeSort, setStrikeSort] = useState<Sort>({ columnId: "strike", direction: "asc" });
  const [expirySort, setExpirySort] = useState<Sort>({ columnId: "date", direction: "asc" });
  const [gammaSort, setGammaSort] = useState<Sort>({ columnId: "strike", direction: "asc" });

  const openInterestLoader = useCallback(
    (_force: boolean, signal: AbortSignal) => loadOpenInterest(symbol, requestedExpiry, { signal }),
    [symbol, requestedExpiry],
  );
  const openInterest = useAsyncResource<OpenInterestPayload>(openInterestLoader);
  const data = useKept(openInterest.data);
  const spot = data?.spot ?? null;
  const expiries = data?.expiries ?? [];
  const shownExpiry = data?.expiry ?? requestedExpiry;
  const changes = data?.previousOiDate != null;
  const expiryDates = useMemo(() => expiries.map((row) => row.date), [expiries]);
  const tabs = useMemo(() => data?.underlying === "VIX"
    ? POSITIONING_TABS.filter((entry) => entry.value !== "gex") : POSITIONING_TABS, [data?.underlying]);
  const tab: PositioningTab = isPositioningTab(savedTab) && tabs.some((entry) => entry.value === savedTab) ? savedTab : "strikes";
  const gammaChoice = gammaExpiry !== ALL_EXPIRIES && expiryDates.includes(gammaExpiry) ? gammaExpiry : ALL_EXPIRIES;
  const gammaLoader = useCallback(
    (_force: boolean, signal: AbortSignal) => loadGamma(symbol, gammaChoice === ALL_EXPIRIES ? null : gammaChoice, { signal }),
    [symbol, gammaChoice],
  );
  const gammaReady = tab === "gex" && (!!data || gammaExpiry === ALL_EXPIRIES);
  const gamma = useAsyncResource<GammaPayload>(gammaReady ? gammaLoader : null);
  const gammaData = useKept(gamma.data);
  useAutoRefresh(openInterest.updatedAt, () => { void openInterest.load(); }, 5);
  useAutoRefresh(gamma.updatedAt, () => { void gamma.load(); }, tab === "gex" ? 1 : 0);

  const currentExpiry = tab === "gex" ? (gammaChoice === ALL_EXPIRIES ? null : gammaChoice) : shownExpiry;
  const expiryIndex = currentExpiry ? expiryDates.indexOf(currentExpiry) : -1;
  const stepExpiry = useCallback((step: -1 | 1) => {
    if (tab === "expiries" || !expiryDates.length) return;
    if (tab === "gex") {
      const next = expiryIndex + step;
      if (next < -1 || next >= expiryDates.length) return;
      setGammaExpiry(next < 0 ? ALL_EXPIRIES : expiryDates[next]!);
      return;
    }
    const next = expiryDates[expiryIndex + step];
    if (next) setRequestedExpiry(next);
  }, [expiryDates, expiryIndex, setGammaExpiry, setRequestedExpiry, tab]);
  useShortcut((event) => {
    if (!focused || event.defaultPrevented || tab === "expiries") return;
    const step = isPlainKey(event, "[") ? -1 : isPlainKey(event, "]") ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation?.();
    stepExpiry(step);
  });

  const activeResource = tab === "gex" ? gamma : openInterest;
  const activeData = tab === "gex" ? gammaData : data;
  const delayed = (tab === "gex" ? gammaData?.delayed : data?.delayed) === true;
  usePaneStatusFooter({
    registrationId: "options-positioning",
    focused,
    loading: activeResource.loading && !activeData,
    error: activeResource.error,
    info: delayed ? [{ id: "stale", parts: [{ text: "stale", tone: "warning" }] }] : [],
  });
  const notices = useMemo(() => [
    ...(data?.warnings ?? []),
    ...(tab === "gex" ? gammaData?.warnings ?? [] : []),
    ...(tab === "gex" && gammaData?.missing.length
      ? [`No volatility for ${gammaData.missing.map(shortDate).join(", ")}; left out of gamma.`] : []),
  ], [data?.warnings, gammaData, tab]);
  usePaneNoticeFooter({ registrationId: "options-positioning:notices", focused, notices });

  const expiryOptions = useMemo(() => expiries.map((row) => ({ value: row.date, label: expiryLabel(row.date) })), [expiries]);
  const strikes = data?.strikes ?? [];
  const maxPain = expiries.find((row) => row.date === shownExpiry)?.maxPain ?? null;
  const strikeRows = useMemo(() => sortRows(strikes, strikeSort, (row, id) =>
    id === "strike" ? row.strike : (row[id as keyof StrikeOpenInterest] as number | null)), [strikes, strikeSort]);
  const strikeWindow = useMemo(() => chartWindow(strikes, total, spot, [maxPain]), [strikes, spot, maxPain]);
  const strikeChart = useMemo(() => strikeWindow.length >= 3 ? strikeAxis(strikeWindow.map((row) => row.strike)) : null, [strikeWindow]);
  const nearestSpotStrike = useMemo(() => spot == null ? null : strikes.reduce<StrikeOpenInterest | null>((best, row) =>
    !best || Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best, null), [spot, strikes]);
  const strikeSelectedId = strikeRows.some((row) => strikeKey(row) === selectedStrike) ? selectedStrike!
    : nearestSpotStrike ? strikeKey(nearestSpotStrike) : strikeRows[0] ? strikeKey(strikeRows[0]) : null;
  const strikeSeries = useMemo(() => strikeChart ? [
    staticSeries(strikeWindow.map((row) => scalarPoint(strikeChart.toDate(row.strike), row.callOI ?? 0)),
      { id: "calls", label: "Call OI", color: colors.positive, style: "columns", calendarSpaced: true }),
    staticSeries(strikeWindow.map((row) => scalarPoint(strikeChart.toDate(row.strike), -(row.putOI ?? 0))),
      { id: "puts", label: "Put OI", color: colors.negative, style: "columns", calendarSpaced: true }),
  ] : [], [colors.negative, colors.positive, strikeChart, strikeWindow]);
  const callTotal = expiries.find((row) => row.date === shownExpiry);
  const renderStrike = useCallback((row: StrikeOpenInterest, column: DataTableColumn) => {
    switch (column.id) {
      case "strike": return { text: formatStrike(row.strike), color: row.strike === maxPain ? colors.warning : colors.textBright };
      case "callOI": return { text: formatCount(row.callOI), color: colors.positive };
      case "putOI": return { text: formatCount(row.putOI), color: colors.negative };
      case "callChange":
      case "putChange": {
        const change = row[column.id];
        return { text: formatCountChange(change), color: change == null || change === 0 ? colors.textMuted : change > 0 ? colors.positive : colors.negative };
      }
      case "payout": return { text: formatPayout(row.payout), color: colors.textMuted };
      default: return { text: "" };
    }
  }, [colors, maxPain]);

  const expiryRows = useMemo(() => sortRows(expiries, expirySort, (row, id) =>
    id === "date" ? row.date : id === "distance" ? (row.maxPain == null || spot == null ? null : row.maxPain / spot)
      : id === "change" ? (row.callChange == null ? null : row.callChange + (row.putChange ?? 0))
        : (row[id as keyof ExpiryOpenInterest] as number | null)), [expiries, expirySort, spot]);
  const expiryChart = useMemo(() => expiries.length >= 3 ? expiryAxis(expiryDates) : null, [expiries.length, expiryDates]);
  const expirySelectedId = expiryRows.some((row) => row.date === selectedExpiry) ? selectedExpiry!
    : shownExpiry && expiryRows.some((row) => row.date === shownExpiry) ? shownExpiry : expiryRows[0]?.date ?? null;
  const expirySeries = useMemo(() => expiryChart ? [
    staticSeries(expiries.map((row) => scalarPoint(expiryChart.toDate(row.date), row.callOI)),
      { id: "calls", label: "Call OI", color: colors.positive, style: "columns", calendarSpaced: true }),
    staticSeries(expiries.map((row) => scalarPoint(expiryChart.toDate(row.date), -row.putOI)),
      { id: "puts", label: "Put OI", color: colors.negative, style: "columns", calendarSpaced: true }),
  ] : [], [colors.negative, colors.positive, expiries, expiryChart]);
  const renderExpiry = useCallback((row: ExpiryOpenInterest, column: DataTableColumn) => {
    switch (column.id) {
      case "date": return { text: expiryLabel(row.date), color: colors.textBright };
      case "days": return { text: String(row.days), color: colors.textMuted };
      case "callOI": return { text: formatCount(row.callOI), color: colors.positive };
      case "putOI": return { text: formatCount(row.putOI), color: colors.negative };
      case "putCallRatio": return { text: formatRatio(row.putCallRatio) };
      case "change": {
        const change = row.callChange == null ? null : row.callChange + (row.putChange ?? 0);
        return { text: formatCountChange(change), color: change == null || change === 0 ? colors.textMuted : change > 0 ? colors.positive : colors.negative };
      }
      case "maxPain": return { text: row.maxPain == null ? "--" : formatStrike(row.maxPain), color: colors.warning };
      case "distance": return { text: formatDistance(row.maxPain, spot), color: colors.textMuted };
      default: return { text: "" };
    }
  }, [colors, spot]);

  const gammaSpot = gammaData?.spot ?? null;
  const gammaStrikes = gammaData?.strikes ?? [];
  const gammaRows = useMemo(() => sortRows(gammaStrikes, gammaSort, (row, id) =>
    id === "distance" ? row.strike : id === "puts" ? -row.puts : (row[id as keyof GammaStrike] as number)), [gammaStrikes, gammaSort]);
  const gammaWindow = useMemo(() => chartWindow(gammaStrikes, (row) => Math.abs(row.net), gammaSpot, [gammaData?.flip]),
    [gammaData?.flip, gammaSpot, gammaStrikes]);
  const gammaChart = useMemo(() => gammaWindow.length >= 3 ? strikeAxis(gammaWindow.map((row) => row.strike)) : null, [gammaWindow]);
  const nearestGammaStrike = useMemo(() => gammaSpot == null ? null : gammaStrikes.reduce<GammaStrike | null>((best, row) =>
    !best || Math.abs(row.strike - gammaSpot) < Math.abs(best.strike - gammaSpot) ? row : best, null), [gammaSpot, gammaStrikes]);
  const gammaSelectedId = gammaRows.some((row) => strikeKey(row) === selectedGammaStrike) ? selectedGammaStrike!
    : nearestGammaStrike ? strikeKey(nearestGammaStrike) : gammaRows[0] ? strikeKey(gammaRows[0]) : null;
  const gammaSeries = useMemo(() => gammaChart ? [
    staticSeries(gammaWindow.map((row) => scalarPoint(gammaChart.toDate(row.strike), row.net >= 0 ? row.net : null)),
      { id: "net-long", label: "Net GEX", color: colors.positive, style: "columns", calendarSpaced: true }),
    staticSeries(gammaWindow.map((row) => scalarPoint(gammaChart.toDate(row.strike), row.net < 0 ? row.net : null)),
      { id: "net-short", label: "Net GEX short", color: colors.negative, style: "columns", calendarSpaced: true }),
  ] : [], [colors.negative, colors.positive, gammaChart, gammaWindow]);
  const band = gammaData?.band;
  const shares = band ? `${Math.round(band.shareLow * 100)}-${Math.round(band.shareHigh * 100)}%` : "";
  const boxLegs = (gammaData?.boxes ?? []).map((leg) => `${shortDate(leg.expiry)} ${formatStrike(leg.strike)} x${leg.contracts}`).join("; ");
  const renderGamma = useCallback((row: GammaStrike, column: DataTableColumn) => {
    switch (column.id) {
      case "strike": return { text: formatStrike(row.strike), color: colors.textBright };
      case "calls": return { text: formatGamma(row.calls), color: colors.positive };
      case "puts": return { text: formatGamma(-row.puts), color: colors.negative };
      case "net": return { text: formatGamma(row.net), color: row.net >= 0 ? colors.positive : colors.negative };
      case "distance": return { text: formatDistance(row.strike, gammaSpot), color: colors.textMuted };
      default: return { text: "" };
    }
  }, [colors, gammaSpot]);

  const strikeColumnList = useMemo(() => strikeColumns(changes), [changes]);
  const expiryColumnList = useMemo(() => expiryColumns(changes), [changes]);
  const chartHeight = width >= 36 ? CHART_ROWS : 0;
  const tableHeight = (chrome: number) => Math.max(3, height - 1 - chrome - (chartHeight ? chartHeight : 0));

  let content: ReactNode = null;
  if (tab === "strikes") {
    const summary = callTotal
      ? `OI ${data?.oiDate ? shortDate(data.oiDate) : "--"}  Max pain ${maxPain == null ? "--" : formatStrike(maxPain)} ${formatDistance(maxPain, spot)}  Spot ${formatLevel(spot)}  P/C ${formatRatio(callTotal.putCallRatio)}  Calls ${formatCompact(callTotal.callOI)}  Puts ${formatCompact(callTotal.putOI)}`
      : "";
    content = (
      <Box flexDirection="column" width={width} flexGrow={1}>
        <Box height={1} paddingX={1} flexDirection="row" gap={2}>
          <SelectButton label="Exp" value={shownExpiry ?? ""} options={expiryOptions} onChange={setRequestedExpiry} />
        </Box>
        {summary ? <Box height={1} paddingX={1}><Text>{summary}</Text></Box> : null}
        {strikeChart && chartHeight ? <PositioningChart width={width} height={chartHeight} series={strikeSeries}
          ticks={strikeChart.ticks(Math.max(1, width - 8))}
          guides={[
            { id: "spot", ratio: spot == null ? null : strikeChart.ratio(spot), label: "spot", color: colors.textBright },
            { id: "max-pain", ratio: maxPain == null ? null : strikeChart.ratio(maxPain), label: "max pain", color: colors.warning },
          ]}
          formatCursor={(ratio) => formatStrike(nearestStrike(strikeWindow, strikeChart.at(ratio)))}
          formatValue={(value) => formatCount(Math.abs(value))} remoteKind="opx-strikes" /> : null}
        <DataTableView columns={strikeColumnList} items={strikeRows} focused={focused} rootWidth={width}
          rootHeight={tableHeight(summary ? 2 : 1)} getItemKey={strikeKey} renderCell={renderStrike}
          resetScrollKey={shownExpiry ?? ""}
          selection={{ kind: "id", selectedId: strikeSelectedId, getId: strikeKey, onChange: (id) => setSelectedStrike(id) }}
          sortColumnId={strikeSort.columnId} sortDirection={strikeSort.direction}
          onHeaderClick={(id) => setStrikeSort((current) => nextHeaderSort(current, id))}
          emptyStateTitle="No open interest on this expiry." />
      </Box>
    );
  } else if (tab === "expiries") {
    const calls = expiries.reduce((sum, row) => sum + row.callOI, 0);
    const puts = expiries.reduce((sum, row) => sum + row.putOI, 0);
    const summary = expiries.length
      ? `OI ${data?.oiDate ? shortDate(data.oiDate) : "--"}  Open interest ${formatCompact(calls + puts)}  P/C ${formatRatio(calls > 0 ? puts / calls : null)}  Spot ${formatLevel(spot)}`
      : "";
    content = (
      <Box flexDirection="column" width={width} flexGrow={1}>
        {summary ? <Box height={1} paddingX={1}><Text>{summary}</Text></Box> : null}
        {expiryChart && chartHeight ? <PositioningChart width={width} height={chartHeight} series={expirySeries}
          ticks={expiryChart.ticks(Math.max(1, width - 8))} guides={[]}
          formatCursor={(ratio) => { const date = expiryChart.at(ratio); return date ? expiryLabel(date) : ""; }}
          formatValue={(value) => formatCount(Math.abs(value))} remoteKind="opx-expiries" /> : null}
        <DataTableView columns={expiryColumnList} items={expiryRows} focused={focused} rootWidth={width}
          rootHeight={tableHeight(summary ? 1 : 0)} getItemKey={(row) => row.date} renderCell={renderExpiry}
          selection={{ kind: "id", selectedId: expirySelectedId, getId: (row) => row.date, onChange: (id) => setSelectedExpiry(id) }}
          onActivate={(row) => { setRequestedExpiry(row.date); setTab("strikes"); }}
          sortColumnId={expirySort.columnId} sortDirection={expirySort.direction}
          onHeaderClick={(id) => setExpirySort((current) => nextHeaderSort(current, id))}
          emptyStateTitle="No listed expiries." />
      </Box>
    );
  } else {
    const assumption = width >= 60 ? "dealers long calls, short puts" : width >= 48 ? "long calls, short puts" : "";
    const range = band
      ? `Dealer range ${formatGamma(band.low)} to ${formatGamma(band.high)} ${shares} with dealers${gammaData?.boxes?.length ? ", boxes out" : ""}`
      : "";
    const summary = gammaData?.total
      ? `Net GEX ${formatGamma(gammaData.total.net)}  Flip ${formatLevel(gammaData.flip)} ${gammaData.flip == null ? "none within 15%" : formatDistance(gammaData.flip, gammaSpot)}  Spot ${formatLevel(gammaSpot)}${range ? `  ${range}` : ""}${boxLegs ? `  Box legs ${boxLegs}` : ""}`
      : "";
    content = (
      <Box flexDirection="column" width={width} flexGrow={1}>
        <Box height={1} paddingX={1}>
          <SelectButton label="Exp" value={gammaChoice}
            options={[{ value: ALL_EXPIRIES, label: "All" }, ...expiryOptions]} onChange={setGammaExpiry} />
        </Box>
        {!gammaData?.total ? (
          <PaneStatusBody loading={gamma.loading && !gammaData} error={!gammaData ? gamma.error : null}
            subject="dealer gamma" empty={!!gammaData} emptyTitle="No dealer gamma." />
        ) : (
          <>
            {summary ? <Box height={2} paddingX={1}><Text>{summary}</Text></Box> : null}
            {gammaChart && chartHeight ? <PositioningChart width={width} height={chartHeight} series={gammaSeries}
              ticks={gammaChart.ticks(Math.max(1, width - 8))}
              guides={[
                { id: "spot", ratio: gammaSpot == null ? null : gammaChart.ratio(gammaSpot), label: "spot", color: colors.textBright },
                { id: "flip", ratio: gammaData.flip == null ? null : gammaChart.ratio(gammaData.flip), label: "flip", color: colors.warning },
              ]}
              formatCursor={(ratio) => formatStrike(nearestStrike(gammaWindow, gammaChart.at(ratio)))}
              formatValue={formatGamma} remoteKind="opx-gex" legend={assumption || undefined} /> : null}
            <DataTableView columns={GAMMA_COLUMNS} items={gammaRows} focused={focused} rootWidth={width}
              rootHeight={tableHeight(summary ? 3 : 1)} getItemKey={strikeKey} renderCell={renderGamma}
              resetScrollKey={gammaChoice}
              selection={{ kind: "id", selectedId: gammaSelectedId, getId: strikeKey, onChange: (id) => setSelectedGammaStrike(id) }}
              sortColumnId={gammaSort.columnId} sortDirection={gammaSort.direction}
              onHeaderClick={(id) => setGammaSort((current) => nextHeaderSort(current, id))}
              emptyStateTitle="No dealer gamma." />
          </>
        )}
      </Box>
    );
  }

  return (
    <Box width={width} height={height} flexDirection="column">
      <PaneStatusBody loading={openInterest.loading && !data} error={!data ? openInterest.error : null}
        empty={!!data && !data.expiries.length} subject="open interest"
        emptyTitle={`No listed options for ${positioningSymbol(symbol).replace(/^\^/, "")}.`}>
        {data?.expiries.length ? (
          <>
            <PaneTabHeader width={width} focused={focused} tabs={tabs} activeValue={tab}
              onSelect={(value) => { if (isPositioningTab(value)) setTab(value); }} />
            {content}
          </>
        ) : null}
      </PaneStatusBody>
    </Box>
  );
}
