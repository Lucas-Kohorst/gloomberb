import { Box, Text } from "../../../ui";
import { colors } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import { PredictionMarketChart } from "../chart";
import type {
  PredictionHistoryRange,
  PredictionMarketDetail,
  PredictionMarketSummary,
} from "../types";

function formatRangeMove(
  detail: PredictionMarketDetail | null,
  summary: PredictionMarketSummary,
): string {
  const history = detail?.history;
  if (!history || history.length < 2 || summary.yesPrice == null) {
    return "No extended move data.";
  }
  const first = history[0]?.close ?? summary.yesPrice;
  const last = history[history.length - 1]?.close ?? summary.yesPrice;
  const move = ((last - first) / Math.max(first, 0.0001)) * 100;
  return `Range move ${formatPercentRaw(move)}`;
}

export function PredictionMarketChartTab({
  detail,
  detailWidth,
  height,
  historyRange,
  loading,
  onHistoryRangeChange,
  summary,
}: {
  detail: PredictionMarketDetail | null;
  detailWidth: number;
  height: number;
  historyRange: PredictionHistoryRange;
  loading: boolean;
  onHistoryRangeChange: (range: PredictionHistoryRange) => void;
  summary: PredictionMarketSummary;
}) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <PredictionMarketChart
        history={detail?.history ?? []}
        width={detailWidth}
        height={Math.max(height - 1, 6)}
        loading={loading}
        range={historyRange}
        onRangeSelect={onHistoryRangeChange}
      />
      <Box height={1}>
        <Text fg={colors.textDim}>{formatRangeMove(detail, summary)}</Text>
      </Box>
    </Box>
  );
}
