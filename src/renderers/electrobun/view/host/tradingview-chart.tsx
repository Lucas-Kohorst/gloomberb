/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
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
import { formatMeasureSpan } from "../../../../components/chart/composite/tools";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../../time-series/types";
import {
  panVisibleTimeRange,
  scaleVisibleTimeRange,
  wheelPanRatioFromDelta,
  wheelZoomFactorFromDelta,
} from "./tradingview-interactions";
import {
  tradingViewCandleData,
  tradingViewScalarData,
  tradingViewSeriesTypeFor,
  utcTimestampSeconds,
  type TradingViewSeriesType,
} from "./tradingview-series-data";

function timestamp(value: number): UTCTimestamp {
  return utcTimestampSeconds(value) as UTCTimestamp;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function timeToMs(time: Time): number | null {
  if (typeof time === "number") return time * 1000;
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (time && typeof time === "object" && "year" in time) {
    return new Date(time.year, time.month - 1, time.day).getTime();
  }
  return null;
}

function createSeries(
  chart: IChartApi,
  series: ResolvedSeries,
  type: TradingViewSeriesType,
  colors: TradingViewChartProps["colors"],
): ISeriesApi<"Line" | "Area" | "Candlestick" | "Histogram"> {
  switch (type) {
    case "Candlestick":
      return chart.addSeries(CandlestickSeries, {
        upColor: series.color,
        downColor: colors.negative,
        borderVisible: false,
        wickUpColor: series.color,
        wickDownColor: colors.negative,
      });
    case "Histogram":
      return chart.addSeries(HistogramSeries, {
        color: series.color,
        priceFormat: { type: "volume" },
        base: 0,
      });
    case "Area":
      return chart.addSeries(AreaSeries, {
        lineColor: series.color,
        topColor: `${series.color}55`,
        bottomColor: `${series.color}08`,
        lineWidth: 2,
      });
    default:
      return chart.addSeries(LineSeries, {
        color: series.color,
        lineWidth: 2,
        lineType: series.style === "step" ? 1 : 0,
        crosshairMarkerVisible: true,
      });
  }
}

function applySeriesColors(
  api: SeriesEntry["api"],
  type: TradingViewSeriesType,
  series: ResolvedSeries,
  colors: TradingViewChartProps["colors"],
): void {
  if (type === "Candlestick") {
    api.applyOptions({
      upColor: series.color,
      downColor: colors.negative,
      wickUpColor: series.color,
      wickDownColor: colors.negative,
    });
  } else if (type === "Area") {
    api.applyOptions({
      lineColor: series.color,
      topColor: `${series.color}55`,
      bottomColor: `${series.color}08`,
    });
  } else {
    api.applyOptions({ color: series.color });
  }
}

function syncSeriesData(
  api: SeriesEntry["api"],
  type: TradingViewSeriesType,
  series: ResolvedSeries,
): void {
  if (type === "Candlestick") {
    api.setData(tradingViewCandleData(series.points).map((point) => ({
      ...point,
      time: point.time as Time,
    })));
    return;
  }
  api.setData(tradingViewScalarData(series.points).map((point) => ({
    ...point,
    time: point.time as Time,
  })));
}

interface MeasureState {
  start: { rx: number; ry: number; time: number; price: number };
  end: { rx: number; ry: number; time: number; price: number };
}

type SeriesEntry = {
  key: string;
  type: TradingViewSeriesType;
  style: ResolvedSeries["style"];
  api: ISeriesApi<"Line" | "Area" | "Candlestick" | "Histogram">;
  label: string;
  /** Last data written, so a pan does not re-set identical points. */
  points: readonly TimeSeriesPoint[];
  colorKey: string;
};

export function WebTradingViewChart({
  seriesData,
  colors,
  viewport,
  interactive = true,
  onViewportChange,
  vectors,
  armedTool,
  style,
  ...props
}: TradingViewChartProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rangeRef = useRef<string | null>(null);
  const gestureStartRangeRef = useRef<{ start: number; end: number } | null>(null);
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const seriesRef = useRef<SeriesEntry[]>([]);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const [measure, setMeasure] = useState<MeasureState | null>(null);
  const measureDragRef = useRef<MeasureState["start"] | null>(null);
  // The chart is built once and mutated in place. Effects that write to it key
  // off this so a rebuilt chart is repopulated rather than left blank.
  const [chartEpoch, setChartEpoch] = useState(0);

  const measureEnabled = interactive && armedTool === "measure";

  const chartOptions = useMemo(() => ({
    layout: {
      background: { type: ColorType.Solid, color: colors.background },
      textColor: colors.textDim,
    },
    grid: {
      vertLines: { color: colors.grid },
      horzLines: { color: colors.grid },
    },
  }), [colors.background, colors.grid, colors.textDim]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: chartOptions.layout,
      grid: chartOptions.grid,
      crosshair: { mode: 0 },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: {
        visible: true,
        rightOffset: 2,
        fixLeftEdge: false,
        fixRightEdge: false,
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        // Wheel is owned below: LWC pinch is two TouchEvents, which a Mac
        // trackpad never sends. Chrome pinch is ctrl+wheel; WKWebView pinch is
        // a GestureEvent. Both must be handled on this wrapper.
        mouseWheel: false,
        pressedMouseMove: interactive && !measureEnabled,
        horzTouchDrag: interactive,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: false,
        pinch: interactive,
        axisPressedMouseMove: interactive && !measureEnabled,
        axisDoubleClickReset: true,
      },
    });
    chartRef.current = chart;

    const handleVisibleRangeChange: TimeRangeChangeEventHandler<Time> = (range) => {
      if (!range) return;
      // Floored to whole seconds so the key matches the one the viewport effect
      // derives from the range it gets echoed back.
      const start = typeof range.from === "number" ? Math.floor(range.from) : null;
      const end = typeof range.to === "number" ? Math.floor(range.to) : null;
      if (start === null || end === null) return;
      const key = `${start}:${end}`;
      if (rangeRef.current === key) return;
      rangeRef.current = key;
      const report = onViewportChangeRef.current;
      if (report) {
        report({
          start: new Date(start * 1000),
          end: new Date(end * 1000),
        });
      }
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange);

    const handleCrosshairMove: MouseEventHandler<Time> = (param) => {
      const tooltip = tooltipRef.current;
      if (!tooltip || !param.point || !param.time) {
        if (tooltip) tooltip.hidden = true;
        return;
      }
      const values = seriesRef.current.flatMap((entry) => {
        const value = param.seriesData.get(entry.api) as
          | { value?: number; close?: number }
          | undefined;
        const numeric = value?.value ?? value?.close;
        return finite(numeric) ? [`${entry.label}: ${numeric}`] : [];
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
    setChartEpoch((epoch) => epoch + 1);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange);
      for (const entry of seriesRef.current) entry.api.setData([]);
      seriesRef.current = [];
      rangeRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({ layout: chartOptions.layout, grid: chartOptions.grid });
  }, [chartEpoch, chartOptions]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: interactive && !measureEnabled,
        horzTouchDrag: interactive,
      },
      handleScale: {
        mouseWheel: false,
        pinch: interactive,
        axisPressedMouseMove: interactive && !measureEnabled,
      },
    });
  }, [chartEpoch, interactive, measureEnabled]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const byKey = new Map(seriesRef.current.map((entry) => [entry.key, entry]));
    const next: SeriesEntry[] = [];
    for (const series of seriesData) {
      const existing = byKey.get(series.id);
      // Reuse cached type when style+points are unchanged so candle series skip
      // a full OHLC scan on every parent re-render that only swaps array identity.
      const type = existing
        && existing.style === series.style
        && existing.points === series.points
        ? existing.type
        : tradingViewSeriesTypeFor(series);
      const colorKey = `${series.color}|${colors.negative}`;
      if (existing) {
        byKey.delete(series.id);
        if (existing.type === type) {
          // Re-setting data or options is what made panning stutter, so both are
          // written only when the value behind them actually moved.
          if (existing.colorKey !== colorKey) {
            applySeriesColors(existing.api, type, series, colors);
            existing.colorKey = colorKey;
          }
          if (existing.points !== series.points) {
            syncSeriesData(existing.api, type, series);
            existing.points = series.points;
          }
          existing.style = series.style;
          existing.label = series.label;
          next.push(existing);
          continue;
        }
        chart.removeSeries(existing.api);
      }
      const api = createSeries(chart, series, type, colors);
      syncSeriesData(api, type, series);
      next.push({
        key: series.id,
        type,
        style: series.style,
        api,
        label: series.label,
        points: series.points,
        colorKey,
      });
    }
    for (const [, entry] of byKey) chart.removeSeries(entry.api);
    seriesRef.current = next;
  }, [chartEpoch, colors, seriesData]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !viewport) return;
    const from = timestamp(viewport.start.getTime());
    const to = timestamp(viewport.end.getTime());
    const key = `${from}:${to}`;
    // This is the range the chart itself just reported. Re-applying it mid-drag
    // fights the user's own pan.
    if (rangeRef.current === key) return;
    rangeRef.current = key;
    chart.timeScale().setVisibleRange({ from: from as Time, to: to as Time });
  }, [chartEpoch, viewport]);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;

    const visibleRangeMs = (): { start: number; end: number } | null => {
      const range = chartRef.current?.timeScale().getVisibleRange();
      if (!range) return null;
      const start = timeToMs(range.from);
      const end = timeToMs(range.to);
      if (start === null || end === null || end <= start) return null;
      return { start, end };
    };

    const applyRange = (next: { start: number; end: number }) => {
      const chart = chartRef.current;
      if (!chart) return;
      const from = timestamp(next.start);
      const to = timestamp(next.end);
      if (to <= from) return;
      const key = `${from}:${to}`;
      rangeRef.current = key;
      chart.timeScale().setVisibleRange({ from: from as Time, to: to as Time });
      onViewportChangeRef.current?.({
        start: new Date(from * 1000),
        end: new Date(to * 1000),
      });
    };

    const pointerAnchor = (clientX: number, width: number) => (
      width > 0 ? Math.min(1, Math.max(0, (clientX - node.getBoundingClientRect().left) / width)) : 0.5
    );

    const onWheel = (event: WheelEvent) => {
      if (!interactiveRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const current = visibleRangeMs();
      const width = node.getBoundingClientRect().width;
      if (!current || !(width > 0)) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        applyRange(panVisibleTimeRange(current, wheelPanRatioFromDelta(event.deltaX, width)));
        return;
      }
      applyRange(scaleVisibleTimeRange(
        current,
        wheelZoomFactorFromDelta(event.deltaY),
        pointerAnchor(event.clientX, width),
      ));
    };

    const onGestureStart = (event: Event) => {
      if (!interactiveRef.current) return;
      event.preventDefault();
      gestureStartRangeRef.current = visibleRangeMs();
    };
    const onGestureChange = (event: Event) => {
      if (!interactiveRef.current) return;
      event.preventDefault();
      const start = gestureStartRangeRef.current;
      const gesture = event as Event & { scale?: number; clientX?: number };
      if (!start || typeof gesture.scale !== "number" || !(gesture.scale > 0)) return;
      const width = node.getBoundingClientRect().width;
      applyRange(scaleVisibleTimeRange(
        start,
        gesture.scale,
        pointerAnchor(typeof gesture.clientX === "number" ? gesture.clientX : 0, width),
      ));
    };
    const onGestureEnd = () => {
      gestureStartRangeRef.current = null;
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("gesturestart", onGestureStart, { passive: false });
    node.addEventListener("gesturechange", onGestureChange, { passive: false });
    node.addEventListener("gestureend", onGestureEnd);
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("gesturestart", onGestureStart);
      node.removeEventListener("gesturechange", onGestureChange);
      node.removeEventListener("gestureend", onGestureEnd);
    };
  }, []);

  const beginMeasure = (event: PointerEvent<HTMLDivElement>) => {
    if (!measureEnabled) return;
    const chart = chartRef.current;
    if (!chart) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rawTime = chart.timeScale().coordinateToTime(x);
    const price = seriesRef.current[0]?.api.coordinateToPrice(y) ?? null;
    if (rawTime === null || price === null) return;
    const time = timeToMs(rawTime);
    if (time === null) return;
    event.preventDefault();
    const point = { rx: x / rect.width, ry: y / rect.height, time, price };
    measureDragRef.current = point;
    setMeasure({ start: point, end: point });
  };
  const updateMeasure = (event: PointerEvent<HTMLDivElement>) => {
    const start = measureDragRef.current;
    if (!start) return;
    const chart = chartRef.current;
    if (!chart) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rawTime = chart.timeScale().coordinateToTime(x);
    const price = seriesRef.current[0]?.api.coordinateToPrice(y) ?? null;
    if (rawTime === null || price === null) return;
    const time = timeToMs(rawTime);
    if (time === null) return;
    setMeasure({ start, end: { rx: x / rect.width, ry: y / rect.height, time, price } });
  };
  const endMeasure = () => {
    measureDragRef.current = null;
  };

  const overlayShapes = vectors ?? [];
  const measureBox = !!measure && Math.abs(measure.end.rx - measure.start.rx) > 0.002;
  const measureStartValue = measure?.start.price ?? null;
  const measureEndValue = measure?.end.price ?? null;
  const measureSpanMs = measure ? Math.abs(measure.end.time - measure.start.time) : 0;
  const measureDelta = measureStartValue !== null && measureEndValue !== null
    ? measureEndValue - measureStartValue
    : null;
  const measurePercent = measureDelta !== null && measureStartValue !== null && measureStartValue !== 0
    ? (measureDelta / measureStartValue) * 100
    : null;
  const measureLeft = measure ? Math.min(measure.start.rx, measure.end.rx) * 100 : 0;
  const measureTop = measure ? Math.min(measure.start.ry, measure.end.ry) * 100 : 0;
  const measureWidth = measure ? Math.abs(measure.end.rx - measure.start.rx) * 100 : 0;
  const measureHeight = measure ? Math.abs(measure.end.ry - measure.start.ry) * 100 : 0;

  const pointerHandlers = measureEnabled
    ? {
      onPointerDown: beginMeasure,
      onPointerMove: updateMeasure,
      onPointerUp: endMeasure,
      onPointerLeave: endMeasure,
    }
    : {};

  return (
    <div
      {...props}
      {...pointerHandlers}
      ref={wrapperRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        cursor: measureEnabled ? "crosshair" : interactive ? "grab" : undefined,
        touchAction: interactive ? "none" : undefined,
        ...(style as CSSProperties | undefined),
      }}
      data-gloom-role="tradingview-chart"
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        {measureBox ? (
          <g>
            <rect
              x={measureLeft}
              y={measureTop}
              width={measureWidth}
              height={measureHeight}
              fill={colors.crosshair}
              fillOpacity={0.18}
              stroke={measureDelta !== null && measureDelta < 0 ? colors.negative : colors.crosshair}
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={measure.start.rx * 100}
              y1={measure.start.ry * 100}
              x2={measure.end.rx * 100}
              y2={measure.end.ry * 100}
              stroke={measureDelta !== null && measureDelta < 0 ? colors.negative : colors.crosshair}
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
        {overlayShapes.map((shape) => (
          <g key={shape.id}>
            {shape.box ? (
              <rect
                x={(shape.points[0]?.x ?? 0) * 100}
                y={(shape.points[0]?.y ?? 0) * 100}
                width={Math.abs(((shape.points[shape.points.length - 1]?.x ?? 0) - (shape.points[0]?.x ?? 0))) * 100}
                height={Math.abs(((shape.points[shape.points.length - 1]?.y ?? 0) - (shape.points[0]?.y ?? 0))) * 100}
                fill={shape.color}
                fillOpacity={shape.fillOpacity ?? 0.18}
                stroke={shape.color}
                strokeWidth={shape.strokeWidth ?? 0.8}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <polyline
                points={shape.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                fill="none"
                stroke={shape.color}
                strokeWidth={shape.strokeWidth ?? 1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        ))}
      </svg>
      {measureBox && measureDelta !== null ? (
        <div
          style={{
            position: "absolute",
            left: `${(measure.start.rx + measure.end.rx) * 50}%`,
            top: `${Math.min(measure.start.ry, measure.end.ry) * 100}%`,
            transform: "translate(-50%, -140%)",
            pointerEvents: "none",
            zIndex: 3,
            padding: "2px 6px",
            borderRadius: 3,
            fontSize: 11,
            whiteSpace: "nowrap",
            color: colors.text,
            background: colors.background,
            border: `1px solid ${colors.grid}`,
          }}
        >
          {`${measureDelta >= 0 ? "+" : ""}${measureDelta.toFixed(2)} (${measurePercent !== null ? `${measurePercent >= 0 ? "+" : ""}${measurePercent.toFixed(2)}%` : "–"}) · ${formatMeasureSpan(measureSpanMs)}`}
        </div>
      ) : null}
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