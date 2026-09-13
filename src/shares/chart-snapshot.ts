import type { ChartSpec, ResolvedSeries } from "../time-series/types";
import { parseSharePayload, type ChartShareData } from "./payload";

const MAX_POINTS = 500;

function sample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  return Array.from({ length: limit }, (_, index) => (
    values[Math.round(index * (values.length - 1) / (limit - 1))]!
  ));
}

export function buildChartShareData(
  series: ResolvedSeries[],
  options: {
    title?: string;
    spec?: ChartSpec;
    capturedAt?: Date;
    window?: { start: Date; end: Date };
  } = {},
): ChartShareData | null {
  const sharedSeries = series.flatMap((entry) => {
    const points = entry.points.flatMap((point) => {
      const y = point.value ?? point.close;
      if (typeof y !== "number" || !Number.isFinite(y)) return [];
      const open = finiteNumber(point.open);
      const high = finiteNumber(point.high);
      const low = finiteNumber(point.low);
      const close = finiteNumber(point.close);
      return [{
        x: point.date.toISOString(),
        y,
        ...(open != null ? { o: open } : {}),
        ...(high != null ? { h: high } : {}),
        ...(low != null ? { l: low } : {}),
        ...(close != null ? { c: close } : {}),
      }];
    });
    return points.length > 0
      ? [{
        name: entry.label,
        color: entry.color,
        style: entry.style,
        axis: entry.axis,
        panelId: entry.panelId,
        ...(entry.unit ? { unit: entry.unit } : {}),
        points: sample(points, MAX_POINTS),
      }]
      : [];
  });
  if (sharedSeries.length === 0) return null;
  const panelIds = [...new Set(sharedSeries.map((entry) => entry.panelId))];
  const capturedAt = (options.capturedAt ?? new Date()).toISOString();
  const base: ChartShareData = {
    title: options.title?.trim() || sharedSeries.map((entry) => entry.name).join(" / "),
    series: sharedSeries,
    capturedAt,
    panels: options.spec?.panels.length
      ? options.spec.panels.map((panel) => ({
        id: panel.id,
        ...(panel.label ? { label: panel.label } : {}),
        ...(panel.height != null ? { height: panel.height } : {}),
        ...(panel.scale ? { scale: panel.scale } : {}),
      }))
      : panelIds.map((id) => ({ id })),
    ...(options.window
      ? { window: { start: options.window.start.toISOString(), end: options.window.end.toISOString() } }
      : {}),
  };
  const withSpec = options.spec ? { ...base, spec: options.spec } : base;
  if (parseSharePayload({ kind: "chart", data: withSpec })) return withSpec;
  if (parseSharePayload({ kind: "chart", data: base })) return base;
  return base;
}

function finiteNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
