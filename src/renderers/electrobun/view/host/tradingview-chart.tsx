/** @jsxImportSource react */
import { useEffect, useRef, type CSSProperties } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type MouseEventHandler,
  type Time,
  type TimeRangeChangeEventHandler,
  type UTCTimestamp,
} from "lightweight-charts";
import type { TradingViewChartProps } from "../../../../ui/host";

function timestamp(value: number): UTCTimestamp {
  return Math.floor(value / 1000) as UTCTimestamp;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function WebTradingViewChart({
  panel,
  colors,
  viewport,
  interactive = true,
  onViewportChange,
  style,
  ...props
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rangeRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.textDim,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: {
        visible: false,
        rightOffset: 2,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: interactive,
      handleScale: interactive,
    });
    chartRef.current = chart;
    const seriesApis: ISeriesApi<"Line" | "Area" | "Candlestick" | "Histogram">[] = [];

    for (const projected of panel.series) {
      const source = projected.source;
      const candleData = projected.points
        .filter((point) => finite(point.point.open) && finite(point.point.high)
          && finite(point.point.low) && finite(point.point.close))
        .map((point) => ({
          time: timestamp(point.timestamp),
          open: point.point.open!,
          high: point.point.high!,
          low: point.point.low!,
          close: point.point.close!,
        }));
      const lineData = projected.points
        .filter((point) => finite(point.value))
        .map((point) => ({ time: timestamp(point.timestamp), value: point.value }));
      const hasOhlc = candleData.length > 0;
      if (hasOhlc) {
        const series = chart.addSeries(CandlestickSeries, {
          upColor: source.color,
          downColor: colors.negative,
          borderVisible: false,
          wickUpColor: source.color,
          wickDownColor: colors.negative,
        });
        series.setData(candleData);
        seriesApis.push(series);
      } else if (source.style === "columns") {
        const series = chart.addSeries(HistogramSeries, {
          color: source.color,
          priceFormat: { type: "volume" },
          base: 0,
        });
        series.setData(lineData.map((point) => ({ ...point, color: source.color })));
        seriesApis.push(series);
      } else if (source.style === "area") {
        const series = chart.addSeries(AreaSeries, {
          lineColor: source.color,
          topColor: `${source.color}55`,
          bottomColor: `${source.color}08`,
          lineWidth: 2,
        });
        series.setData(lineData);
        seriesApis.push(series);
      } else {
        const series = chart.addSeries(LineSeries, {
          color: source.color,
          lineWidth: 2,
          lineType: source.style === "step" ? 1 : 0,
          crosshairMarkerVisible: true,
        });
        series.setData(lineData);
        seriesApis.push(series);
      }
    }

    const handleVisibleRangeChange: TimeRangeChangeEventHandler<Time> = (range) => {
      if (!range || !onViewportChange) return;
      const start = typeof range.from === "number" ? range.from : null;
      const end = typeof range.to === "number" ? range.to : null;
      if (start === null || end === null) return;
      const key = `${start}:${end}`;
      if (rangeRef.current === key) return;
      rangeRef.current = key;
      onViewportChange({
        start: new Date(start * 1000),
        end: new Date(end * 1000),
      });
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange);
    const handleCrosshairMove: MouseEventHandler<Time> = (param) => {
      const tooltip = tooltipRef.current;
      if (!tooltip || !param.point || !param.time) {
        if (tooltip) tooltip.hidden = true;
        return;
      }
      const values = panel.series.flatMap((projected, index) => {
        const value = param.seriesData.get(seriesApis[index]!) as
          | { value?: number; close?: number }
          | undefined;
        const numeric = value?.value ?? value?.close;
        return finite(numeric) ? [`${projected.source.label}: ${numeric}`] : [];
      });
      if (values.length === 0) {
        tooltip.hidden = true;
        return;
      }
      tooltip.textContent = values.join("  ");
      tooltip.style.left = `${Math.min(param.point.x + 10, Math.max(0, container.clientWidth - tooltip.offsetWidth - 8))}px`;
      tooltip.style.top = `${Math.max(4, param.point.y - 28)}px`;
      tooltip.hidden = false;
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange);
      chart.remove();
      chartRef.current = null;
      for (const series of seriesApis) series.setData([]);
    };
  }, [colors, interactive, onViewportChange, panel]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !viewport) return;
    const from = timestamp(viewport.start.getTime());
    const to = timestamp(viewport.end.getTime());
    const key = `${from}:${to}`;
    rangeRef.current = key;
    chart.timeScale().setVisibleRange({ from: from as Time, to: to as Time });
  }, [viewport]);

  return (
    <div
      {...props}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        cursor: interactive ? "crosshair" : undefined,
        ...(style as CSSProperties | undefined),
      }}
      data-gloom-role="tradingview-chart"
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div
        ref={tooltipRef}
        hidden
        style={{
          position: "absolute",
          pointerEvents: "none",
          zIndex: 2,
          maxWidth: "calc(100% - 8px)",
          padding: "3px 6px",
          borderRadius: 3,
          color: colors.text,
          background: colors.background,
          border: `1px solid ${colors.grid}`,
          fontSize: 11,
          whiteSpace: "nowrap",
        }}
      />
    </div>
  );
}
