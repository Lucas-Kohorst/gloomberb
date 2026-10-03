/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatChartLegendValue } from "../../components/chart/composite/format";
import { ChartingLibraryFrame } from "../../plugins/builtin/chart-composer/charting-library-frame";
import {
  createResolvedSeriesLibraryFeed,
  type ResolvedLibraryModel,
  type ResolvedLibrarySeries,
} from "../../plugins/builtin/chart-composer/charting-library-feed";
import type { ChartSharePayload, ChartSharePoint, ChartShareSeries } from "../../shares/payload";
import type { TimeSeriesPoint } from "../../time-series/types";
import {
  formatShareChange,
  formatShareRange,
  formatShareSpan,
  payloadTimeSpan,
  seriesShareStats,
  shareLegendName,
  type ShareSeriesStats,
} from "./chart-stats";
import { ShareShell, formatShareTimestamp } from "./shell";

const CHART_PALETTE = {
  background: "#16140f",
  grid: "rgba(44, 74, 60, 0.35)",
};

const STUDY_PANEL_HEIGHT_PX = 150;

const SHARE_LIBRARY_INTERVALS = [
  [90_000, "1"],
  [360_000, "5"],
  [1_200_000, "15"],
  [2_400_000, "30"],
  [3_000_000, "45"],
  [5_400_000, "60"],
  [18_000_000, "240"],
  [172_800_000, "D"],
  [1_209_600_000, "W"],
] as const;

type ShareLibraryInterval = typeof SHARE_LIBRARY_INTERVALS[number][1] | "M";

function finiteShareNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function shareClose(point: ChartSharePoint): number | undefined {
  return finiteShareNumber(point.c) ?? finiteShareNumber(point.v);
}

function shareLibraryStyle(style: ChartShareSeries["style"]): string {
  return style === "candles" || style === "ohlc" || style === "hlc" ? style : "line";
}

function hasLibraryPrice(series: ChartShareSeries): boolean {
  return series.points.some((point) => shareClose(point) !== undefined && Number.isFinite(point.t));
}

function polylineValues(series: ChartShareSeries): Array<{ t: number; v: number }> {
  return series.points.flatMap((point) => {
    const value = point.v ?? point.c;
    return typeof value === "number" && Number.isFinite(value) && Number.isFinite(point.t)
      ? [{ t: point.t, v: value }]
      : [];
  });
}

export function shareLibraryInterval(timesMs: readonly number[]): ShareLibraryInterval {
  const times = timesMs.filter((time) => Number.isFinite(time)).sort((left, right) => left - right);
  const gaps: number[] = [];
  for (let index = 1; index < times.length; index += 1) {
    const gap = times[index]! - times[index - 1]!;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return "D";
  gaps.sort((left, right) => left - right);
  const middle = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1 ? gaps[middle]! : (gaps[middle - 1]! + gaps[middle]!) / 2;
  for (const [maxGapMs, interval] of SHARE_LIBRARY_INTERVALS) {
    if (median <= maxGapMs) return interval;
  }
  return "M";
}

export function shareLibrarySeries(series: readonly ChartShareSeries[]): ResolvedLibrarySeries[] {
  const plotted: ResolvedLibrarySeries[] = [];
  for (const entry of series) {
    const points: TimeSeriesPoint[] = [];
    for (const point of entry.points) {
      const close = shareClose(point);
      if (close === undefined || !Number.isFinite(point.t)) continue;
      const open = finiteShareNumber(point.o);
      const high = finiteShareNumber(point.h);
      const low = finiteShareNumber(point.l);
      points.push({
        date: new Date(point.t),
        observedAt: new Date(point.t),
        value: close,
        close,
        ...(open === undefined ? {} : { open }),
        ...(high === undefined ? {} : { high }),
        ...(low === undefined ? {} : { low }),
      });
    }
    if (points.length === 0) continue;
    plotted.push({
      id: entry.id,
      label: entry.label,
      style: shareLibraryStyle(entry.style),
      ...(entry.unit ? { unit: entry.unit } : {}),
      points,
    });
  }
  return plotted;
}

export function shareLegendSeries(
  series: readonly ChartShareSeries[],
  drawn: "library" | "polyline",
): ChartShareSeries[] {
  if (drawn === "polyline") return series.filter((entry) => polylineValues(entry).length >= 2);
  return series.filter(hasLibraryPrice);
}

function formatShareValue(series: ChartShareSeries, value: number): string {
  return formatChartLegendValue(value, series.unit ?? "");
}

function changeTone(change: string | null): "pos" | "neg" | undefined {
  if (!change) return undefined;
  if (change.startsWith("+")) return "pos";
  if (change.startsWith("-")) return "neg";
  return undefined;
}

function LibrarySharePlot({
  payload,
  onError,
}: {
  payload: ChartSharePayload;
  onError: () => void;
}) {
  const plotted = useMemo(() => shareLibrarySeries(payload.series), [payload.series]);
  const handle = useRef(createResolvedSeriesLibraryFeed());
  const [model, setModel] = useState<ResolvedLibraryModel | null>(null);
  useEffect(() => {
    handle.current.setSeries(plotted);
    const next = handle.current.model();
    setModel(next.symbol ? next : null);
  }, [plotted]);
  if (!model) return null;
  return (
    <ChartingLibraryFrame
      symbol={model.symbol}
      interval={shareLibraryInterval(plotted[0]?.points.map((point) => point.date.getTime()) ?? [])}
      timezone="Etc/UTC"
      compares={model.compares}
      chartStyle={model.chartStyle}
      priceScale={model.priceScale}
      backgroundColor={CHART_PALETTE.background}
      feed={handle.current.feed}
      onError={onError}
    />
  );
}

function polylineForSeries(series: ChartShareSeries, width: number, height: number): string | null {
  const values = polylineValues(series);
  if (values.length < 2) return null;
  const minT = Math.min(...values.map((point) => point.t));
  const maxT = Math.max(...values.map((point) => point.t));
  const minV = Math.min(...values.map((point) => point.v));
  const maxV = Math.max(...values.map((point) => point.v));
  const spanT = Math.max(maxT - minT, 1);
  const spanV = Math.max(maxV - minV, 1e-9);
  return values.map((point) => {
    const x = ((point.t - minT) / spanT) * width;
    const y = height - ((point.v - minV) / spanV) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function FrozenSharePlot({
  series,
  fill,
  heightPx,
}: {
  series: readonly ChartShareSeries[];
  fill: boolean;
  heightPx: number;
}) {
  const width = 800;
  const height = Math.max(heightPx, 120);
  return (
    <div
      className="share-panel"
      data-fill={fill ? "true" : undefined}
      style={fill ? undefined : { height: `${heightPx}px` }}
    >
      <svg
        className="share-panel-canvas"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Shared chart snapshot"
        style={{ width: "100%", height: fill ? "100%" : `${heightPx}px`, background: CHART_PALETTE.background }}
      >
        <rect width={width} height={height} fill={CHART_PALETTE.background} />
        {series.map((entry) => {
          const points = polylineForSeries(entry, width, height);
          return points
            ? (
              <polyline
                key={entry.id}
                points={points}
                fill="none"
                stroke={entry.color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )
            : null;
        })}
      </svg>
    </div>
  );
}

function ShareLegendItem({
  series,
  stats,
  chartTitle,
}: {
  series: ChartShareSeries;
  stats: ShareSeriesStats;
  chartTitle: string;
}) {
  const name = shareLegendName(series.label, chartTitle);
  const change = formatShareChange(stats, series.unit);
  const range = formatShareRange(stats, (amount) => formatShareValue(series, amount));

  return (
    <li>
      <span className="share-swatch" style={{ backgroundColor: series.color }} />
      {name ? <span className="share-legend-name">{name}</span> : null}
      <span className="share-legend-last">{formatShareValue(series, stats.last)}</span>
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
  const span = useMemo(() => payloadTimeSpan(payload), [payload]);
  const windowLabel = span ? formatShareSpan(span.startMs, span.endMs) : null;
  const [libraryFailed, setLibraryFailed] = useState(false);
  const panels = useMemo(() => payload.panels.map((panel, index) => ({
    panel,
    series: payload.series.filter((entry) => entry.panelId === panel.id),
    fill: index === 0,
    heightPx: STUDY_PANEL_HEIGHT_PX,
  })).filter((entry) => entry.series.length > 0), [payload.panels, payload.series]);
  const libraryMode = !libraryFailed && shareLibrarySeries(payload.series).length > 0;
  const legendSeries = useMemo(
    () => shareLegendSeries(
      libraryMode ? payload.series : panels.flatMap((panel) => panel.series),
      libraryMode ? "library" : "polyline",
    ),
    [libraryMode, panels, payload.series],
  );

  const captured = formatShareTimestamp(payload.capturedAt);
  const footer = [
    captured ? `snapshot ${captured}` : null,
    payload.subtitle?.trim() || null,
  ].filter(Boolean).join("  ");

  return (
    <ShareShell
      tone="public"
      layout="wide"
      title={payload.title}
      pitch="This chart stays live in Gloom."
      footer={footer ? <span>{footer}</span> : null}
      openInTerminalHref={openInTerminalHref}
    >
      <div className="share-chart-frame">
        <div className="share-chart">
          {legendSeries.length > 0 ? (
            <div className="share-legend">
              <ul>
                {legendSeries.map((entry) => {
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
                    />
                  );
                })}
              </ul>
              {windowLabel ? (
                <span className="share-legend-window">{windowLabel}</span>
              ) : null}
            </div>
          ) : null}

          {libraryMode ? (
            <div className="share-panels">
              <LibrarySharePlot payload={payload} onError={() => setLibraryFailed(true)} />
            </div>
          ) : panels.length > 0 ? (
            <div className="share-panels">
              {panels.map(({ panel, series, fill, heightPx }) => (
                <FrozenSharePlot
                  key={panel.id}
                  series={series}
                  fill={fill}
                  heightPx={heightPx}
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
