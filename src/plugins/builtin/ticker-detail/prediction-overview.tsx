import { Box, ScrollBox, Text, TextAttributes, useUiCapabilities } from "../../../ui";
import { colors } from "../../../theme/colors";
import { EmptyState, Spinner } from "../../../components";
import { usePaneTicker } from "../../../state/app/context";
import { stubSummaryFromTicker } from "../../prediction-markets/collection-watchlist";
import { usePredictionDetailData } from "../../prediction-markets/controller/detail";
import { SummaryLink } from "../../prediction-markets/detail/shared";
import {
  formatPredictionMetric,
  formatPredictionProbability,
  getPredictionProbabilityColor,
} from "../../prediction-markets/metrics";

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <Box flexDirection="column" paddingRight={2}>
      <Text fg={colors.textDim}>{label}</Text>
      <Text fg={color ?? colors.textBright} attributes={TextAttributes.BOLD}>{value}</Text>
    </Box>
  );
}

export function PredictionResearchOverview({
  width,
  focused,
}: {
  width: number;
  focused: boolean;
}) {
  const { ticker } = usePaneTicker();
  const { nativePaneChrome } = useUiCapabilities();
  const summary = ticker ? stubSummaryFromTicker(ticker) : null;
  const { detail, detailError, detailLoadCount } = usePredictionDetailData({
    focused,
    historyRange: "ALL",
    pollLiveData: focused,
    selectedSummary: summary,
  });

  if (!summary) {
    return (
      <EmptyState
        title="No prediction market"
        message="This research pane is bound to a symbol that is not a Polymarket or Kalshi market."
      />
    );
  }

  const live = detail?.summary ?? summary;
  const loading = detailLoadCount > 0 && !detail;
  const contentWidth = Math.max(width - 2, 20);

  return (
    <ScrollBox flexGrow={1} flexBasis={0} scrollY focusable={false}>
      <Box
        flexDirection="column"
        paddingX={1}
        paddingTop={nativePaneChrome ? 1 : 0}
        paddingBottom={1}
        gap={1}
      >
        {live.title && live.title !== ticker?.metadata.ticker && (
          <Text fg={colors.text} wrapText width={contentWidth}>{live.title}</Text>
        )}
        <Box flexDirection="row">
          <Metric
            label="YES"
            value={formatPredictionProbability(live.yesPrice)}
            color={getPredictionProbabilityColor(live.yesPrice)}
          />
          <Metric
            label="NO"
            value={formatPredictionProbability(live.noPrice)}
            color={getPredictionProbabilityColor(live.noPrice)}
          />
          <Metric
            label="24H VOL"
            value={formatPredictionMetric(live.volume24h, live.volume24hUnit ?? "usd")}
          />
          <Metric
            label="TOTAL VOL"
            value={formatPredictionMetric(live.totalVolume, live.totalVolumeUnit ?? "usd")}
          />
        </Box>
        {loading && live.yesPrice == null ? (
          <Spinner label="Loading market..." />
        ) : detailError && !detail ? (
          <Text fg={colors.negative} wrapText width={contentWidth}>{detailError}</Text>
        ) : null}
        {live.description ? (
          <Text fg={colors.text} wrapText width={contentWidth}>{live.description}</Text>
        ) : null}
        {live.url ? (
          <SummaryLink url={live.url} maxLength={Math.max(contentWidth - 2, 12)} />
        ) : null}
      </Box>
    </ScrollBox>
  );
}
