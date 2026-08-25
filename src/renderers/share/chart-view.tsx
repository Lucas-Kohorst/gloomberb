/** @jsxImportSource react */
/**
 * Shared chart view.
 *
 * Draws the snapshot's points directly with lightweight-charts. There is no
 * resolution pipeline here on purpose: the share page has no providers, no
 * credentials, and no reason to recompute values the sharer already saw.
 *
 * The pane header already names the chart. The strip above the plot is last,
 * change, range, and window — not the title again.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { formatChartLegendValue } from "../../components/chart/composite/format";
import type { ChartSharePanel, ChartSharePayload, ChartShareSeries } from "../../shares/payload";
import {
  formatShareChange,
  formatShareCursorDate,
  formatShareRange,
  formatShareSpan,
  formatShareTickMark,
  nearestSharePoint,
  payloadTimeSpan,
  seriesShareStats,
  shareLegendName,
  sharePointValue,
  shareTimeVisible,
  type ShareSeriesStats,
} from "./chart-stats";
import { ShareShell, formatShareTimestamp } from "./shell";

const CHART_PALETTE = {
  background: "#16140f",
  text: "#c5c0b0",
  grid: "rgba(44, 74, 60, 0.35)",
  border: "#2c4a3c",
  negative: "#e06256",
};

const STUDY_PANEL_HEIGHT_PX = 150;

type SeriesType = "Line" | "Area" | "Candlestick" | "Histogram";

function seriesTypeFor(series: ChartShareSeries): SeriesType {
  if (series.style === "columns") return "Histogram";
  if (series.style === "area") return "Area";
  const ohlc = series.style === "candles" || series.style === "ohlc" || series.style === "hlc";
  if (ohlc && series.points.some((point) => point.c !== undefined)) return "Candlestick";
  return "Line";
}

/**
 * lightweight-charts rejects duplicate and out-of-order timestamps, and a
 * snapshot can carry both once a live quote has been merged onto its own bar.
 * Latest reading per UTC second wins.
 */
function seriesData(series: ChartShareSeries, type: SeriesType) {
  const bySecond = new Map<number, (typeof series.points)[number]>();
  for (const point of series.points) {
    if (Number.isFinite(point.t)) bySecond.set(Math.floor(point.t / 1000), point);
  }
  const ordered = [...bySecond.entries()].sort(([left], [right]) => left - right);
  if (type === "Candlestick") {
    return ordered.flatMap(([time, point]) => (
      point.o !== undefined && point.h !== undefined && point.l !== undefined && point.c !== undefined
        ? [{ time: time as UTCTimestamp as Time, open: point.o, high: point.h, low: point.l, close: point.c }]
        : []
    ));
  }
  return ordered.flatMap(([time, point]) => {
    const value = point.v ?? point.c;
    return typeof value === "number" && Number.isFinite(value)
      ? [{ time: time as UTCTimestamp as Time, value }]
      : [];
  });
}

function formatShareValue(series: ChartShareSeries, value: number): string {
  return formatChartLegendValue(value, series.unit ?? "");
}

function percentPriceFormat(unit: string | undefined) {
  const trimmed = unit?.trim() ?? "";
  if (trimmed !== "%" && !trimmed.toLowerCase().includes("percent")) return undefined;
  return {
    type: "custom" as const,
    minMove: 0.1,
    formatter: (price: number) => (
      Number.isFinite(price) ? `${price.toFixed(Math.abs(price) >= 10 ? 1 : 2)}%` : ""
    ),
  };
}

function addSeries(chart: IChartApi, series: ChartShareSeries, type: SeriesType) {
  const priceFormat = percentPriceFormat(series.unit);
  switch (type) {
    case "Candlestick":
      return chart.addSeries(CandlestickSeries, {
        upColor: series.color,
        downColor: CHART_PALETTE.negative,
        borderVisible: false,
        wickUpColor: series.color,
        wickDownColor: CHART_PALETTE.negative,
        ...(priceFormat ? { priceFormat } : {}),
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
        ...(priceFormat ? { priceFormat } : {}),
      });
    default:
      return chart.addSeries(LineSeries, {
        color: series.color,
        lineWidth: 2,
        lineType: series.style === "step" ? 1 : 0,
        ...(priceFormat ? { priceFormat } : {}),
      });
  }
}

function timeToMs(time: Time): number | null {
  if (typeof time === "number") return time * 1000;
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (time && typeof time === "object" && "year" in time) {
    return Date.UTC(time.year, time.month - 1, time.day);
  }
  return null;
}

function ChartPanel({
  panel,
  series,
  fill,
  heightPx,
  logScale,
  attribution,
  timeVisible,
  onCursorTime,
}: {
  panel: ChartSharePanel;
  series: readonly ChartShareSeries[];
  fill: boolean;
  heightPx: number;
  logScale: boolean;
  /** Shown once per page rather than once per panel. */
  attribution: boolean;
  timeVisible: boolean;
  onCursorTime?: (timeMs: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCursorTimeRef = useRef(onCursorTime);
  onCursorTimeRef.current = onCursorTime;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: CHART_PALETTE.background },
        textColor: CHART_PALETTE.text,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        attributionLogo: attribution,
      },
      grid: {
        vertLines: { color: CHART_PALETTE.grid },
        horzLines: { color: CHART_PALETTE.grid },
      },
      rightPriceScale: {
        borderColor: CHART_PALETTE.border,
        mode: logScale ? 1 : 0,
        scaleMargins: { top: 0.08, bottom: 0.06 },
      },
      timeScale: {
        borderColor: CHART_PALETTE.border,
        timeVisible,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, tickMarkType: number) => {
          const ms = timeToMs(time);
          return ms === null ? null : formatShareTickMark(ms, tickMarkType);
        },
      },
      crosshair: { mode: 1 },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
      },
      handleScale: {
        mouseWheel: false,
        pinch: true,
        axisPressedMouseMove: true,
      },
    });

    for (const entry of series) {
      const type = seriesTypeFor(entry);
      addSeries(chart, entry, type).setData(seriesData(entry, type) as never);
    }
    chart.timeScale().fitContent();

    const handleCrosshair = (param: { time?: Time; point?: unknown }) => {
      if (param.time === undefined || param.point === undefined) {
        onCursorTimeRef.current?.(null);
        return;
      }
      onCursorTimeRef.current?.(timeToMs(param.time));
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
    };
  }, [attribution, logScale, series, timeVisible]);

  return (
    <div
      className="share-panel"
      data-fill={fill ? "true" : undefined}
      style={fill ? undefined : { height: `${heightPx}px` }}
    >
      {panel.label ? <span className="share-panel-label">{panel.label}</span> : null}
      <div className="share-panel-canvas" ref={containerRef} />
    </div>
  );
}

function changeTone(change: string | null): "pos" | "neg" | undefined {
  if (!change) return undefined;
  if (change.startsWith("+")) return "pos";
  if (change.startsWith("-")) return "neg";
  return undefined;
}

function ShareLegendItem({
  series,
  stats,
  chartTitle,
  cursorMs,
  span,
}: {
  series: ChartShareSeries;
  stats: ShareSeriesStats;
  chartTitle: string;
  cursorMs: number | null;
  span: { startMs: number; endMs: number } | null;
}) {
  const name = shareLegendName(series.label, chartTitle);
  const hovered = cursorMs === null ? null : nearestSharePoint(series, cursorMs);
  const hoveredValue = hovered ? sharePointValue(hovered) : null;
  const hovering = hoveredValue !== null;
  const value = hovering ? hoveredValue : stats.last;
  const change = hovering ? null : formatShareChange(stats, series.unit);
  const range = hovering ? null : formatShareRange(stats, (amount) => formatShareValue(series, amount));
  const date = hovering && hovered && span
    ? formatShareCursorDate(hovered.t, span.startMs, span.endMs)
    : null;

  return (
    <li>
      <span className="share-swatch" style={{ backgroundColor: series.color }} />
      {name ? <span className="share-legend-name">{name}</span> : null}
      <span className="share-legend-last">{formatShareValue(series, value)}</span>
      {date ? <span className="share-legend-date">{date}</span> : null}
      {change ? (
        <span className="share-legend-change" data-tone={changeTone(change)}>{change}</span>
      ) : null}
      {range ? <span className="share-legend-range">{range}</span> : null}
    </li>
  );
}

export function ChartShareView({
  payload,
  openInTerminalHref,
}: {
  payload: ChartSharePayload;
  openInTerminalHref?: string | null;
}) {
  const [cursorMs, setCursorMs] = useState<number | null>(null);
  const onCursorTime = useCallback((timeMs: number | null) => setCursorMs(timeMs), []);

  const span = useMemo(() => payloadTimeSpan(payload), [payload]);
  const timeVisible = span ? shareTimeVisible(span.startMs, span.endMs) : false;
  const windowLabel = span ? formatShareSpan(span.startMs, span.endMs) : null;

  const panels = useMemo(() => payload.panels.map((panel, index) => ({
    panel,
    series: payload.series.filter((entry) => entry.panelId === panel.id),
    fill: index === 0,
    heightPx: STUDY_PANEL_HEIGHT_PX,
  })).filter((entry) => entry.series.length > 0), [payload.panels, payload.series]);

  const captured = formatShareTimestamp(payload.capturedAt);
  const footer = [
    captured ? `snapshot ${captured}` : null,
    payload.subtitle?.trim() || null,
  ].filter(Boolean).join(" · ");

  return (
    <ShareShell
      layout="wide"
      title={payload.title}
      footer={footer}
      openInTerminalHref={openInTerminalHref}
    >
      <div className="share-chart-frame">
        <div className="share-chart">
          {payload.series.length > 0 ? (
            <div className="share-legend">
              <ul>
                {payload.series.map((entry) => {
                  const stats = seriesShareStats(entry);
                  if (!stats) {
                    const name = shareLegendName(entry.label, payload.title);
                    return (
                      <li key={entry.id}>
                        <span className="share-swatch" style={{ backgroundColor: entry.color }} />
                        {name ?? entry.label}
                      </li>
                    );
                  }
                  return (
                    <ShareLegendItem
                      key={entry.id}
                      series={entry}
                      stats={stats}
                      chartTitle={payload.title}
                      cursorMs={cursorMs}
                      span={span}
                    />
                  );
                })}
              </ul>
              {windowLabel && cursorMs === null ? (
                <span className="share-legend-window">{windowLabel}</span>
              ) : null}
            </div>
          ) : null}

          {panels.length > 0 ? (
            <div className="share-panels">
              {panels.map(({ panel, series, fill, heightPx }, index) => (
                <ChartPanel
                  key={panel.id}
                  panel={panel}
                  series={series}
                  fill={fill}
                  heightPx={heightPx}
                  logScale={panel.scale === "log"}
                  attribution={index === 0}
                  timeVisible={timeVisible}
                  onCursorTime={index === 0 ? onCursorTime : undefined}
                />
              ))}
            </div>
          ) : (
            <p className="share-note">This chart snapshot contains no plotted data.</p>
          )}
        </div>
      </div>
    </ShareShell>
  );
}
