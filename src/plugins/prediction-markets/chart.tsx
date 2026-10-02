import { Box, Text } from "../../ui";
import { useMemo } from "react";
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

export function PredictionMarketChart({
  history,
  width,
  height,
  loading = false,
  focused = false,
  range,
  onRangeSelect,
}: {
  history: PredictionHistoryPoint[];
  width: number;
  height: number;
  loading?: boolean;
  focused?: boolean;
  range: PredictionHistoryRange;
  onRangeSelect: (range: PredictionHistoryRange) => void;
}) {
  const pricePoints = useMemo(() => toPricePoints(history), [history]);

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

      <CompositeChart
        width={width}
        height={chartHeight}
        focused={focused}
        interactive
        series={[priceSeries]}
        panels={[{ id: "price" }]}
        axisWidth={8}
        showLegend={false}
      />
    </Box>
  );
}
