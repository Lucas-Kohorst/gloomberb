/** @jsxImportSource react */
import { useMemo } from "react";
import { formatChartLegendValue } from "../../components/chart/composite/format";
import {
  resolveTradingViewPlot,
  tradingViewEmbedSrc,
} from "../../plugins/builtin/chart-composer/tradingview-plot";
import type { ChartSharePayload, ChartShareSeries } from "../../shares/payload";
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

function formatShareValue(series: ChartShareSeries, value: number): string {
  return formatChartLegendValue(value, series.unit ?? "");
}

function changeTone(change: string | null): "pos" | "neg" | undefined {
  if (!change) return undefined;
  if (change.startsWith("+")) return "pos";
  if (change.startsWith("-")) return "neg";
  return undefined;
}

function TradingViewSharePlot({ payload }: { payload: ChartSharePayload }) {
  const plot = payload.spec ? resolveTradingViewPlot(payload.spec) : { kind: "unmapped" as const };
  if (plot.kind !== "widget") return null;
  const src = tradingViewEmbedSrc(plot, {
    theme: "dark",
    backgroundColor: CHART_PALETTE.background,
  });
  return (
    <iframe
      title={`${plot.symbol} TradingView chart`}
      src={src}
      allow="clipboard-write; fullscreen"
      referrerPolicy="origin-when-cross-origin"
      className="share-panel-canvas"
      style={{ border: 0, width: "100%", height: "100%", minHeight: 420, backgroundColor: CHART_PALETTE.background }}
    />
  );
}

function polylineForSeries(series: ChartShareSeries, width: number, height: number): string | null {
  const values = series.points.flatMap((point) => {
    const value = point.v ?? point.c;
    return typeof value === "number" && Number.isFinite(value) && Number.isFinite(point.t)
      ? [{ t: point.t, v: value }]
      : [];
  });
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
  const plot = payload.spec ? resolveTradingViewPlot(payload.spec) : { kind: "unmapped" as const };

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
  ].filter(Boolean).join("  ");

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
                    />
                  );
                })}
              </ul>
              {windowLabel ? (
                <span className="share-legend-window">{windowLabel}</span>
              ) : null}
            </div>
          ) : null}

          {plot.kind === "widget" ? (
            <div className="share-panels">
              <TradingViewSharePlot payload={payload} />
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
