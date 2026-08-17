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
import type { ChartVectorShape, TradingViewChartProps } from "../../../../ui/host";
import { formatMeasureSpan } from "../../../../components/chart/composite/tools";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../../time-series/types";

function timestamp(value: number): UTCTimestamp {
  return Math.floor(value / 1000) as UTCTimestamp;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

interface SeriesDatum {
  time: Time;
  value: number;
}

interface CandleDatum {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
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

function projectSeriesData(series: ResolvedSeries): { data: SeriesDatum[]; candle: CandleDatum[] } {
  // lightweight-charts rejects out-of-order and duplicate timestamps outright,
  // and a resolved series carries both once a live quote is merged onto the bar
  // it belongs to. Collapsing by second keeps the latest reading per bar.
  const byTime = new Map<number, TimeSeriesPoint>();
  for (const point of series.points) {
    const time = point.date.getTime();
    if (Number.isFinite(time)) byTime.set(timestamp(time), point);
  }
  const ordered = [...byTime.entries()].sort(([left], [right]) => left - right);
  const candle = ordered.flatMap(([time, point]) => (
    finite(point.open) && finite(point.high) && finite(point.low) && finite(point.close)
      ? [{ time: time as Time, open: point.open, high: point.high, low: point.low, close: point.close }]
      : []
  ));
  const data = ordered.flatMap(([time, point]) => (
    finite(point.value) ? [{ time: time as Time, value: point.value }] : []
  ));
  return { data, candle };
}

/**
 * Single source of truth for the series type. Creation and data-sync must agree,
 * or a reused series is handed data in the wrong shape.
 */
function seriesTypeFor(series: ResolvedSeries): SeriesEntry["type"] {
  if (series.style === "columns") return "Histogram";
  if (series.style === "area") return "Area";
  if (series.style === "candles" && series.points.some((point) => (
    finite(point.open) && finite(point.high) && finite(point.low) && finite(point.close)
  ))) {
    return "Candlestick";
  }
  return "Line";
}

function createSeries(
  chart: IChartApi,
  series: ResolvedSeries,
  type: SeriesEntry["type"],
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

function colorKeyFor(series: ResolvedSeries, colors: TradingViewChartProps["colors"]): string {
  return `${series.color}|${colors.negative}`;
}

function applySeriesColors(
  api: SeriesEntry["api"],
  type: SeriesEntry["type"],
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
  type: SeriesEntry["type"],
  series: ResolvedSeries,
): void {
  const { data, candle } = projectSeriesData(series);
  if (type === "Candlestick") {
    api.setData(candle);
  } else if (type === "Histogram") {
    api.setData(data.map((point) => ({ ...point, color: series.color })));
  } else {
    api.setData(data);
  }
}

interface MeasureState {
  start: { rx: number; ry: number; time: number; price: number };
  end: { rx: number; ry: number; time: number; price: number };
}

type SeriesEntry = {
  key: string;
  type: "Line" | "Area" | "Candlestick" | "Histogram";
  api: ISeriesApi<"Line" | "Area" | "Candlestick" | "Histogram">;
  label: string;
  /** Last data written, so a pan does not re-set identical points. */
  points: readonly TimeSeriesPoint[];
  colorKey: string;
};

export function WebTradingViewChart({
  panel,
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rangeRef = useRef<string | null>(null);
  const seriesRef = useRef<SeriesEntry[]>([]);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const [measure, setMeasure] = useState<MeasureState | null>(null);
  const measureDragRef = useRef<MeasureState["start"] | null>(null);
  // The chart is built once and mutated in place. Effects that write to it key
  // off this so a rebuilt chart is repopulated rather than left blank.
  const [chartEpoch, setChartEpoch] = useState(0);

  const measureEnabled = interactive && armedTool === "measure";

  // The scene projection windows its points to the viewport, so consuming it
  // would hand this chart a different dataset on every pan frame.
  const chartSeries = useMemo(
    () => seriesData ?? panel.series.map((projected) => projected.source),
    [seriesData, panel],
  );

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
        mouseWheel: interactive,
        pressedMouseMove: interactive && !measureEnabled,
        horzTouchDrag: interactive,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: interactive,
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
        mouseWheel: interactive,
        pressedMouseMove: interactive && !measureEnabled,
        horzTouchDrag: interactive,
      },
      handleScale: {
        mouseWheel: interactive,
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
    for (const series of chartSeries) {
      const type = seriesTypeFor(series);
      const colorKey = colorKeyFor(series, colors);
      const existing = byKey.get(series.id);
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
          existing.label = series.label;
          next.push(existing);
          continue;
        }
        chart.removeSeries(existing.api);
      }
      const api = createSeries(chart, series, type, colors);
      syncSeriesData(api, type, series);
      next.push({ key: series.id, type, api, label: series.label, points: series.points, colorKey });
    }
    for (const [, entry] of byKey) chart.removeSeries(entry.api);
    seriesRef.current = next;
  }, [chartEpoch, chartSeries, colors]);

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
  }, [viewport]);

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
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        cursor: measureEnabled ? "crosshair" : interactive ? "grab" : undefined,
        touchAction: measureEnabled ? "none" : undefined,
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