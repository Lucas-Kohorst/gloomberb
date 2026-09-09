import { useCallback, useMemo } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import { EmptyState, Spinner, usePaneFooter } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import type { PricePoint } from "../../../types/financials";
import { colors } from "../../../theme/colors";
import { formatNumber } from "../../../utils/format";
import { useShortcut } from "../../../react/input";
import { useAssetData } from "../../runtime";
import { handleRefreshKey, loadingErrorFooterInfo } from "../shared/table-pane";
import { useBoundTicker, useTickerRequest } from "../shared/ticker-request";
import { computeTrendSummary } from "../shared/indicators";
import { buildTrendMetricRows, trendScoreLabel, type TrendMetricRow } from "./model";

function emphasisColor(emphasis: TrendMetricRow["emphasis"]): string {
  switch (emphasis) {
    case "bullish": return colors.positive;
    case "bearish": return colors.negative;
    default: return colors.textDim;
  }
}

function metricValue(summary: TrendMetricRow): string {
  return summary.label === "ADX" || summary.label.startsWith("Aroon")
    ? formatNumber(Number(summary.value), 1)
    : summary.value;
}

export function TrendAnalysisPane({ focused, width, height }: Pick<PaneProps, "focused" | "width" | "height">) {
  const dataProvider = useAssetData();
  const { symbol, exchange } = useBoundTicker();
  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider) throw new Error("Market data unavailable");
    return dataProvider.getPriceHistory(
      nextSymbol,
      nextExchange,
      "1Y",
      forceRefresh ? { cacheMode: "refresh" } : undefined,
    );
  }, [dataProvider]);
  const { data, loading, error, reload } = useTickerRequest<PricePoint[]>(loader, symbol, exchange);
  const summary = useMemo(
    () => (data && data.length > 0 ? computeTrendSummary(data) : null),
    [data],
  );
  const metricRows = useMemo(
    () => (summary ? buildTrendMetricRows(summary) : []),
    [summary],
  );

  useShortcut((event) => {
    if (!focused) return;
    handleRefreshKey(event, reload, { stopPropagation: true });
  });

  usePaneFooter("trend-analysis", () => ({
    info: loadingErrorFooterInfo(loading, error),
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: reload },
    ],
  }), [error, loading, reload]);

  if (!symbol) {
    return <EmptyState title="No ticker selected." message="Select a ticker to analyze trend strength." />;
  }

  if (loading && !data) {
    return <Spinner label="Loading price history..." />;
  }

  if (error && !data) {
    return <EmptyState title="Trend analysis unavailable." message={error} />;
  }

  if (!summary) {
    return <EmptyState title="No price history available." />;
  }

  const scoreColor = summary.score > 15
    ? colors.positive
    : summary.score < -15
      ? colors.negative
      : colors.textDim;

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Box height={2} flexDirection="column" flexShrink={0}>
        <Box flexDirection="row" gap={2}>
          <Text fg={scoreColor} attributes={TextAttributes.BOLD}>{summary.label}</Text>
          <Text fg={scoreColor}>Score {trendScoreLabel(summary.score)}</Text>
        </Box>
        <Text fg={colors.textDim}>ADX trend, Aroon timing, moving-average alignment, and momentum</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {metricRows.map((row) => (
          <Box key={row.label} height={1} flexDirection="row">
            <Text fg={colors.textDim}>{row.label.padEnd(18)}</Text>
            <Text fg={emphasisColor(row.emphasis)} attributes={TextAttributes.BOLD}>
              {metricValue(row)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
