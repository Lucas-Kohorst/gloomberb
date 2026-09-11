import { useCallback, useMemo } from "react";
import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import {
  EmptyState,
  PaneStatusBody,
  usePaneFooter,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { truncateToDisplayWidth } from "../../../utils/format";
import type { PricePoint } from "../../../types/financials";
import { useAssetData } from "../../runtime";
import { useBoundTicker, useTickerRequest } from "../shared/ticker-request";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { loadingErrorFooterInfo } from "../shared/table-pane";
import { computeTechnicalSummary } from "../shared/indicators";
import {
  buildTechnicalSummaryView,
  MIN_INDICATOR_POINTS,
  type MetricRow,
  type MetricSection,
  type SignalTone,
} from "./model";

const RANGE = "1Y" as const;

function toneColor(tone: SignalTone): string {
  switch (tone) {
    case "positive": return colors.positive;
    case "negative": return colors.negative;
    case "emphasis": return colors.textBright;
    case "muted": return colors.textMuted;
    case "neutral": return colors.textDim;
  }
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

function MetricSectionView({ section, labelWidth }: { section: MetricSection; labelWidth: number }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box height={1} paddingX={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {section.title.toUpperCase()}
        </Text>
      </Box>
      {section.rows.map((row) => (
        <MetricRowView key={row.label} row={row} labelWidth={labelWidth} />
      ))}
    </Box>
  );
}

export function TechnicalSummaryPane({
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
    if (!data || data.length < MIN_INDICATOR_POINTS) return null;
    return buildTechnicalSummaryView(computeTechnicalSummary(data));
  }, [data]);

  const refresh = useCallback(() => reload(), [reload]);

  useShortcut((event) => {
    if (!focused || event.targetEditable || loading) return;
    if (!isPlainKey(event, "r")) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    refresh();
  }, { enabled: focused && !loading });

  usePaneFooter("technical-summary", () => ({
    info: loadingErrorFooterInfo(loading, symbol ? error : null),
  }), [error, loading, symbol]);

  if (!symbol) {
    return (
      <EmptyState
        title="No ticker selected."
        message="Select a ticker to view its technical summary."
      />
    );
  }

  if (!view) {
    return (
      <PaneStatusBody
        loading={loading}
        error={error}
        empty={!loading && !error}
        subject="technical indicators"
        emptyTitle="Not enough price history"
        emptyMessage="At least 30 price points are needed to compute indicators."
      />
    );
  }

  const labelWidth = Math.min(18, Math.max(12, Math.floor(width / 3)));
  const summaryWidth = Math.max(20, width - 2);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ScrollBox flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column" paddingBottom={1}>
          {view.sections.map((section) => (
            <MetricSectionView key={section.title} section={section} labelWidth={labelWidth} />
          ))}
          <Box height={1} flexDirection="row" paddingX={1} marginTop={1}>
            <Text fg={colors.textDim}>Summary: </Text>
            <Text
              fg={colors.text}
              attributes={TextAttributes.BOLD}
            >
              {truncateToDisplayWidth(view.summary, summaryWidth - 9)}
            </Text>
          </Box>
        </Box>
      </ScrollBox>
    </Box>
  );
}
