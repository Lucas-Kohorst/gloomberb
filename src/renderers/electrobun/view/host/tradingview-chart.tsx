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

function timestamp(value: number): UTCTimestamp {
  return Math.floor(value / 1000) as UTCTimestamp;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

type ProjectedSeries = TradingViewChartProps["panel"]["series"][number];

interface SeriesDatum {
  time: Time;
  value: number;
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

function projectSeriesData(projected: ProjectedSeries): {
  data: { time: Time; value: number }[];
  candle: { time: Time; open: number; high: number; low: number; close: number }[];
} {
  const candle = projected.points
    .filter((point) => finite(point.point.open) && finite(point.point.high)
      && finite(point.point.low) && finite(point.point.close))
    .map((point) => ({
      time: timestamp(point.timestamp),
      open: point.point.open!,
      high: point.point.high!,
      low: point.point.low!,
      close: point.point.close!,
    }));
  const data = projected.points
    .filter((point) => finite(point.value))
    .map((point) => ({ time: timestamp(point.timestamp), value: point.value as number }));
  return { data, candle };
}

function addChartSeries(
  chart: IChartApi,
  projected: ProjectedSeries,
  colors: TradingViewChartProps["colors"],
): ISeriesApi<"Line" | "Area" | "Candlestick" | "Histogram"> {
  const source = projected.source;
  const { data, candle } = projectSeriesData(projected);
  if (candle.length > 0) {
    const series = chart.addSeries(CandlestickSeries, {
      upColor: source.color,
      downColor: colors.negative,
      borderVisible: false,
      wickUpColor: source.color,
      wickDownColor: colors.negative,
    });
    series.setData(candle);
    return series;
  }
  if (source.style === "columns") {
    const series = chart.addSeries(HistogramSeries, {
      color: source.color,
      priceFormat: { type: "volume" },
      base: 0,
    });
    series.setData(data.map((point) => ({ ...point, color: source.color })));
    return series;
  }
  if (source.style === "area") {
    const series = chart.addSeries(AreaSeries, {
      lineColor: source.color,
      topColor: `${source.color}55`,
      bottomColor: `${source.color}08`,
      lineWidth: 2,
    });
    series.setData(data);
    return series;
  }
  const series = chart.addSeries(LineSeries, {
    color: source.color,
    lineWidth: 2,
    lineType: source.style === "step" ? 1 : 0,
    crosshairMarkerVisible: true,
  });
  series.setData(data);
  return series;
}

function seriesTypeFor(projected: ProjectedSeries): SeriesEntry["type"] {
  const style = projected.source.style;
  if (style === "candles") return "Candlestick";
  if (style === "columns") return "Histogram";
  if (style === "area") return "Area";
  return "Line";
}

function applySeriesColors(
  api: SeriesEntry["api"],
  type: SeriesEntry["type"],
  projected: ProjectedSeries,
  colors: TradingViewChartProps["colors"],
): void {
  const source = projected.source;
  if (type === "Candlestick") {
    api.applyOptions({
      upColor: source.color,
      downColor: colors.negative,
      wickUpColor: source.color,
      wickDownColor: colors.negative,
    });
  } else if (type === "Histogram") {
    api.applyOptions({ color: source.color });
  } else if (type === "Area") {
    api.applyOptions({
      lineColor: source.color,
      topColor: `${source.color}55`,
      bottomColor: `${source.color}08`,
    });
  } else {
    api.applyOptions({ color: source.color });
  }
}

function syncSeriesData(
  api: SeriesEntry["api"],
  type: SeriesEntry["type"],
  projected: ProjectedSeries,
): void {
  const { data, candle } = projectSeriesData(projected);
  if (type === "Candlestick") {
    api.setData(candle);
  } else if (type === "Histogram") {
    api.setData(data.map((point) => ({ ...point, color: projected.source.color })));
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
};

export function WebTradingViewChart({
  panel,
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
      const start = typeof range.from === "number" ? range.from : null;
      const end = typeof range.to === "number" ? range.to : null;
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

    const entries: SeriesEntry[] = panel.series.map((projected) => ({
      key: projected.source.id,
      type: seriesTypeFor(projected),
      api: addChartSeries(chart, projected, colors),
    }));
    seriesRef.current = entries;

    const handleCrosshairMove: MouseEventHandler<Time> = (param) => {
      const tooltip = tooltipRef.current;
      if (!tooltip || !param.point || !param.time) {
        if (tooltip) tooltip.hidden = true;
        return;
      }
      const values = panel.series.flatMap((projected, index) => {
        const api = seriesRef.current[index]?.api;
        if (!api) return [];
        const value = param.seriesData.get(api) as
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
  }, [chartOptions]);

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
  }, [interactive, measureEnabled]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const byKey = new Map(seriesRef.current.map((entry) => [entry.key, entry]));
    const next: SeriesEntry[] = [];
    for (const projected of panel.series) {
      const key = projected.source.id;
      const type = seriesTypeFor(projected);
      const existing = byKey.get(key);
      if (existing) {
        byKey.delete(key);
        if (existing.type === type) {
          applySeriesColors(existing.api, type, projected, colors);
          syncSeriesData(existing.api, type, projected);
          next.push(existing);
          continue;
        }
        chart.removeSeries(existing.api);
      }
      const api = addChartSeries(chart, projected, colors);
      next.push({ key, type, api });
    }
    for (const [, entry] of byKey) chart.removeSeries(entry.api);
    seriesRef.current = next;
  }, [colors, panel]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !viewport) return;
    const from = timestamp(viewport.start.getTime());
    const to = timestamp(viewport.end.getTime());
    const key = `${from}:${to}`;
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