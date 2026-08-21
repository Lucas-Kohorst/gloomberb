/** @jsxImportSource react */
/**
 * Shared chart view.
 *
 * Draws the snapshot's points directly with lightweight-charts. There is no
 * resolution pipeline here on purpose: the share page has no providers, no
 * credentials, and no reason to recompute values the sharer already saw.
 */

import { useEffect, useMemo, useRef } from "react";
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
import { ShareShell, formatShareTimestamp } from "./shell";

const CHART_PALETTE = {
  background: "#000000",
  text: "#92763c",
  grid: "rgba(26, 58, 92, 0.35)",
  border: "#1a3a5c",
  negative: "#ff3333",
};

const MAIN_PANEL_HEIGHT_PX = 420;
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

function lastShareValue(series: ChartShareSeries): number | null {
  for (let index = series.points.length - 1; index >= 0; index -= 1) {
    const point = series.points[index];
    const value = point?.v ?? point?.c;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function formatShareLegendValue(series: ChartShareSeries): string | null {
  const value = lastShareValue(series);
  return value === null ? null : formatChartLegendValue(value, series.unit ?? "");
}

function addSeries(chart: IChartApi, series: ChartShareSeries, type: SeriesType) {
  switch (type) {
    case "Candlestick":
      return chart.addSeries(CandlestickSeries, {
        upColor: series.color,
        downColor: CHART_PALETTE.negative,
        borderVisible: false,
        wickUpColor: series.color,
        wickDownColor: CHART_PALETTE.negative,
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
      });
  }
}

function ChartPanel({
  panel,
  series,
  heightPx,
  logScale,
  attribution,
}: {
  panel: ChartSharePanel;
  series: readonly ChartShareSeries[];
  heightPx: number;
  logScale: boolean;
  /** Shown once per page rather than once per panel. */
  attribution: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: CHART_PALETTE.background },
        textColor: CHART_PALETTE.text,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10,
        attributionLogo: attribution,
      },
      grid: {
        vertLines: { color: CHART_PALETTE.grid },
        horzLines: { color: CHART_PALETTE.grid },
      },
      rightPriceScale: {
        borderColor: CHART_PALETTE.border,
        mode: logScale ? 1 : 0,
      },
      timeScale: { borderColor: CHART_PALETTE.border, timeVisible: true },
      crosshair: { mode: 1 },
      handleScale: { axisPressedMouseMove: false },
    });

    for (const entry of series) {
      const type = seriesTypeFor(entry);
      addSeries(chart, entry, type).setData(seriesData(entry, type) as never);
    }
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [attribution, logScale, series]);

  return (
    <div className="share-panel" style={{ height: `${heightPx}px` }}>
      {panel.label ? <span className="share-panel-label">{panel.label}</span> : null}
      <div className="share-panel-canvas" ref={containerRef} style={{ height: "100%" }} />
    </div>
  );
}

export function ChartShareView({
  payload,
  openInTerminalHref,
}: {
  payload: ChartSharePayload;
  openInTerminalHref?: string | null;
}) {
  const panels = useMemo(() => payload.panels.map((panel, index) => ({
    panel,
    series: payload.series.filter((entry) => entry.panelId === panel.id),
    heightPx: index === 0 ? MAIN_PANEL_HEIGHT_PX : STUDY_PANEL_HEIGHT_PX,
  })).filter((entry) => entry.series.length > 0), [payload.panels, payload.series]);

  const captured = formatShareTimestamp(payload.capturedAt);
  const footer = captured ? `snapshot ${captured}` : "";

  return (
    <ShareShell
      layout="wide"
      title={payload.title}
      footer={footer}
      openInTerminalHref={openInTerminalHref}
    >
      <div className="share-chart">
        {payload.series.length > 0 ? (
          <ul className="share-legend">
            {payload.series.map((entry) => {
              const value = formatShareLegendValue(entry);
              return (
                <li key={entry.id}>
                  <span className="share-swatch" style={{ backgroundColor: entry.color }} />
                  {value ? `${entry.label} ${value}` : entry.label}
                </li>
              );
            })}
          </ul>
        ) : null}

        {panels.length > 0 ? (
          <div className="share-panels">
            {panels.map(({ panel, series, heightPx }, index) => (
              <ChartPanel
                key={panel.id}
                panel={panel}
                series={series}
                heightPx={heightPx}
                logScale={panel.scale === "log"}
                attribution={index === 0}
              />
            ))}
          </div>
        ) : (
          <p className="share-note">This chart snapshot contains no plotted data.</p>
        )}
      </div>
    </ShareShell>
  );
}
