/**
 * Turns a resolved chart into a self-contained share payload.
 *
 * A chart share stores drawn values, not a query to re-run. Re-resolving would
 * mean the share page needs the market-data stack, providers, and credentials —
 * which is exactly the weight that makes a shared link slow. The authored spec
 * still travels alongside so the terminal can reopen the chart live.
 */

import type {
  ChartPanelSpec,
  ChartSpec,
  ResolvedSeries,
  TimeSeriesPoint,
} from "../time-series/types";
import type {
  ChartSharePanel,
  ChartSharePayload,
  ChartSharePoint,
  ChartShareSeries,
} from "./payload";

/**
 * Enough to keep intraday detail readable, small enough that a multi-series
 * chart stays well inside the worker's 512 KB share ceiling.
 */
export const CHART_SHARE_MAX_POINTS_PER_SERIES = 2_000;

function finite(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toSharePoint(point: TimeSeriesPoint): ChartSharePoint | null {
  const t = point.date.getTime();
  if (!Number.isFinite(t)) return null;
  const shared: ChartSharePoint = { t };
  const value = finite(point.value);
  if (value !== undefined) shared.v = value;
  const open = finite(point.open);
  const high = finite(point.high);
  const low = finite(point.low);
  const close = finite(point.close);
  if (open !== undefined && high !== undefined && low !== undefined && close !== undefined) {
    shared.o = open;
    shared.h = high;
    shared.l = low;
    shared.c = close;
  }
  return shared.v === undefined && shared.c === undefined ? null : shared;
}

/**
 * Even-stride decimation that always keeps the most recent observation, so a
 * capped series still ends where the sharer's chart ended.
 */
export function decimateSharePoints(
  points: readonly ChartSharePoint[],
  limit: number,
): ChartSharePoint[] {
  if (limit <= 0) return [];
  if (points.length <= limit) return [...points];
  const stride = points.length / limit;
  const kept: ChartSharePoint[] = [];
  for (let index = 0; index < limit; index += 1) {
    const point = points[Math.floor(index * stride)];
    if (point) kept.push(point);
  }
  const last = points[points.length - 1];
  if (last && kept[kept.length - 1]?.t !== last.t) kept[kept.length - 1] = last;
  return kept;
}

function toShareSeries(
  series: ResolvedSeries,
  maxPoints: number,
): ChartShareSeries {
  const points: ChartSharePoint[] = [];
  for (const point of series.points) {
    const shared = toSharePoint(point);
    if (shared) points.push(shared);
  }
  points.sort((left, right) => left.t - right.t);
  return {
    id: series.id,
    label: series.label,
    color: series.color,
    style: series.style,
    axis: series.axis,
    panelId: series.panelId,
    ...(series.unit ? { unit: series.unit } : {}),
    points: decimateSharePoints(points, maxPoints),
  };
}

function toSharePanel(panel: ChartPanelSpec): ChartSharePanel {
  return {
    id: panel.id,
    ...(panel.label ? { label: panel.label } : {}),
    ...(panel.height !== undefined ? { height: panel.height } : {}),
    ...(panel.scale ? { scale: panel.scale } : {}),
  };
}

export interface ChartSnapshotInput {
  title: string;
  subtitle?: string;
  spec: ChartSpec;
  /** Series as drawn, unwindowed, so the share keeps the full loaded history. */
  series: readonly ResolvedSeries[];
  window?: { start: Date; end: Date } | null;
  maxPointsPerSeries?: number;
  now?: Date;
}

export function buildChartSharePayload({
  title,
  subtitle,
  spec,
  series,
  window,
  maxPointsPerSeries = CHART_SHARE_MAX_POINTS_PER_SERIES,
  now = new Date(),
}: ChartSnapshotInput): ChartSharePayload {
  const drawn = series.filter((entry) => !entry.hidden && entry.points.length > 0);
  const shareSeries = drawn.map((entry) => toShareSeries(entry, maxPointsPerSeries));
  const usedPanelIds = new Set(shareSeries.map((entry) => entry.panelId));
  const panels = spec.panels
    .filter((panel) => usedPanelIds.has(panel.id))
    .map(toSharePanel);
  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    capturedAt: now.toISOString(),
    // A series whose panel was dropped from the spec still has to be drawn
    // somewhere, so fall back to a single implicit panel.
    panels: panels.length > 0 ? panels : [...usedPanelIds].map((id) => ({ id })),
    series: shareSeries,
    ...(window
      ? { window: { start: window.start.toISOString(), end: window.end.toISOString() } }
      : {}),
    spec: JSON.parse(JSON.stringify(spec)) as ChartSpec,
  };
}

/**
 * Human-readable chart title from the authored spec, used when the pane has no
 * explicit title of its own.
 */
export function describeChartSpec(
  spec: ChartSpec,
  series: readonly ResolvedSeries[],
): string {
  const labels = series.filter((entry) => !entry.hidden).map((entry) => entry.label);
  const unique = [...new Set(labels)];
  if (unique.length === 0) return "Chart";
  if (unique.length <= 3) return unique.join(" · ");
  return `${unique.slice(0, 3).join(" · ")} +${unique.length - 3}`;
}
