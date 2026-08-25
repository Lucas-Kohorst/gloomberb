/**
 * Snapshot-side stats for a shared chart.
 *
 * The share page has no resolver, so every number here is derived from the
 * frozen points. Keep this module free of React and lightweight-charts so the
 * formatters stay unit-testable.
 */

import type { ChartSharePayload, ChartSharePoint, ChartShareSeries } from "../../shares/payload";

const HOUR_MS = 60 * 60 * 1_000;
const INTRADAY_SPAN_MAX_MS = 36 * HOUR_MS;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Matches lightweight-charts `TickMarkType` without importing the engine. */
export const SHARE_TICK = {
  year: 0,
  month: 1,
  dayOfMonth: 2,
  time: 3,
  timeWithSeconds: 4,
} as const;

export interface ShareSeriesStats {
  first: number;
  last: number;
  high: number;
  low: number;
  firstMs: number;
  lastMs: number;
  pointCount: number;
}

export function sharePointValue(point: ChartSharePoint | undefined): number | null {
  const value = point?.v ?? point?.c;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isSharePercentUnit(unit: string | undefined): boolean {
  const trimmed = unit?.trim() ?? "";
  return trimmed === "%" || trimmed.toLowerCase().includes("percent");
}

export function seriesShareStats(series: ChartShareSeries): ShareSeriesStats | null {
  let first: number | null = null;
  let last: number | null = null;
  let high = -Infinity;
  let low = Infinity;
  let firstMs = 0;
  let lastMs = 0;
  let pointCount = 0;

  for (const point of series.points) {
    const value = sharePointValue(point);
    if (value === null || !Number.isFinite(point.t)) continue;
    if (first === null) {
      first = value;
      firstMs = point.t;
    }
    last = value;
    lastMs = point.t;
    if (value > high) high = value;
    if (value < low) low = value;
    pointCount += 1;
  }

  if (first === null || last === null || pointCount === 0) return null;
  return { first, last, high, low, firstMs, lastMs, pointCount };
}

export function payloadTimeSpan(payload: ChartSharePayload): { startMs: number; endMs: number } | null {
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const series of payload.series) {
    const stats = seriesShareStats(series);
    if (!stats) continue;
    if (stats.firstMs < startMs) startMs = stats.firstMs;
    if (stats.lastMs > endMs) endMs = stats.lastMs;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs };
}

export function nearestSharePoint(series: ChartShareSeries, timeMs: number): ChartSharePoint | null {
  let best: ChartSharePoint | null = null;
  let bestDelta = Infinity;
  for (const point of series.points) {
    if (!Number.isFinite(point.t) || sharePointValue(point) === null) continue;
    const delta = Math.abs(point.t - timeMs);
    if (delta < bestDelta) {
      best = point;
      bestDelta = delta;
    }
  }
  return best;
}

/** Drop the series name when the pane header already says it. */
export function shareLegendName(seriesLabel: string, chartTitle: string): string | null {
  const label = seriesLabel.trim();
  const title = chartTitle.trim();
  if (!label) return null;
  if (label.localeCompare(title, undefined, { sensitivity: "accent" }) === 0) return null;
  return label;
}

function signed(value: string, amount: number): string {
  if (amount > 0) return `+${value}`;
  if (amount < 0) return `-${value}`;
  return value;
}

function compactDelta(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 100) return absolute.toFixed(0);
  if (absolute >= 10) {
    return Math.abs(absolute - Math.round(absolute)) < 0.05
      ? String(Math.round(absolute))
      : absolute.toFixed(1);
  }
  if (absolute >= 1) return absolute.toFixed(2);
  if (absolute === 0) return "0";
  return absolute.toPrecision(3);
}

export function formatShareChange(stats: ShareSeriesStats, unit: string | undefined): string | null {
  const delta = stats.last - stats.first;
  if (delta === 0) return null;
  if (isSharePercentUnit(unit)) return `${signed(`${compactDelta(delta)}pp`, delta)}`;
  const relative = stats.first === 0 ? null : (delta / Math.abs(stats.first)) * 100;
  const abs = signed(compactDelta(delta), delta);
  if (relative === null) return abs;
  return `${abs} (${signed(`${compactDelta(relative)}%`, relative)})`;
}

export function formatShareRange(stats: ShareSeriesStats, formatValue: (value: number) => string): string | null {
  if (stats.high === stats.low) return null;
  return `${formatValue(stats.low)}–${formatValue(stats.high)}`;
}

function utcParts(ms: number): { year: number; month: number; day: number; hour: number; minute: number } {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function formatDay(ms: number, withYear: boolean): string {
  const { year, month, day } = utcParts(ms);
  const base = `${MONTHS[month]} ${day}`;
  return withYear ? `${base}, ${year}` : base;
}

function formatClock(ms: number): string {
  const { hour, minute } = utcParts(ms);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatShareSpan(startMs: number, endMs: number): string {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";
  const start = utcParts(startMs);
  const end = utcParts(endMs);
  if (Math.abs(endMs - startMs) <= INTRADAY_SPAN_MAX_MS) {
    const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
    return sameDay
      ? `${formatDay(startMs, true)} ${formatClock(startMs)}–${formatClock(endMs)} UTC`
      : `${formatDay(startMs, false)} ${formatClock(startMs)} – ${formatDay(endMs, true)} ${formatClock(endMs)} UTC`;
  }
  const sameYear = start.year === end.year;
  return `${formatDay(startMs, !sameYear)} – ${formatDay(endMs, true)}`;
}

export function formatShareCursorDate(timeMs: number, startMs: number, endMs: number): string {
  if (Math.abs(endMs - startMs) <= INTRADAY_SPAN_MAX_MS) {
    return `${formatDay(timeMs, true)} ${formatClock(timeMs)} UTC`;
  }
  return formatDay(timeMs, true);
}

export function formatShareTickMark(timeMs: number, tickMarkType: number): string {
  const { year, month, day } = utcParts(timeMs);
  if (tickMarkType === SHARE_TICK.year) return String(year);
  if (tickMarkType === SHARE_TICK.month) return MONTHS[month] ?? "";
  if (tickMarkType === SHARE_TICK.dayOfMonth) return `${day} ${MONTHS[month]}`;
  return formatClock(timeMs);
}

export function shareTimeVisible(startMs: number, endMs: number): boolean {
  return Number.isFinite(startMs) && Number.isFinite(endMs) && Math.abs(endMs - startMs) <= INTRADAY_SPAN_MAX_MS;
}
