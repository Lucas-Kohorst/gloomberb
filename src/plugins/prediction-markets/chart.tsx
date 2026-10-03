import { Box, Text, TradingViewChart, useUiHost } from "../../ui";
import { useEffect, useMemo } from "react";
import { createStaticLibraryFeed, librarySafeTicker, type LibraryBar } from "../builtin/chart-composer/charting-library-feed";
import { ChartRangeTabs } from "../../components/chart/range-tabs";
import {
  CompositeChart,
  pricePointsToResolvedSeries,
} from "../../components/chart/composite";
import { EmptyState } from "../../components/ui/status";
import { colors } from "../../theme/colors";
import { displayWidth, formatNumber, formatPercentRaw } from "../../utils/format";
import type { PricePoint } from "../../types/financials";
import { coercePredictionPointDate } from "./services/history";
import type { PredictionHistoryPoint, PredictionHistoryRange } from "./types";

const RANGES: PredictionHistoryRange[] = ["1D", "1W", "1M", "ALL"];

function toPricePoints(points: PredictionHistoryPoint[]): PricePoint[] {
  return points.flatMap((point) => {
    const date = coercePredictionPointDate(point.date);
    if (!date) return [];
    return [{
      date,
      close: point.close,
      open: point.open,
      high: point.high,
      low: point.low,
      volume: point.volume,
    }];
  });
}

const RANGE_CHOICES = RANGES.map((value) => ({ value }));

// First matching max gap wins. These candles are not the range-tab interval.
const PREDICTION_INTERVAL_GAPS: ReadonlyArray<readonly [number, string]> = [
  [90_000, "1"],
  [360_000, "5"],
  [1_200_000, "15"],
  [2_400_000, "30"],
  [3_000_000, "45"],
  [5_400_000, "60"],
  [18_000_000, "240"],
  [172_800_000, "D"],
  [1_209_600_000, "W"],
];

export function predictionLibraryInterval(times: readonly number[]): string {
  const ordered = times.filter((time) => Number.isFinite(time)).sort((left, right) => left - right);
  const gaps: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index]! - ordered[index - 1]!;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return "D";
  gaps.sort((left, right) => left - right);
  const middle = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1
    ? gaps[middle]!
    : (gaps[middle - 1]! + gaps[middle]!) / 2;
  for (const [maxGapMs, interval] of PREDICTION_INTERVAL_GAPS) {
    if (median <= maxGapMs) return interval;
  }
  return "M";
}

export function predictionLibrarySymbol(marketKey: string | undefined, times: readonly number[]): string {
  const fromMarket = marketKey?.trim() ? librarySafeTicker(marketKey) : "";
  if (fromMarket) return fromMarket;
  const finite = times.filter((time) => Number.isFinite(time));
  const first = finite[0] ?? 0;
  const last = finite[finite.length - 1] ?? first;
  return librarySafeTicker(`H${finite.length}_${first}_${last}`) || "H0";
}

function predictionBars(points: PricePoint[]): LibraryBar[] {
  return points.flatMap((point) => {
    const time = point.date.getTime();
    if (!Number.isFinite(time) || !Number.isFinite(point.close)) return [];
    const open = point.open ?? point.close;
    return [{
      time,
      open,
      high: point.high ?? Math.max(open, point.close),
      low: point.low ?? Math.min(open, point.close),
      close: point.close,
      ...(point.volume == null ? {} : { volume: point.volume }),
    }];
  });
}

export function PredictionMarketChart({
  history,
  width,
  height,
  loading = false,
  focused = false,
  range,
  onRangeSelect,
  marketKey,
}: {
  history: PredictionHistoryPoint[];
  width: number;
  height: number;
  loading?: boolean;
  focused?: boolean;
  range: PredictionHistoryRange;
  onRangeSelect: (range: PredictionHistoryRange) => void;
  marketKey?: string;
}) {
  const pricePoints = useMemo(() => toPricePoints(history), [history]);
  const bars = useMemo(() => predictionBars(pricePoints), [pricePoints]);
  const barTimes = useMemo(() => bars.map((bar) => bar.time), [bars]);
  const symbol = predictionLibrarySymbol(marketKey, barTimes);
  const interval = predictionLibraryInterval(barTimes);
  const desktop = useUiHost().kind === "desktop-web";
  const libraryFeed = useMemo(
    () => createStaticLibraryFeed(symbol, "YES price", { pricescale: 1000, type: "index" }),
    [symbol],
  );
  useEffect(() => {
    libraryFeed.setBars(bars);
  }, [libraryFeed, bars]);

  if (pricePoints.length === 0) {
    return (
      <Box flexDirection="column" height={height}>
        <Box flexDirection="row" height={1} width={width}>
          <ChartRangeTabs
            choices={RANGE_CHOICES}
            value={range}
            focused={focused}
            onSelect={onRangeSelect}
          />
        </Box>
        <Box flexGrow={1} justifyContent="center">
          {loading ? (
            <Text fg={colors.textDim}>Loading chart...</Text>
          ) : (
            <EmptyState
              title="No chart history."
              hint="This venue did not return price history for the selected market."
            />
          )}
        </Box>
      </Box>
    );
  }

  const first = pricePoints[0] ?? null;
  const last = pricePoints[pricePoints.length - 1] ?? null;
  const delta = first && last ? last.close - first.close : 0;
  const deltaPct = first?.close ? (delta / first.close) * 100 : 0;
  const summary = `${formatNumber(last?.close ?? 0, 3)}  ${formatPercentRaw(deltaPct)}`;
  const rangeWidth = RANGES.reduce((total, entry) => total + displayWidth(entry) + 3, 0);
  const stackedHeader = width < rangeWidth + displayWidth(summary) + 1;
  const headerHeight = stackedHeader ? 2 : 1;
  const chartHeight = Math.max(height - headerHeight, 2);
  const priceSeries = pricePointsToResolvedSeries(pricePoints, {
    id: "prediction-price",
    label: "YES price",
    color: delta > 0 ? colors.positive : delta < 0 ? colors.negative : colors.text,
    unit: "USD",
    style: "area",
    axis: "right",
    panelId: "price",
  });

  return (
    <Box flexDirection="column" height={height}>
      <Box flexDirection={stackedHeader ? "column" : "row"} height={headerHeight} width={width}>
        <Box height={1} width={stackedHeader ? width : width - displayWidth(summary) - 1} minWidth={0}>
          <ChartRangeTabs
            choices={RANGE_CHOICES}
            value={range}
            focused={focused}
            onSelect={onRangeSelect}
          />
        </Box>
        {!stackedHeader ? <Box width={1} /> : null}
        <Text
          fg={
            delta > 0
              ? colors.positive
              : delta < 0
                ? colors.negative
                : colors.text
          }
        >
          {summary}
        </Text>
      </Box>

      {desktop ? (
        <TradingViewChart
          key={`${symbol}|${interval}`}
          width={width}
          height={chartHeight}
          flexGrow={1}
          symbol={symbol}
          interval={interval}
          timezone="America/New_York"
          chartStyle="step"
          backgroundColor={colors.panel}
          feed={libraryFeed.feed}
        />
      ) : (
        <CompositeChart
          width={width}
          height={chartHeight}
          focused={focused}
          interactive
          allowHistoricalBackfill
          series={[priceSeries]}
          panels={[{ id: "price" }]}
          axisWidth={8}
          showLegend={false}
        />
      )}
    </Box>
  );
}
