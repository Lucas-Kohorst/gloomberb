import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import {
  Button,
  EmptyState,
  Spinner,
  StaticChartSurface,
  usePaneFooter,
  type PaneFooterSegment,
} from "../../../components";
import { useAutoRefresh } from "../shared/auto-refresh";
import { ListView } from "../../../components/ui/list-view";
import type { ProjectedChartPoint } from "../../../components/chart/core/data";
import { resolveChartPalette } from "../../../components/chart/core/palette";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import type { PluginModule } from "../plugin-module";
import { getCachedVolatilityData, loadVolatilityData } from "./client";
import type { TermState, VolatilityData } from "./model";

function formatValue(value: number | null, suffix = ""): string {
  return value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(2)}${suffix}`;
}

function termColor(state: TermState): string {
  if (state === "normal") return colors.positive;
  if (state === "inverted") return colors.warning;
  return colors.textMuted;
}

function slopeLabel(slope: number | null): string {
  if (slope == null || !Number.isFinite(slope)) return "3M spread --";
  if (slope > 0) return `3M premium +${slope.toFixed(2)} pts`;
  if (slope < 0) return `3M discount ${slope.toFixed(2)} pts`;
  return "3M spread 0.00 pts";
}

function TermChart({ data, width, height }: { data: VolatilityData; width: number; height: number }) {
  const points: ProjectedChartPoint[] = data.termPoints.flatMap((point, index) => point.value == null ? [] : [{
    date: new Date(index * 86_400_000),
    open: point.value,
    high: point.value,
    low: point.value,
    close: point.value,
    volume: 0,
  }]);
  if (points.length < 2) {
    return <Box paddingX={1}><Text fg={colors.warning}>VIX curve partial: aligned closes unavailable.</Text></Box>;
  }
  const colWidth = Math.max(10, Math.floor((width - 2) / data.termPoints.length));
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <StaticChartSurface
        points={points}
        width={Math.max(12, width - 2)}
        height={Math.max(5, Math.min(10, height))}
        mode="line"
        colors={resolveChartPalette(colors, "positive")}
        yAxisLabel="Vol"
        yAxisColor={colors.textDim}
        formatYAxisValue={(value) => value.toFixed(1)}
      />
      <Text fg={colors.textDim}>{data.termPoints.map((point) => point.tenor.padEnd(colWidth)).join("").trimEnd()}</Text>
      <Text fg={colors.text}>{data.termPoints.map((point) => formatValue(point.value).padEnd(colWidth)).join("").trimEnd()}</Text>
    </Box>
  );
}

export function VolatilityPane({ paneId, focused, width, height }: PaneProps) {
  const [initial] = useState(getCachedVolatilityData);
  const [data, setData] = useState<VolatilityData | null>(initial?.data ?? null);
  const [loading, setLoading] = useState(!initial);
  const [stale, setStale] = useState(initial?.stale ?? false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (force = false) => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loadVolatilityData(force);
      if (generation.current !== current) return;
      setData(result.data);
      setStale(result.stale);
      if (!result.stale) setLastUpdated(Date.now());
      setError(result.errors[0] ?? null);
    } catch (loadError) {
      if (generation.current !== current) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const reload = useCallback(() => { void load(true); }, [load]);
  const refresh = useCallback(() => { void load(false); }, [load]);
  // The shared FRED cache decides whether a tick reaches the network, so daily
  // closes follow the global cadence without refetching unchanged data.
  useAutoRefresh(lastUpdated, refresh);
  useShortcut((event) => {
    if (!focused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      if (loading) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      reload();
    } else if (isPlainKey(event, "left") || isPlainKey(event, "up") || isPlainKey(event, "k")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelected((value) => Math.max(0, value - 1));
    } else if (isPlainKey(event, "right") || isPlainKey(event, "down") || isPlainKey(event, "j")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelected((value) => Math.min(1, value + 1));
    } else return;
  }, { allowEditable: true, enabled: focused });

  const footerInfo = useMemo<PaneFooterSegment[]>(() => [
    ...(data ? [{ id: "delayed", parts: [{ text: "delayed", tone: "muted" as const }] }] : []),
    ...(stale ? [{ id: "stale", parts: [{ text: "STALE", tone: "warning" as const }] }] : []),
    ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
    ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
  ], [data, error, loading, stale]);
  usePaneFooter(paneId, () => ({ info: footerInfo }), [footerInfo, paneId]);

  if (!data && loading) {
    return (
      <Box width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Loading volatility data..." />
      </Box>
    );
  }
  if (!data) {
    return (
      <Box width={width} height={height} padding={1} flexDirection="column" gap={1}>
        <EmptyState title="Volatility data unavailable." message={error ?? undefined} hint="Press r to retry." />
      </Box>
    );
  }

  const selectedMetric = data.metrics[selected] ?? data.metrics[0]!;
  const termStateLabel = data.termState === "partial" ? "PARTIAL" : data.termState.toUpperCase();
  return (
    <Box flexDirection="column" width={width} height={height} paddingBottom={1}>
          <Box paddingX={1}><Text fg={colors.textMuted}>FRED · daily close</Text></Box>
          <Box flexDirection="row" paddingX={1} marginTop={1}>
            <Text fg={colors.textDim}>3M/30D </Text>
            <Text fg={termColor(data.termState)} attributes={TextAttributes.BOLD}>{formatValue(data.ratio)}</Text>
            <Text fg={termColor(data.termState)} attributes={TextAttributes.BOLD}>{`  ${termStateLabel}`}</Text>
            <Text fg={colors.textDim}>{`  ${slopeLabel(data.slope)}  as of ${data.termDate ?? "--"}`}</Text>
          </Box>
          <Box marginTop={1} paddingX={1}><Text fg={colors.textDim}>{selectedMetric.title}</Text></Box>
          <Box height={2}>
            <ListView
              items={data.metrics.map((metric) => ({
                id: metric.seriesId,
                label: metric.label,
                detail: `${formatValue(metric.value)}   ${metric.tenor} · ${metric.date ?? "--"}`,
              }))}
              selectedIndex={selected}
              onSelect={setSelected}
              height={2}
              surface="plain"
              remoteLabel="Volatility tenors"
            />
          </Box>
          <TermChart data={data} width={width} height={Math.floor(height * 0.35)} />
    </Box>
  );
}

export const volatilityModule: PluginModule = {
  panes: [{
    id: "volatility-term-structure",
    name: "VIX 30D/3M Curve",
    icon: "V",
    component: VolatilityPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 76, height: 23 },
  }],
  paneTemplates: [{
    id: "volatility-term-structure-pane",
    paneId: "volatility-term-structure",
    label: "VIX 30D/3M Curve",
    description: "Aligned daily 30-day and three-month VIX implied-volatility closes from FRED.",
    keywords: ["vix", "volatility", "implied volatility", "curve", "slope", "normal", "inverted", "macro"],
    shortcut: { prefix: "VIX" },
  }],
};
