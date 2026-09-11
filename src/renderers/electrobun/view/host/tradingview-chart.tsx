/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LastPriceAnimationMode,
  LineSeries,
  LineType,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventHandler,
  type Time,
  type TimeRangeChangeEventHandler,
} from "lightweight-charts";
import type { TradingViewChartProps } from "../../../../ui/host";
import {
  formatChartLegendValue,
  formatChartVolume,
  formatCompositeTimeAxisDate,
  formatOhlcvHud,
} from "../../../../components/chart/composite/format";
import { formatMeasureSpan } from "../../../../components/chart/composite/tools";
import type { PanelScale, ResolvedSeries, TimeSeriesPoint } from "../../../../time-series/types";
import {
  classifyWheelGesture,
  panVisibleTimeRange,
  sameVisibleTimeRange,
  scaleVisibleTimeRange,
  visibleRangeInteraction,
  wheelDeltaPixels,
  wheelPanRatioFromDelta,
  wheelZoomFactorFromDelta,
  type TrackpadGestureKind,
  type VisibleTimeRangeMs,
} from "./tradingview-interactions";
import { cleanDomProps } from "./style";
import {
  marketChartTimePacking,
  tradingViewBarData,
  tradingViewCandleData,
  tradingViewHistogramData,
  tradingViewScalarData,
  tradingViewSeriesTypeFor,
  type ChartTimePacking,
  type TradingViewSeriesType,
} from "./tradingview-series-data";

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function timeToMs(time: Time, packing: ChartTimePacking): number | null {
  if (typeof time === "number") return packing.fromPackedSeconds(time);
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (time && typeof time === "object" && "year" in time) {
    return new Date(time.year, time.month - 1, time.day).getTime();
  }
  return null;
}

function priceScaleIdFor(series: ResolvedSeries): "left" | "right" {
  return series.axis === "left" ? "left" : "right";
}

function createSeries(
  chart: IChartApi,
  series: ResolvedSeries,
  type: TradingViewSeriesType,
  colors: TradingViewChartProps["colors"],
): ISeriesApi<"Line" | "Area" | "Bar" | "Candlestick" | "Histogram"> {
  const priceScaleId = priceScaleIdFor(series);
  const lastValueVisible = true;
  const priceLineVisible = true;
  switch (type) {
    case "Candlestick":
      return chart.addSeries(CandlestickSeries, {
        upColor: series.color,
        downColor: colors.negative,
        borderVisible: false,
        wickUpColor: series.color,
        wickDownColor: colors.negative,
        priceScaleId,
        lastValueVisible,
        priceLineVisible,
      });
    case "Bar":
      return chart.addSeries(BarSeries, {
        upColor: series.color,
        downColor: colors.negative,
        openVisible: series.style !== "hlc",
        thinBars: false,
        priceScaleId,
        lastValueVisible,
        priceLineVisible,
      });
    case "Histogram":
      return chart.addSeries(HistogramSeries, {
        color: series.color,
        priceFormat: { type: "volume" },
        base: 0,
        priceScaleId,
        lastValueVisible,
        priceLineVisible,
      });
    case "Area":
      return chart.addSeries(AreaSeries, {
        lineColor: series.color,
        topColor: `${series.color}55`,
        bottomColor: `${series.color}08`,
        lineWidth: 2,
        priceScaleId,
        lastValueVisible,
        priceLineVisible,
        lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
      });
    default:
      return chart.addSeries(LineSeries, {
        color: series.color,
        lineWidth: 2,
        lineVisible: series.style !== "points",
        lineType: series.style === "step" ? LineType.WithSteps : LineType.Simple,
        pointMarkersVisible: series.style === "points",
        crosshairMarkerVisible: true,
        priceScaleId,
        lastValueVisible,
        priceLineVisible,
        lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
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
  } else if (type === "Bar") {
    api.applyOptions({
      upColor: series.color,
      downColor: colors.negative,
    });
  } else if (type === "Area") {
    api.applyOptions({
      lineColor: series.color,
      topColor: `${series.color}55`,
      bottomColor: `${series.color}08`,
    });
  } else if (type !== "Histogram") {
    api.applyOptions({ color: series.color });
  }
}

function syncSeriesData(
  api: SeriesEntry["api"],
  type: TradingViewSeriesType,
  series: ResolvedSeries,
  colors: TradingViewChartProps["colors"],
  packing: ChartTimePacking,
): void {
  if (type === "Candlestick" || type === "Bar") {
    const data = (type === "Bar" ? tradingViewBarData : tradingViewCandleData)(series.points, packing)
      .map((point) => ({ ...point, time: point.time as Time }));
    api.setData(data);
    return;
  }
  if (type === "Histogram") {
    api.setData(tradingViewHistogramData(series.points, {
      up: series.color,
      down: colors.negative,
    }, packing).map((point) => ({ ...point, time: point.time as Time })));
    return;
  }
  api.setData(tradingViewScalarData(series.points, packing).map((point) => ({
    ...point,
    time: point.time as Time,
  })));
}

interface MeasureState {
  start: { rx: number; ry: number; time: number; price: number };
  end: { rx: number; ry: number; time: number; price: number };
}

function lightweightPriceScaleMode(scale: PanelScale | undefined, panelId: string): PriceScaleMode {
  if (panelId === "volume") return PriceScaleMode.Normal;
  if (scale === "log") return PriceScaleMode.Logarithmic;
  if (scale === "percent") return PriceScaleMode.Percentage;
  return PriceScaleMode.Normal;
}

type SeriesEntry = {
  key: string;
  type: TradingViewSeriesType;
  style: ResolvedSeries["style"];
  api: ISeriesApi<"Line" | "Area" | "Bar" | "Candlestick" | "Histogram">;
  label: string;
  unit: string;
  unitGroup: string;
  /** Last data written, so a pan does not re-set identical points. */
  points: readonly TimeSeriesPoint[];
  packing: ChartTimePacking;
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
  timeZone,
  style,
  ...props
}: TradingViewChartProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rangeRef = useRef<string | null>(null);
  const visibleMsRef = useRef<VisibleTimeRangeMs | null>(null);
  const applyingRangeRef = useRef(false);
  const gestureActiveRef = useRef(false);
  const gestureKindRef = useRef<TrackpadGestureKind | null>(null);
  const gestureIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureStartRangeRef = useRef<{ start: number; end: number } | null>(null);
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const timeZoneRef = useRef(timeZone);
  timeZoneRef.current = timeZone;
  const seriesRef = useRef<SeriesEntry[]>([]);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const packing = useMemo(() => marketChartTimePacking(seriesData), [seriesData]);
  const packingRef = useRef(packing);
  packingRef.current = packing;
  const applyVisibleRangeRef = useRef<
    (next: VisibleTimeRangeMs, report?: TrackpadGestureKind | null) => void
  >(() => {});
  applyVisibleRangeRef.current = (next, report = null) => {
    const chart = chartRef.current;
    if (!chart) return;
    const from = packingRef.current.toPackedSeconds(next.start);
    const to = packingRef.current.toPackedSeconds(next.end);
    if (to <= from) return;
    applyingRangeRef.current = true;
    visibleMsRef.current = next;
    rangeRef.current = `${from}:${to}`;
    chart.timeScale().setVisibleRange({ from: from as Time, to: to as Time });
    applyingRangeRef.current = false;
    if (report) {
      onViewportChangeRef.current?.(
        { start: new Date(next.start), end: new Date(next.end) },
        report,
      );
    }
  };
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
      layout: {
        ...chartOptions.layout,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        attributionLogo: true,
      },
      grid: chartOptions.grid,
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { visible: true, labelVisible: true },
        horzLine: { visible: true, labelVisible: true },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.08 },
        mode: PriceScaleMode.Normal,
      },
      leftPriceScale: {
        visible: false,
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        visible: true,
        rightOffset: 6,
        fixLeftEdge: false,
        fixRightEdge: false,
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => {
          if (typeof time !== "number") return "";
          const ms = packingRef.current.fromPackedSeconds(time);
          const view = viewportRef.current;
          const start = view?.start.getTime() ?? ms;
          const end = view?.end.getTime() ?? ms;
          return formatCompositeTimeAxisDate(new Date(ms), start, end, timeZoneRef.current);
        },
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
      const next = {
        start: packingRef.current.fromPackedSeconds(start),
        end: packingRef.current.fromPackedSeconds(end),
      };
      const previous = visibleMsRef.current;
      rangeRef.current = key;
      visibleMsRef.current = next;
      // Programmatic setVisibleRange (wheel, parent viewport, setData restore)
      // already reported or must not echo, or the parent fights the pan.
      // Wheel/pinch also set gestureKindRef and report from applyVisibleRange.
      if (applyingRangeRef.current || gestureKindRef.current) return;
      if (previous && sameVisibleTimeRange(previous, next)) return;
      const report = onViewportChangeRef.current;
      if (report) {
        report(
          { start: new Date(next.start), end: new Date(next.end) },
          visibleRangeInteraction(previous, next),
        );
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
          | { value?: number; close?: number; open?: number; high?: number; low?: number }
          | undefined;
        const hud = formatOhlcvHud({
          open: value?.open,
          high: value?.high,
          low: value?.low,
          close: value?.close,
          volume: undefined,
          value: value?.close ?? null,
        }, entry.unit, entry.unitGroup);
        if (hud) return [hud];
        const numeric = value?.value ?? value?.close;
        if (!finite(numeric)) return [];
        if (entry.label.toLowerCase().includes("volume")) {
          return [`V ${formatChartVolume(numeric)}`];
        }
        return [`${entry.label}: ${formatChartLegendValue(numeric, entry.unit, entry.unitGroup)}`];
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
      visibleMsRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const current = visibleMsRef.current;
    if (!current) return;
    applyVisibleRangeRef.current(current);
  }, [chartEpoch, timeZone]);

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
    let dataChanged = false;
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
          if (existing.points !== series.points || existing.packing !== packing) {
            syncSeriesData(existing.api, type, series, colors, packing);
            existing.points = series.points;
            existing.packing = packing;
            dataChanged = true;
          }
          existing.style = series.style;
          existing.label = series.label;
          existing.unit = series.unit;
          existing.unitGroup = series.unitGroup;
          next.push(existing);
          continue;
        }
        chart.removeSeries(existing.api);
      }
      const api = createSeries(chart, series, type, colors);
      syncSeriesData(api, type, series, colors, packing);
      dataChanged = true;
      next.push({
        key: series.id,
        type,
        style: series.style,
        api,
        label: series.label,
        unit: series.unit,
        unitGroup: series.unitGroup,
        points: series.points,
        packing,
        colorKey,
      });
    }
    for (const [, entry] of byKey) {
      chart.removeSeries(entry.api);
      dataChanged = true;
    }
    seriesRef.current = next;
    const usesLeft = seriesData.some((series) => series.axis === "left");
    const usesRight = seriesData.some((series) => series.axis !== "left");
    const mode = lightweightPriceScaleMode(panel.scale, panel.id);
    const autoScale = panel.autoScale !== false;
    chart.applyOptions({
      leftPriceScale: { visible: usesLeft, autoScale },
      rightPriceScale: {
        visible: usesRight || !usesLeft,
        mode,
        autoScale,
      },
    });
    if (usesLeft) {
      chart.priceScale("left").applyOptions({ mode, autoScale });
    }
    // setData resets LWC's time scale. Keep the window the user was looking at.
    const restore = visibleMsRef.current;
    if (dataChanged && restore) applyVisibleRangeRef.current(restore);
  }, [chartEpoch, colors, packing, panel.autoScale, panel.id, panel.scale, seriesData]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !viewport) return;
    // Parent clamp/echo during a trackpad swipe is what makes the plot jump
    // back after a pan that already landed.
    if (gestureActiveRef.current) return;
    const next = { start: viewport.start.getTime(), end: viewport.end.getTime() };
    const current = visibleMsRef.current;
    if (current && sameVisibleTimeRange(current, next)) return;
    applyVisibleRangeRef.current(next);
  }, [chartEpoch, viewport]);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;

    const visibleRangeMs = (): VisibleTimeRangeMs | null => {
      const range = chartRef.current?.timeScale().getVisibleRange();
      if (!range) return null;
      const start = timeToMs(range.from, packingRef.current);
      const end = timeToMs(range.to, packingRef.current);
      if (start === null || end === null || end <= start) return null;
      return { start, end };
    };

    const pointerAnchor = (clientX: number, width: number) => (
      width > 0 ? Math.min(1, Math.max(0, (clientX - node.getBoundingClientRect().left) / width)) : 0.5
    );

    const noteUserGesture = (kind?: TrackpadGestureKind) => {
      gestureActiveRef.current = true;
      if (kind) gestureKindRef.current = kind;
      if (gestureIdleTimerRef.current) clearTimeout(gestureIdleTimerRef.current);
      gestureIdleTimerRef.current = setTimeout(() => {
        gestureActiveRef.current = false;
        gestureKindRef.current = null;
        gestureIdleTimerRef.current = null;
        const pending = viewportRef.current;
        if (!pending) return;
        const next = { start: pending.start.getTime(), end: pending.end.getTime() };
        const current = visibleMsRef.current;
        if (current && sameVisibleTimeRange(current, next)) return;
        applyVisibleRangeRef.current(next);
      }, 160);
    };

    const pendingWheel = {
      deltaX: 0,
      deltaY: 0,
      clientX: 0,
      width: 0,
      ctrlKey: false,
      metaKey: false,
    };
    let wheelRaf = 0;

    const flushWheel = () => {
      wheelRaf = 0;
      const { deltaX, deltaY, clientX, width, ctrlKey, metaKey } = pendingWheel;
      pendingWheel.deltaX = 0;
      pendingWheel.deltaY = 0;
      const kind = classifyWheelGesture(
        { deltaX, deltaY, ctrlKey, metaKey },
        gestureKindRef.current,
      );
      if (!kind) return;
      gestureKindRef.current = kind;
      noteUserGesture(kind);
      const current = visibleRangeMs();
      if (!current || !(width > 0)) return;
      if (kind === "pan") {
        applyVisibleRangeRef.current(
          panVisibleTimeRange(current, wheelPanRatioFromDelta(deltaX, width)),
          "pan",
        );
        return;
      }
      applyVisibleRangeRef.current(
        scaleVisibleTimeRange(
          current,
          wheelZoomFactorFromDelta(deltaY),
          pointerAnchor(clientX, width),
        ),
        "zoom",
      );
    };

    const onWheel = (event: WheelEvent) => {
      if (!interactiveRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = node.getBoundingClientRect();
      if (!(rect.width > 0)) return;
      const kind = classifyWheelGesture(event, gestureKindRef.current);
      if (kind) gestureKindRef.current = kind;
      noteUserGesture(kind ?? undefined);
      pendingWheel.deltaX += wheelDeltaPixels(event.deltaX, event.deltaMode, rect.width);
      pendingWheel.deltaY += wheelDeltaPixels(event.deltaY, event.deltaMode, rect.height);
      pendingWheel.clientX = event.clientX;
      pendingWheel.width = rect.width;
      pendingWheel.ctrlKey = event.ctrlKey;
      pendingWheel.metaKey = event.metaKey;
      if (!wheelRaf) wheelRaf = requestAnimationFrame(flushWheel);
    };

    const onGestureStart = (event: Event) => {
      if (!interactiveRef.current) return;
      event.preventDefault();
      noteUserGesture("zoom");
      gestureStartRangeRef.current = visibleRangeMs();
    };
    const onGestureChange = (event: Event) => {
      if (!interactiveRef.current) return;
      event.preventDefault();
      noteUserGesture("zoom");
      const start = gestureStartRangeRef.current;
      const gesture = event as Event & { scale?: number; clientX?: number };
      if (!start || typeof gesture.scale !== "number" || !(gesture.scale > 0)) return;
      const width = node.getBoundingClientRect().width;
      applyVisibleRangeRef.current(
        scaleVisibleTimeRange(
          start,
          gesture.scale,
          pointerAnchor(typeof gesture.clientX === "number" ? gesture.clientX : 0, width),
        ),
        "zoom",
      );
    };
    const onGestureEnd = () => {
      gestureStartRangeRef.current = null;
      noteUserGesture("zoom");
    };

    const onPointerDown = () => {
      if (!interactiveRef.current) return;
      gestureActiveRef.current = true;
      if (gestureIdleTimerRef.current) {
        clearTimeout(gestureIdleTimerRef.current);
        gestureIdleTimerRef.current = null;
      }
    };
    const onPointerUp = () => {
      if (!gestureActiveRef.current) return;
      noteUserGesture();
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("gesturestart", onGestureStart, { passive: false });
    node.addEventListener("gesturechange", onGestureChange, { passive: false });
    node.addEventListener("gestureend", onGestureEnd);
    node.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      if (wheelRaf) cancelAnimationFrame(wheelRaf);
      if (gestureIdleTimerRef.current) {
        clearTimeout(gestureIdleTimerRef.current);
        gestureIdleTimerRef.current = null;
      }
      gestureActiveRef.current = false;
      gestureKindRef.current = null;
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("gesturestart", onGestureStart);
      node.removeEventListener("gesturechange", onGestureChange);
      node.removeEventListener("gestureend", onGestureEnd);
      node.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
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
    const time = timeToMs(rawTime, packingRef.current);
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
    const time = timeToMs(rawTime, packingRef.current);
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
      {...cleanDomProps(props as Record<string, unknown>)}
      {...pointerHandlers}
      ref={wrapperRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        flex: 1,
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
