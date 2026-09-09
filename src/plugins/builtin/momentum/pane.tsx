import { useCallback, useMemo } from "react";
import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import {
  EmptyState,
  PaneStatusBody,
  usePaneFooter,
  type PaneHint,
} from "../../../components";
import { colors, blendHex } from "../../../theme/colors";
import { formatNumber } from "../../../utils/format";
import type { PricePoint } from "../../../types/financials";
import { useAssetData } from "../../runtime";
import { useBoundTicker, useTickerRequest } from "../shared/ticker-request";
import { usePaneFooterHintBindings } from "../shared/pane-footer";
import { loadingErrorFooterInfo } from "../shared/table-pane";
import {
  buildMomentumView,
  MIN_MOMENTUM_POINTS,
  MIN_RETURNS_SAMPLE,
  type MetricRow,
  type SignalTone,
} from "./model";

const RANGE = "1Y" as const;

const SOFT_POSITIVE = blendHex(colors.positive, colors.textBright, 0.45);

function toneColor(tone: SignalTone): string {
  switch (tone) {
    case "positive": return colors.positive;
    case "soft-positive": return SOFT_POSITIVE;
    case "negative": return colors.negative;
    case "emphasis": return colors.textBright;
    case "muted": return colors.textMuted;
    case "neutral": return colors.textDim;
  }
}

function signPercent(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}%`;
}

function MetricRowView({ row, labelWidth }: { row: MetricRow; labelWidth: number }) {
  return (
    <Box height={1} flexDirection="row" paddingX={1}>
      <Box width={labelWidth} flexShrink={0}>
        <Text fg={colors.textDim}>{row.label}</Text>
      </Box>
      <Text fg={toneColor(row.tone)} attributes={row.bold ? TextAttributes.BOLD : undefined}>
        {row.value}
      </Text>
    </Box>
  );
}

export function MomentumSortinoPane({
  focused,
  width,
  height,
}: {
  focused: boolean;
  width: number;
  height: number;
}) {
  const dataProvider = useAssetData();
  const { symbol, exchange } = useBoundTicker();

  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider) throw new Error("Market data unavailable");
    return dataProvider.getPriceHistory(
      nextSymbol,
      nextExchange,
      RANGE,
      forceRefresh ? { cacheMode: "refresh" } : undefined,
    );
  }, [dataProvider]);

  const { data, loading, error, reload } = useTickerRequest<PricePoint[]>(loader, symbol, exchange);

  const view = useMemo(() => {
    if (!data || data.length < MIN_MOMENTUM_POINTS) return null;
    return buildMomentumView(data);
  }, [data]);

  const refresh = useCallback(() => reload(), [reload]);

  const hints = useMemo<PaneHint[]>(() => [
    { id: "refresh", key: "r", label: "efresh", onPress: refresh, disabled: loading },
  ], [loading, refresh]);

  usePaneFooter("momentum-sortino", () => ({
    info: loadingErrorFooterInfo(loading, symbol ? error : null),
    hints,
  }), [error, hints, loading, symbol]);

  usePaneFooterHintBindings(focused, hints);

  if (!symbol) {
    return (
      <EmptyState
        title="No ticker selected."
        message="Select a ticker to view momentum and risk metrics."
      />
    );
  }

  if (!view) {
    return (
      <PaneStatusBody
        loading={loading}
        error={error}
        empty={!loading && !error}
        subject="momentum metrics"
        emptyTitle="Not enough price history"
        emptyMessage="At least 30 price points are needed to compute momentum metrics."
      />
    );
  }

  const labelWidth = Math.min(22, Math.max(14, Math.floor(width / 2.6)));
  const showReturns = view.returns.count >= MIN_RETURNS_SAMPLE;
  const returnsTone = (value: number | null): SignalTone =>
    value != null && Number.isFinite(value) ? (value > 0 ? "positive" : value < 0 ? "negative" : "neutral") : "muted";

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ScrollBox flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column" paddingBottom={1}>
          <Box height={1} paddingX={1} marginTop={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
              RISK & MOMENTUM
            </Text>
          </Box>
          {view.rows.map((row) => (
            <MetricRowView key={row.label} row={row} labelWidth={labelWidth} />
          ))}
          {showReturns && (
            <Box flexDirection="column">
              <Box height={1} paddingX={1} marginTop={1}>
                <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
                  PERIOD RETURNS
                </Text>
              </Box>
              <MetricRowView
                row={{
                  label: "Best Daily",
                  value: signPercent(view.returns.best),
                  tone: returnsTone(view.returns.best),
                }}
                labelWidth={labelWidth}
              />
              <MetricRowView
                row={{
                  label: "Worst Daily",
                  value: signPercent(view.returns.worst),
                  tone: returnsTone(view.returns.worst),
                }}
                labelWidth={labelWidth}
              />
              <MetricRowView
                row={{
                  label: "Avg Daily",
                  value: signPercent(view.returns.average),
                  tone: returnsTone(view.returns.average),
                }}
                labelWidth={labelWidth}
              />
              <Box height={1} paddingX={1}>
                <Text fg={colors.textMuted}>
                  based on {formatNumber(view.returns.count, 0)} daily returns
                </Text>
              </Box>
            </Box>
          )}
        </Box>
      </ScrollBox>
    </Box>
  );
}
