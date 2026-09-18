import { Box, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { colors } from "../../../theme/colors";
import {
  formatPredictionMetric,
  formatPredictionPercent,
  getPredictionProbabilityColor,
  isBlankPredictionMetric,
} from "../metrics";
import type { PredictionListRow } from "../types";
import { sortPredictionOutcomeMarkets } from "../outcome-order";

type OutcomePointerEvent = { preventDefault(): void };

export function PredictionMarketOutcomesView({
  detailWidth,
  onSelectMarket,
  selectedMarketKey,
  selectedRow,
}: {
  detailWidth: number;
  onSelectMarket: (marketKey: string) => void;
  selectedMarketKey: string;
  selectedRow: PredictionListRow;
}) {
  if (selectedRow.kind !== "group") return null;

  const sortedOutcomes = sortPredictionOutcomeMarkets(selectedRow.markets);

  return (
    <Box flexDirection="column" width={detailWidth}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          Outcomes
        </Text>
      </Box>

      <Box flexDirection="row" height={1} gap={1}>
        <Box flexGrow={1} flexShrink={1} flexBasis={0} minWidth={12}>
          <Text fg={colors.textDim}>TARGET</Text>
        </Box>
        <Box width={7} justifyContent="flex-end" flexDirection="row">
          <Text fg={colors.textDim}>ODDS</Text>
        </Box>
        <Box width={10} justifyContent="flex-end" flexDirection="row">
          <Text fg={colors.textDim}>24H VOL</Text>
        </Box>
      </Box>

      {sortedOutcomes.map((market) => {
        const selected = market.key === selectedMarketKey;
        const volume = formatPredictionMetric(
          market.volume24h,
          market.volume24hUnit,
        );
        return (
          <Box
            key={market.key}
            flexDirection="row"
            height={1}
            gap={1}
            backgroundColor={selected ? colors.selected : undefined}
            onMouseDown={(event: OutcomePointerEvent) => {
              event.preventDefault();
              onSelectMarket(market.key);
            }}
          >
            <Box flexGrow={1} flexShrink={1} flexBasis={0} minWidth={12} overflow="hidden">
              <Text
                fg={selected ? colors.selectedText : colors.text}
                attributes={selected ? TextAttributes.BOLD : 0}
              >
                {market.marketLabel}
              </Text>
            </Box>
            <Box width={7} justifyContent="flex-end" flexDirection="row">
              <Text
                fg={
                  selected
                    ? colors.selectedText
                    : getPredictionProbabilityColor(market.yesPrice) ??
                      colors.text
                }
              >
                {formatPredictionPercent(market.yesPrice)}
              </Text>
            </Box>
            <Box width={10} justifyContent="flex-end" flexDirection="row">
              <Text
                fg={
                  selected
                    ? colors.selectedText
                    : isBlankPredictionMetric(volume)
                      ? colors.textDim
                      : colors.text
                }
              >
                {volume}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
