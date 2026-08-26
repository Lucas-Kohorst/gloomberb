import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { ErrorState, LoadingState, StaticChartSurface, type PaneFooterSegment } from "../../../components";
import { PriceSparkline } from "../../../components/price-sparkline/view";
import { resolveChartPalette } from "../../../components/chart/core/renderer";
import type { ProjectedChartPoint } from "../../../components/chart/core/data";
import type { PricePoint } from "../../../types/financials";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePaneStatusFooter } from "../shared/pane-footer";
import { usePluginAppActions } from "../../runtime";
import { getCachedVolData, loadVolData } from "./client";
import { classifyTermStructure } from "./model";
import type { VolData, VolMetric } from "./types";

function formatValue(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function toPricePoints(sparkline: { date: Date; value: number }[]): PricePoint[] {
  return sparkline.map((pt) => ({ date: pt.date, close: pt.value }));
}

function regimeColor(regime: ReturnType<typeof classifyTermStructure>): string {
  switch (regime) {
    case "contango":
      return colors.positive;
    case "backwardation":
      return colors.warning;
    case "neutral":
      return colors.textMuted;
  }
}

function MetricRow({
  metric,
  sparklineWidth,
  valueColor,
  trailing,
}: {
  metric: VolMetric;
  sparklineWidth: number;
  valueColor?: string;
  trailing?: string;
}) {
  const priceHistory = useMemo(() => toPricePoints(metric.sparkline), [metric.sparkline]);
  const trend = useMemo<"positive" | "negative" | "neutral">(() => {
    if (metric.sparkline.length < 2) return "neutral";
    const first = metric.sparkline[0]!.value;
    const last = metric.sparkline[metric.sparkline.length - 1]!.value;
    return last > first ? "positive" : last < first ? "negative" : "neutral";
  }, [metric.sparkline]);

  return (
    <Box flexDirection="row" height={1} paddingX={1}>
      <Box width={10} flexShrink={0}>
        <Text fg={colors.textDim}>{metric.label}</Text>
      </Box>
      <Box width={8} flexShrink={0}>
        <Text fg={valueColor ?? colors.text} attributes={TextAttributes.BOLD}>
          {formatValue(metric.value, metric.unit === "ratio" ? 2 : 2)}
        </Text>
      </Box>
      {sparklineWidth > 4 ? (
        <Box width={sparklineWidth} flexShrink={0}>
          <PriceSparkline priceHistory={priceHistory} width={sparklineWidth} trend={trend} height={1} />
        </Box>
      ) : null}
      {trailing ? (
        <Box flexGrow={1}>
          <Text fg={colors.textMuted}> {trailing}</Text>
        </Box>
      ) : (
        <Box flexGrow={1} />
      )}
    </Box>
  );
}

function TermStructureChart({
  data,
  width,
  height,
}: {
  data: VolData;
  width: number;
  height: number;
}) {
  const palette = resolveChartPalette(colors, "positive");
  const chartWidth = Math.max(10, width - 2);
  const chartHeight = Math.min(10, Math.max(5, height));

  const validPoints = data.termStructure.filter((p) => p.value != null);
  if (validPoints.length < 2) {
    return (
      <Box paddingX={1} marginTop={1}>
        <Text fg={colors.textMuted}>Not enough data for term structure chart</Text>
      </Box>
    );
  }

  // Map term structure to chart points on a pseudo x-axis
  const chartPoints: ProjectedChartPoint[] = data.termStructure.map((p, i) => ({
    date: new Date(i * 86_400_000),
    open: p.value ?? 0,
    high: p.value ?? 0,
    low: p.value ?? 0,
    close: p.value ?? 0,
    volume: 0,
  }));

  const labelWidth = 8;
  const colWidth = Math.max(8, Math.floor((width - 2) / data.termStructure.length));
  const tenorLabels = data.termStructure.map((p) => p.tenor.padEnd(colWidth)).join("").trimEnd();
  const valueLabels = data.termStructure
    .map((p) => formatValue(p.value, 2).padEnd(colWidth))
    .join("").trimEnd();

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>TERM STRUCTURE</Text>
      </Box>
      <Box flexDirection="column" marginTop={0}>
        <StaticChartSurface
          points={chartPoints}
          width={chartWidth}
          height={chartHeight}
          mode="line"
          colors={palette}
          yAxisLabel="VIX pts"
          yAxisColor={colors.textDim}
          formatYAxisValue={(v) => v.toFixed(1)}
        />
      </Box>
      <Box height={1} marginTop={0}>
        <Text fg={colors.textDim}>{tenorLabels}</Text>
      </Box>
      <Box height={1}>
        <Text fg={colors.text}>{valueLabels}</Text>
      </Box>
    </Box>
  );
}

export function VolatilityPane({ paneId, focused, width, height }: PaneProps) {
  const [initialCache] = useState(() => getCachedVolData());
  const [data, setData] = useState<VolData | null>(initialCache);
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const fetchGenRef = useRef(0);
  const { createPaneFromTemplate } = usePluginAppActions();
  const chartVix = useCallback(() => {
    createPaneFromTemplate("chart-composer-pane", { arg: "FRED:VIXCLS, FRED:VXVCLS" });
  }, [createPaneFromTemplate]);

  const load = useCallback(async (force = false) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await loadVolData(force);
      if (fetchGenRef.current !== gen) return;
      setData(next);
      setLastRefreshed(Date.now());
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialCache) {
      void load();
    } else {
      void load(false);
    }
  }, [initialCache, load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  useAutoRefresh(lastRefreshed, refresh);

  useShortcut((event) => {
    if (!focused) return;
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
    } else if (event.name === "g") {
      event.preventDefault?.();
      event.stopPropagation?.();
      chartVix();
    }
  });

  const regime = classifyTermStructure(data?.vxvVixRatio.value ?? null);
  const updatedLabel = data?.updatedAt ? formatDate(data.updatedAt) : null;
  const regimeTone = regime === "backwardation" ? "warning" as const : regime === "contango" ? "value" as const : "muted" as const;
  const regimeText = regime === "contango" ? "CONTANGO" : regime === "backwardation" ? "BACKWARDATION" : "FLAT";

  const statusInfo = useMemo<PaneFooterSegment[]>(() => [
    ...(data?.vxvVixRatio.value != null
      ? [{
          id: "regime",
          parts: [{
            text: regimeText,
            tone: regimeTone,
            bold: true,
          }],
        }]
      : []),
    ...(updatedLabel ? [{ id: "updated", parts: [{ text: `as of ${updatedLabel}`, tone: "muted" as const }] }] : []),
  ], [regimeText, regimeTone, updatedLabel, data?.vxvVixRatio.value]);

  usePaneStatusFooter({
    registrationId: paneId,
    loading,
    error,
    info: statusInfo,
    hints: [
      { id: "graph", key: "g", label: "raph", onPress: chartVix },
      { id: "refresh", key: "r", label: "efresh", onPress: refresh, disabled: loading },
    ],
  });

  if (loading && !data) {
    return <LoadingState title="Loading volatility data..." />;
  }

  if (!data) {
    return <ErrorState kind="volatility" error={error} />;
  }

  const labelWidth = 10;
  const valueWidth = 8;
  const sparklineWidth = Math.max(0, Math.min(28, width - 2 - labelWidth - valueWidth - 12));

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ScrollBox flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column" paddingBottom={1}>
          {/* Spot VIX */}
          <Box flexDirection="row" height={1} paddingX={1} marginTop={1}>
            <Box width={labelWidth} flexShrink={0}>
              <Text fg={colors.textDim}>VIX</Text>
            </Box>
            <Box width={valueWidth} flexShrink={0}>
              <Text fg={colors.text} attributes={TextAttributes.BOLD}>{formatValue(data.vix.value)}</Text>
            </Box>
            {sparklineWidth > 4 ? (
              <Box width={sparklineWidth} flexShrink={0}>
                <PriceSparkline
                  priceHistory={toPricePoints(data.vix.sparkline)}
                  width={sparklineWidth}
                  trend={data.vix.sparkline.length >= 2 && data.vix.sparkline.at(-1)!.value > data.vix.sparkline[0]!.value ? "positive" : "negative"}
                  height={1}
                />
              </Box>
            ) : null}
            <Box flexGrow={1}>
              <Text fg={colors.textMuted}> spot volatility index</Text>
            </Box>
          </Box>

          {/* VXV/VIX ratio with regime label */}
          <Box flexDirection="row" height={1} paddingX={1}>
            <Box width={labelWidth} flexShrink={0}>
              <Text fg={colors.textDim}>VXV/VIX</Text>
            </Box>
            <Box width={valueWidth} flexShrink={0}>
              <Text fg={regimeColor(regime)} attributes={TextAttributes.BOLD}>
                {formatValue(data.vxvVixRatio.value)}
              </Text>
            </Box>
            {sparklineWidth > 4 ? (
              <Box width={sparklineWidth} flexShrink={0}>
                <PriceSparkline
                  priceHistory={toPricePoints(data.vxvVixRatio.sparkline)}
                  width={sparklineWidth}
                  trend="neutral"
                  height={1}
                />
              </Box>
            ) : null}
            <Box flexGrow={1}>
              <Text fg={regimeColor(regime)} attributes={TextAttributes.BOLD}>
                {" "}{regime === "contango" ? "contango" : regime === "backwardation" ? "backwardation" : "flat"}
              </Text>
            </Box>
          </Box>

          {/* Term structure chart */}
          <TermStructureChart data={data} width={width} height={Math.min(14, Math.max(8, Math.floor(height * 0.35)))} />

          {/* VXV */}
          <Box marginTop={1}>
            <MetricRow
              metric={data.vxv}
              sparklineWidth={sparklineWidth}
              valueColor={colors.text}
              trailing="3-month implied vol"
            />
          </Box>

          {/* VXMT */}
          <MetricRow
            metric={data.vxmt}
            sparklineWidth={sparklineWidth}
            valueColor={colors.text}
            trailing={data.vxmt.value == null ? "6M (limited history)" : "6-month implied vol"}
          />
        </Box>
      </ScrollBox>
    </Box>
  );
}
