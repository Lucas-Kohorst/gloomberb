import { libraryDataDefaults } from "../../../plugins/builtin/chart-composer/charting-library-options";
import { useContext, useEffect, useRef, useState } from "react";
import { Box, TradingViewChart } from "../../../ui";
import { tradingViewChartsEnabled } from "../backend";
import {
  createResolvedSeriesLibraryFeed,
  type LibrarySearchItem,
  type ResolvedLibraryModel,
  type ResolvedLibrarySeries,
} from "../../../plugins/builtin/chart-composer/charting-library-feed";
import { pinChartPaneToSymbol } from "../../../layout/pane-follow";
import { getSharedRegistry } from "../../../plugins/registry/shared";
import { AppContext, useOptionalPaneInstanceId } from "../../../state/app/context";
import { searchTickerCandidates } from "../../../tickers/search";
import { publicTickerKey } from "../../../utils/exchanges";

const EMPTY_MODEL: ResolvedLibraryModel = { symbol: "", compares: [], chartStyle: "line", priceScale: "normal" };

const INTERVAL_BY_MAX_GAP_MS = [
  { maxGapMs: 90_000, interval: "1" },
  { maxGapMs: 360_000, interval: "5" },
  { maxGapMs: 1_200_000, interval: "15" },
  { maxGapMs: 2_400_000, interval: "30" },
  { maxGapMs: 3_000_000, interval: "45" },
  { maxGapMs: 5_400_000, interval: "60" },
  { maxGapMs: 18_000_000, interval: "240" },
  { maxGapMs: 172_800_000, interval: "D" },
  { maxGapMs: 1_209_600_000, interval: "W" },
] as const;

export function desktopAdvancedChartInterval(times: readonly number[]): string {
  const sorted = times.filter((time) => Number.isFinite(time)).sort((left, right) => left - right);
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    if (current === undefined || previous === undefined) continue;
    const gap = current - previous;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return "D";
  gaps.sort((left, right) => left - right);
  const mid = Math.floor(gaps.length / 2);
  const upper = gaps[mid];
  const lower = gaps[mid - 1];
  if (upper === undefined) return "D";
  const median = gaps.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
  for (const band of INTERVAL_BY_MAX_GAP_MS) {
    if (median <= band.maxGapMs) return band.interval;
  }
  return "M";
}

export function shouldUseDesktopAdvancedChart(input: {
  isDesktopWeb: boolean;
  hasPoints: boolean;
  xAxis?: unknown;
  showTimeAxis?: boolean;
  formatAxisValue?: unknown;
  advancedChart?: boolean;
}): boolean {
  if (input.advancedChart === false) return false;
  if (!tradingViewChartsEnabled()) return false;
  if (!input.isDesktopWeb || !input.hasPoints) return false;
  if (input.xAxis != null) return false;
  if (input.showTimeAxis === false) return false;
  if (input.formatAxisValue != null) return false;
  return true;
}

export function desktopAdvancedChartTimezone(
  timeZone: string | undefined,
  seriesTimeZone: string | undefined,
): string {
  const explicit = timeZone?.trim();
  if (explicit) return explicit;
  const fromSeries = seriesTimeZone?.trim();
  if (fromSeries) return fromSeries;
  return "Etc/UTC";
}

export function desktopAdvancedSeriesIdentity(
  series: readonly { id: string; points: readonly { date: Date }[] }[],
): string {
  return series.map((entry) => {
    const first = entry.points[0]?.date.getTime();
    const last = entry.points.at(-1)?.date.getTime();
    return `${entry.id}:${entry.points.length}:${first ?? ""}:${last ?? ""}`;
  }).join("|");
}

export type DesktopAdvancedSeries = ResolvedLibrarySeries & {
  timeBasis?: { timeZone?: string };
};

export function DesktopAdvancedChart({
  series,
  width,
  height,
  background,
  tickKey,
  timeZone,
}: {
  series: readonly DesktopAdvancedSeries[];
  width: number;
  height: number;
  background: string;
  tickKey: string;
  timeZone?: string;
}) {
  const app = useContext(AppContext);
  const paneId = useOptionalPaneInstanceId();
  const appRef = useRef(app);
  const paneIdRef = useRef(paneId);
  const symbolRef = useRef("");
  appRef.current = app;
  paneIdRef.current = paneId;
  const handle = useRef(createResolvedSeriesLibraryFeed(async (query) => {
    const current = appRef.current;
    const registry = getSharedRegistry();
    if (!current || !registry) return [];
    const state = "getState" in current ? current.getState() : current.state;
    const candidates = await searchTickerCandidates({
      query,
      tickers: state.tickers,
      dataProvider: registry.marketData,
      totalLimit: 30,
      localLimit: 12,
    });
    return candidates.flatMap((candidate): LibrarySearchItem[] => {
      const exchange = candidate.result?.primaryExchange || candidate.result?.exchange || candidate.ticker?.metadata.exchange || "";
      const ticker = publicTickerKey(candidate.symbol, exchange);
      if (!ticker) return [];
      return [{
        symbol: candidate.symbol,
        description: candidate.result?.name || candidate.ticker?.metadata.name || candidate.label,
        exchange,
        ticker,
        type: candidate.instrumentType || "stock",
      }];
    });
  }));
  const seriesRef = useRef(series);
  seriesRef.current = series;
  const identity = desktopAdvancedSeriesIdentity(series);
  const defaults = libraryDataDefaults(series[0]?.points ?? []);
  const nativeInterval = desktopAdvancedChartInterval(
    (series[0]?.points ?? []).map((point) => point.date.getTime()),
  );
  const interval = defaults.chartStyle === "heikinashi" && /^\d+$/.test(nativeInterval) && Number(nativeInterval) <= 240 ? "240" : nativeInterval;
  const timezone = desktopAdvancedChartTimezone(timeZone, series[0]?.timeBasis?.timeZone);
  const [model, setModel] = useState<ResolvedLibraryModel>(EMPTY_MODEL);
  symbolRef.current = model.symbol;
  useEffect(() => {
    handle.current.setSeries(seriesRef.current);
    const next = handle.current.model();
    setModel((current) => (
      current.symbol === next.symbol
      && current.chartStyle === next.chartStyle
      && current.priceScale === next.priceScale
      && current.compares.join("\n") === next.compares.join("\n")
        ? current
        : next
    ));
  }, [identity, tickKey]);
  if (!model.symbol) return null;
  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      data-gloom-role="composite-chart"
    >
      <TradingViewChart
        key={`${model.symbol}|${interval}|${timezone}`}
        flexGrow={1}
        minHeight={4}
        width={width}
        height={height}
        symbol={model.symbol}
        interval={interval}
        timezone={timezone}
        compareSymbols={model.compares}
        chartStyle={model.chartStyle === "step" ? "step" : defaults.chartStyle}
        hasVolume={defaults.hasVolume}
        priceScale={model.priceScale}
        backgroundColor={background}
        feed={handle.current.feed}
        onPrimarySymbolChange={(info) => {
          const picked = info.ticker.trim();
          const currentSymbol = symbolRef.current;
          if (!picked || picked.toUpperCase() === currentSymbol.toUpperCase()) return;
          const pane = paneIdRef.current;
          const context = appRef.current;
          const registry = getSharedRegistry();
          if (!pane || !context || !registry) return;
          const state = "getState" in context ? context.getState() : context.state;
          const next = pinChartPaneToSymbol(state.config.layout, pane, picked);
          if (next) registry.updateLayout(next);
        }}
      />
    </Box>
  );
}
