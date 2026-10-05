import { useCallback, useEffect, useMemo } from "react";
import { resolveChartPalette, StaticChartSurface } from "../../../components";
import { COMPOSITE_RIGHT_OFFSET_RATIO } from "../../../components/chart/composite/time-scale";
import type { StaticChartXMarker } from "../../../components/chart/static/chart-surface";
import { useAsyncResource, useAutoRefresh, useMarketData } from "../../../public/react";
import { fetchHistoryResult } from "../../../sources/history-result";
import { useThemeColors } from "../../../theme/theme-context";
import type { DataProvider } from "../../../types/data-provider";
import type { PricePoint } from "../../../types/financials";
import { Box, Text } from "../../../ui";
import { formatNumber } from "../../../utils/format";
import { esChartMarkers, esChartStart, esMarkerRatio } from "./chart-window";

async function loadEsBars(provider: DataProvider, start: number, end: number): Promise<PricePoint[]> {
  for (const exchange of ["", "CME"]) {
    try {
      const result = await fetchHistoryResult(provider, "ES=F", exchange, {
        kind: "detail",
        start: new Date(start),
        end: new Date(end),
        interval: "5m",
      });
      const points = (result?.points ?? []).flatMap((point) => {
        const date = point.date instanceof Date ? point.date : new Date(point.date as unknown as string);
        const time = date.getTime();
        return time >= start && time <= end && Number.isFinite(point.close) ? [{ ...point, date }] : [];
      });
      if (points.length > 0) return points;
    } catch {
      // An empty exchange and CME are the two ways the board lists ES.
    }
  }
  return [];
}

export function EsSessionChart({
  width,
  height,
  focused,
  now,
  reloadToken,
}: {
  width: number;
  height: number;
  focused: boolean;
  now: number;
  reloadToken: number;
}) {
  const colors = useThemeColors();
  const provider = useMarketData();
  const start = esChartStart(now);
  const loader = useCallback(async () => {
    if (!provider) return [] as PricePoint[];
    return loadEsBars(provider, start, Date.now());
  }, [provider, start]);
  const history = useAsyncResource(provider ? loader : null, { keepPreviousData: true });
  const reloadHistory = history.reload;
  useEffect(() => {
    if (reloadToken === 0) return;
    void reloadHistory();
  }, [reloadHistory, reloadToken]);
  useAutoRefresh(history.updatedAt, () => { void reloadHistory(); });

  const points = history.data ?? [];
  const palette = useMemo(() => resolveChartPalette({
    bg: colors.bg,
    border: colors.border,
    borderFocused: colors.borderFocused,
    text: colors.text,
    textDim: colors.textDim,
    positive: colors.positive,
    negative: colors.negative,
  }), [colors]);
  const projected = useMemo(() => points.map((point) => {
    const close = point.close;
    return {
      date: point.date,
      open: point.open ?? close,
      high: point.high ?? Math.max(point.open ?? close, close),
      low: point.low ?? Math.min(point.open ?? close, close),
      close,
      volume: point.volume ?? 0,
    };
  }), [points]);
  const markers = useMemo<StaticChartXMarker[]>(() => {
    const first = projected[0]?.date.getTime();
    const last = projected[projected.length - 1]?.date.getTime();
    if (first == null || last == null) return [];
    return esChartMarkers(start, now).flatMap((marker) => {
      const xRatio = esMarkerRatio(marker.at, first, last, COMPOSITE_RIGHT_OFFSET_RATIO);
      return xRatio == null ? [] : [{ id: marker.id, xRatio, label: marker.label, color: colors.textDim }];
    });
  }, [colors.textDim, now, projected, start]);

  if (projected.length === 0) {
    return (
      <Box width={width} height={height} flexShrink={0} paddingX={1}>
        <Text fg={colors.textDim}>{history.loading ? "Loading ES..." : "ES history unavailable."}</Text>
      </Box>
    );
  }

  return (
    <Box width={width} height={height} flexShrink={0}>
      <StaticChartSurface
        points={projected}
        width={width}
        height={height}
        mode="candles"
        calendarSpaced
        timeZone="America/New_York"
        cadenceMs={5 * 60_000}
        colors={palette}
        focused={focused}
        showTimeAxis
        yAxisLabel="ES"
        yAxisColor={colors.textDim}
        formatYAxisValue={(value) => formatNumber(value)}
        xMarkers={markers.length > 0 ? markers : undefined}
      />
    </Box>
  );
}
